import { zValidator } from '@hono/zod-validator';
import { and, desc, eq, gte, isNull, lte } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db';
import {
    budgetCycleHistory,
    budgetCycleSettings,
    budgetEntries,
} from '../db/schema';
import { authMiddleware } from '../middleware/auth';

type BudgetEnv = {
	Variables: {
		userId: string;
		isDemo: boolean;
	};
};

const budget = new Hono<BudgetEnv>();

// All routes require authentication
budget.use('/*', authMiddleware);

// ── Validation schemas ───────────────────────────────────────────────

const budgetEntryType = z.enum([
	'income',
	'expense',
	'savings_deposit',
	'savings_withdrawal',
]);

const syncOperationSchema = z.object({
	type: z.enum(['add', 'update', 'delete']),
	payload: z.object({
		entryId: z.string().min(1).max(100),
		amount: z.number().positive().max(999_999_999_999).optional(),
		description: z.string().max(500).optional(),
		entryType: budgetEntryType.optional(),
		createdAt: z.string().datetime().optional(),
	}),
	timestamp: z.number(),
});

const cycleTypeSchema = z.enum(['weekly', 'biweekly', 'monthly', 'custom']);

const cycleSettingsSchema = z.object({
	cycleType: cycleTypeSchema,
	cycleStartDay: z.number().int().min(1).max(31),
	customCycleDays: z.number().int().min(7).max(90).optional(),
	autoCloseEnabled: z.boolean(),
	autoResetEnabled: z.boolean(),
	includeLeftoverInSaved: z.boolean(),
	timezone: z.string().min(1).max(100).default('UTC'),
});

const historyQuerySchema = z.object({
	from: z.string().datetime().optional(),
	to: z.string().datetime().optional(),
	limit: z.coerce.number().int().min(1).max(100).default(24),
	offset: z.coerce.number().int().min(0).default(0),
});

// ── Static demo data ─────────────────────────────────────────────────
// Served to demo users so they can explore the app without a real account.

const DEMO_ENTRIES = [
	{
		id: 'demo-1',
		amount: 3500,
		description: 'Monthly salary',
		type: 'income',
		createdAt: new Date(Date.now() - 25 * 24 * 60 * 60 * 1000).toISOString(),
	},
	{
		id: 'demo-2',
		amount: 1200,
		description: 'Rent',
		type: 'expense',
		createdAt: new Date(Date.now() - 24 * 24 * 60 * 60 * 1000).toISOString(),
	},
	{
		id: 'demo-3',
		amount: 200,
		description: 'Groceries',
		type: 'expense',
		createdAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString(),
	},
	{
		id: 'demo-4',
		amount: 500,
		description: 'Emergency fund',
		type: 'savings_deposit',
		createdAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString(),
	},
	{
		id: 'demo-5',
		amount: 80,
		description: 'Internet bill',
		type: 'expense',
		createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
	},
];

type CycleSettingsRecord = {
	cycleType: 'weekly' | 'biweekly' | 'monthly' | 'custom';
	cycleStartDay: number;
	customCycleDays: number | null;
	autoCloseEnabled: boolean;
	autoResetEnabled: boolean;
	includeLeftoverInSaved: boolean;
	timezone: string;
	currentCycleStart: Date | null;
};

const DEFAULT_CYCLE_SETTINGS: Omit<CycleSettingsRecord, 'currentCycleStart'> = {
	cycleType: 'monthly',
	cycleStartDay: 1,
	customCycleDays: null,
	autoCloseEnabled: true,
	autoResetEnabled: true,
	includeLeftoverInSaved: false,
	timezone: 'UTC',
};

function cycleDurationDays(settings: CycleSettingsRecord): number {
	switch (settings.cycleType) {
		case 'weekly':
			return 7;
		case 'biweekly':
			return 14;
		case 'custom':
			return settings.customCycleDays ?? 30;
		case 'monthly':
		default:
			return 30;
	}
}

function startOfCycle(settings: CycleSettingsRecord, now: Date): Date {
	if (settings.currentCycleStart) {
		return settings.currentCycleStart;
	}

	const start = new Date(now);
	start.setUTCHours(0, 0, 0, 0);

	if (settings.cycleType === 'weekly' || settings.cycleType === 'biweekly') {
		const targetWeekday = Math.max(1, Math.min(7, settings.cycleStartDay));
		const jsTarget = targetWeekday % 7; // 7 -> Sunday
		const current = start.getUTCDay();
		const diff = (current - jsTarget + 7) % 7;
		start.setUTCDate(start.getUTCDate() - diff);
		return start;
	}

	if (settings.cycleType === 'monthly') {
		const day = Math.max(1, Math.min(28, settings.cycleStartDay));
		start.setUTCDate(day);
		if (start > now) {
			start.setUTCMonth(start.getUTCMonth() - 1);
		}
		return start;
	}

	return start;
}

async function getOrCreateCycleSettings(userId: string): Promise<CycleSettingsRecord> {
	const [existing] = await db
		.select({
			cycleType: budgetCycleSettings.cycleType,
			cycleStartDay: budgetCycleSettings.cycleStartDay,
			customCycleDays: budgetCycleSettings.customCycleDays,
			autoCloseEnabled: budgetCycleSettings.autoCloseEnabled,
			autoResetEnabled: budgetCycleSettings.autoResetEnabled,
			includeLeftoverInSaved: budgetCycleSettings.includeLeftoverInSaved,
			timezone: budgetCycleSettings.timezone,
			currentCycleStart: budgetCycleSettings.currentCycleStart,
		})
		.from(budgetCycleSettings)
		.where(eq(budgetCycleSettings.userId, userId))
		.limit(1);

	if (existing) {
		return {
			cycleType: existing.cycleType as CycleSettingsRecord['cycleType'],
			cycleStartDay: existing.cycleStartDay,
			customCycleDays: existing.customCycleDays,
			autoCloseEnabled: existing.autoCloseEnabled,
			autoResetEnabled: existing.autoResetEnabled,
			includeLeftoverInSaved: existing.includeLeftoverInSaved,
			timezone: existing.timezone,
			currentCycleStart: existing.currentCycleStart,
		};
	}

	const now = new Date();
	const [created] = await db
		.insert(budgetCycleSettings)
		.values({
			userId,
			...DEFAULT_CYCLE_SETTINGS,
			currentCycleStart: now,
		})
		.returning({
			cycleType: budgetCycleSettings.cycleType,
			cycleStartDay: budgetCycleSettings.cycleStartDay,
			customCycleDays: budgetCycleSettings.customCycleDays,
			autoCloseEnabled: budgetCycleSettings.autoCloseEnabled,
			autoResetEnabled: budgetCycleSettings.autoResetEnabled,
			includeLeftoverInSaved: budgetCycleSettings.includeLeftoverInSaved,
			timezone: budgetCycleSettings.timezone,
			currentCycleStart: budgetCycleSettings.currentCycleStart,
		});

	return {
		cycleType: created.cycleType as CycleSettingsRecord['cycleType'],
		cycleStartDay: created.cycleStartDay,
		customCycleDays: created.customCycleDays,
		autoCloseEnabled: created.autoCloseEnabled,
		autoResetEnabled: created.autoResetEnabled,
		includeLeftoverInSaved: created.includeLeftoverInSaved,
		timezone: created.timezone,
		currentCycleStart: created.currentCycleStart,
	};
}

// ── GET/PUT /api/budget/config ─────────────────────────────────────

budget.get('/config', async (c) => {
	const isDemo = c.get('isDemo');
	if (isDemo) {
		return c.json({
			config: {
				...DEFAULT_CYCLE_SETTINGS,
				currentCycleStart: new Date().toISOString(),
			},
			demo: true,
		});
	}

	const userId = c.get('userId');
	const settings = await getOrCreateCycleSettings(userId);

	return c.json({
		config: {
			...settings,
			currentCycleStart:
				settings.currentCycleStart?.toISOString() ?? new Date().toISOString(),
		},
	});
});

budget.put('/config', zValidator('json', cycleSettingsSchema), async (c) => {
	const isDemo = c.get('isDemo');
	if (isDemo) {
		return c.json({ error: 'Demo sessions cannot update settings' }, 403);
	}

	const userId = c.get('userId');
	const payload = c.req.valid('json');
	const now = new Date();

	const [updated] = await db
		.insert(budgetCycleSettings)
		.values({
			userId,
			...payload,
			currentCycleStart: now,
			updatedAt: now,
		})
		.onConflictDoUpdate({
			target: budgetCycleSettings.userId,
			set: {
				cycleType: payload.cycleType,
				cycleStartDay: payload.cycleStartDay,
				customCycleDays: payload.customCycleDays ?? null,
				autoCloseEnabled: payload.autoCloseEnabled,
				autoResetEnabled: payload.autoResetEnabled,
				includeLeftoverInSaved: payload.includeLeftoverInSaved,
				timezone: payload.timezone,
				updatedAt: now,
			},
		})
		.returning({
			cycleType: budgetCycleSettings.cycleType,
			cycleStartDay: budgetCycleSettings.cycleStartDay,
			customCycleDays: budgetCycleSettings.customCycleDays,
			autoCloseEnabled: budgetCycleSettings.autoCloseEnabled,
			autoResetEnabled: budgetCycleSettings.autoResetEnabled,
			includeLeftoverInSaved: budgetCycleSettings.includeLeftoverInSaved,
			timezone: budgetCycleSettings.timezone,
			currentCycleStart: budgetCycleSettings.currentCycleStart,
		});

	return c.json({
		success: true,
		config: {
			...updated,
			currentCycleStart:
				updated.currentCycleStart?.toISOString() ?? new Date().toISOString(),
		},
	});
});

// ── POST /api/budget/close-cycle ───────────────────────────────────

budget.post('/close-cycle', async (c) => {
	const isDemo = c.get('isDemo');
	if (isDemo) {
		return c.json({ error: 'Demo sessions are read-only' }, 403);
	}

	const userId = c.get('userId');
	const settings = await getOrCreateCycleSettings(userId);
	const now = new Date();
	const cycleStart = startOfCycle(settings, now);
	const durationDays = cycleDurationDays(settings);
	const cycleEnd = new Date(cycleStart);
	cycleEnd.setUTCDate(cycleEnd.getUTCDate() + durationDays);

	const activeEntries = await db
		.select({
			id: budgetEntries.id,
			amount: budgetEntries.amount,
			type: budgetEntries.type,
		})
		.from(budgetEntries)
		.where(
			and(eq(budgetEntries.userId, userId), isNull(budgetEntries.deletedAt)),
		);

	const totals = activeEntries.reduce(
		(acc, entry) => {
			const amount = Number(entry.amount);
			if (entry.type === 'income') acc.income += amount;
			if (entry.type === 'expense') acc.expenses += amount;
			if (entry.type === 'savings_deposit') acc.savings += amount;
			if (entry.type === 'savings_withdrawal') acc.savings -= amount;
			return acc;
		},
		{ income: 0, expenses: 0, savings: 0 },
	);

	const leftover = Math.max(0, totals.income - totals.expenses - totals.savings);
	const totalSavedWithLeftover = settings.includeLeftoverInSaved
		? totals.savings + leftover
		: totals.savings;

	await db.transaction(async (tx) => {
		await tx.insert(budgetCycleHistory).values({
			userId,
			cycleStart,
			cycleEnd,
			totalIncome: String(totals.income),
			totalExpenses: String(totals.expenses),
			totalSavings: String(totals.savings),
			totalLeftover: String(leftover),
			totalSavedWithLeftover: String(totalSavedWithLeftover),
			entryCount: activeEntries.length,
			closedAt: now,
		});

		if (settings.autoResetEnabled) {
			await tx
				.update(budgetEntries)
				.set({ deletedAt: now, updatedAt: now })
				.where(
					and(eq(budgetEntries.userId, userId), isNull(budgetEntries.deletedAt)),
				);
		}

		await tx
			.update(budgetCycleSettings)
			.set({
				currentCycleStart: now,
				updatedAt: now,
			})
			.where(eq(budgetCycleSettings.userId, userId));
	});

	return c.json({
		success: true,
		cycle: {
			cycleStart: cycleStart.toISOString(),
			cycleEnd: cycleEnd.toISOString(),
			totalIncome: totals.income,
			totalExpenses: totals.expenses,
			totalSavings: totals.savings,
			totalLeftover: leftover,
			totalSavedWithLeftover,
			entryCount: activeEntries.length,
		},
	});
});

// ── POST /api/budget/process-cycle-check ───────────────────────────
// Checks whether current cycle has ended and auto-closes it if due.

budget.post('/process-cycle-check', async (c) => {
	const isDemo = c.get('isDemo');
	if (isDemo) {
		return c.json({ processed: false, reason: 'demo' });
	}

	const userId = c.get('userId');
	const settings = await getOrCreateCycleSettings(userId);

	if (!settings.autoCloseEnabled) {
		return c.json({ processed: false, reason: 'auto-close-disabled' });
	}

	const now = new Date();
	const cycleStart = startOfCycle(settings, now);
	const cycleEnd = new Date(cycleStart);
	cycleEnd.setUTCDate(cycleEnd.getUTCDate() + cycleDurationDays(settings));

	if (now < cycleEnd) {
		return c.json({ processed: false, reason: 'not-due' });
	}

	const activeEntries = await db
		.select({
			id: budgetEntries.id,
			amount: budgetEntries.amount,
			type: budgetEntries.type,
		})
		.from(budgetEntries)
		.where(
			and(eq(budgetEntries.userId, userId), isNull(budgetEntries.deletedAt)),
		);

	const totals = activeEntries.reduce(
		(acc, entry) => {
			const amount = Number(entry.amount);
			if (entry.type === 'income') acc.income += amount;
			if (entry.type === 'expense') acc.expenses += amount;
			if (entry.type === 'savings_deposit') acc.savings += amount;
			if (entry.type === 'savings_withdrawal') acc.savings -= amount;
			return acc;
		},
		{ income: 0, expenses: 0, savings: 0 },
	);

	const leftover = Math.max(0, totals.income - totals.expenses - totals.savings);
	const totalSavedWithLeftover = settings.includeLeftoverInSaved
		? totals.savings + leftover
		: totals.savings;

	await db.transaction(async (tx) => {
		await tx.insert(budgetCycleHistory).values({
			userId,
			cycleStart,
			cycleEnd,
			totalIncome: String(totals.income),
			totalExpenses: String(totals.expenses),
			totalSavings: String(totals.savings),
			totalLeftover: String(leftover),
			totalSavedWithLeftover: String(totalSavedWithLeftover),
			entryCount: activeEntries.length,
			closedAt: now,
		});

		if (settings.autoResetEnabled) {
			await tx
				.update(budgetEntries)
				.set({ deletedAt: now, updatedAt: now })
				.where(
					and(eq(budgetEntries.userId, userId), isNull(budgetEntries.deletedAt)),
				);
		}

		await tx
			.update(budgetCycleSettings)
			.set({
				currentCycleStart: now,
				updatedAt: now,
			})
			.where(eq(budgetCycleSettings.userId, userId));
	});

	return c.json({ processed: true, cycleEnd: cycleEnd.toISOString() });
});

// ── GET /api/budget/long-term-history ──────────────────────────────

budget.get('/long-term-history', zValidator('query', historyQuerySchema), async (c) => {
	const isDemo = c.get('isDemo');
	if (isDemo) {
		return c.json({ history: [], total: 0, demo: true });
	}

	const userId = c.get('userId');
	const { from, to, limit, offset } = c.req.valid('query');

	const conditions = [eq(budgetCycleHistory.userId, userId)];
	if (from) {
		conditions.push(gte(budgetCycleHistory.cycleStart, new Date(from)));
	}
	if (to) {
		conditions.push(lte(budgetCycleHistory.cycleEnd, new Date(to)));
	}

	const historyRows = await db
		.select({
			id: budgetCycleHistory.id,
			cycleStart: budgetCycleHistory.cycleStart,
			cycleEnd: budgetCycleHistory.cycleEnd,
			totalIncome: budgetCycleHistory.totalIncome,
			totalExpenses: budgetCycleHistory.totalExpenses,
			totalSavings: budgetCycleHistory.totalSavings,
			totalLeftover: budgetCycleHistory.totalLeftover,
			totalSavedWithLeftover: budgetCycleHistory.totalSavedWithLeftover,
			entryCount: budgetCycleHistory.entryCount,
			closedAt: budgetCycleHistory.closedAt,
		})
		.from(budgetCycleHistory)
		.where(and(...conditions))
		.orderBy(desc(budgetCycleHistory.cycleEnd))
		.limit(limit)
		.offset(offset);

	return c.json({
		history: historyRows.map((row) => ({
			id: row.id,
			cycleStart: row.cycleStart.toISOString(),
			cycleEnd: row.cycleEnd.toISOString(),
			totalIncome: Number(row.totalIncome),
			totalExpenses: Number(row.totalExpenses),
			totalSavings: Number(row.totalSavings),
			totalLeftover: Number(row.totalLeftover),
			totalSavedWithLeftover: Number(row.totalSavedWithLeftover),
			entryCount: row.entryCount,
			closedAt: row.closedAt.toISOString(),
		})),
		total: historyRows.length,
	});
});

// ── POST /api/budget/sync ────────────────────────────────────────────
// Accepts a single SyncOperation from the frontend's offline queue.
// Operations are idempotent — safe to replay on reconnect.

budget.post('/sync', zValidator('json', syncOperationSchema), async (c) => {
	const isDemo = c.get('isDemo');

	if (isDemo) {
		return c.json({ error: 'Demo sessions are read-only' }, 403);
	}

	const userId = c.get('userId');
	const op = c.req.valid('json');
	const { type, payload } = op;
	const now = new Date();

	switch (type) {
		case 'add': {
			if (!payload.amount || !payload.entryType) {
				return c.json(
					{ error: 'amount and entryType are required for add operations' },
					400,
				);
			}

			// Upsert: INSERT or update-on-conflict makes replays idempotent
			await db
				.insert(budgetEntries)
				.values({
					id: payload.entryId,
					userId,
					amount: String(payload.amount),
					description: payload.description ?? '',
					type: payload.entryType,
					createdAt: payload.createdAt ? new Date(payload.createdAt) : now,
					updatedAt: now,
				})
				.onConflictDoUpdate({
					target: budgetEntries.id,
					set: {
						amount: String(payload.amount),
						description: payload.description ?? '',
						type: payload.entryType,
						updatedAt: now,
						deletedAt: null, // Resurrect if previously soft-deleted
					},
				});
			break;
		}

		case 'update': {
			const updates: Record<string, unknown> = { updatedAt: now };
			if (payload.amount !== undefined) updates.amount = String(payload.amount);
			if (payload.description !== undefined)
				updates.description = payload.description;
			if (payload.entryType !== undefined) updates.type = payload.entryType;

			await db
				.update(budgetEntries)
				.set(updates)
				.where(
					and(
						eq(budgetEntries.id, payload.entryId),
						eq(budgetEntries.userId, userId),
					),
				);
			break;
		}

		case 'delete': {
			// Soft-delete — preserves the row for sync consistency
			await db
				.update(budgetEntries)
				.set({ deletedAt: now, updatedAt: now })
				.where(
					and(
						eq(budgetEntries.id, payload.entryId),
						eq(budgetEntries.userId, userId),
					),
				);
			break;
		}
	}

	return c.json({ success: true });
});

// ── POST /api/budget/sync/batch ──────────────────────────────────────
// Accepts an array of SyncOperations, applying them sequentially.
// Used by the frontend to drain its offline queue in a single request.

const batchSyncSchema = z.object({
	operations: z.array(syncOperationSchema).min(1).max(200),
});

budget.post(
	'/sync/batch',
	zValidator('json', batchSyncSchema),
	async (c) => {
		const isDemo = c.get('isDemo');

		if (isDemo) {
			return c.json({ error: 'Demo sessions are read-only' }, 403);
		}

		const userId = c.get('userId');
		const { operations } = c.req.valid('json');
		const now = new Date();

		for (const op of operations) {
			const { type, payload } = op;

			switch (type) {
				case 'add': {
					if (!payload.amount || !payload.entryType) {
						continue; // Skip malformed ops in batch
					}

					await db
						.insert(budgetEntries)
						.values({
							id: payload.entryId,
							userId,
							amount: String(payload.amount),
							description: payload.description ?? '',
							type: payload.entryType,
							createdAt: payload.createdAt
								? new Date(payload.createdAt)
								: now,
							updatedAt: now,
						})
						.onConflictDoUpdate({
							target: budgetEntries.id,
							set: {
								amount: String(payload.amount),
								description: payload.description ?? '',
								type: payload.entryType,
								updatedAt: now,
								deletedAt: null,
							},
						});
					break;
				}

				case 'update': {
					const updates: Record<string, unknown> = { updatedAt: now };
					if (payload.amount !== undefined)
						updates.amount = String(payload.amount);
					if (payload.description !== undefined)
						updates.description = payload.description;
					if (payload.entryType !== undefined)
						updates.type = payload.entryType;

					await db
						.update(budgetEntries)
						.set(updates)
						.where(
							and(
								eq(budgetEntries.id, payload.entryId),
								eq(budgetEntries.userId, userId),
							),
						);
					break;
				}

				case 'delete': {
					await db
						.update(budgetEntries)
						.set({ deletedAt: now, updatedAt: now })
						.where(
							and(
								eq(budgetEntries.id, payload.entryId),
								eq(budgetEntries.userId, userId),
							),
						);
					break;
				}
			}
		}

		return c.json({ success: true, processed: operations.length });
	},
);

// ── GET /api/budget/entries ──────────────────────────────────────────
// Returns the full snapshot of non-deleted entries for the authenticated user.
// The frontend calls this after draining its sync queue to pull server truth.

budget.get('/entries', async (c) => {
	const isDemo = c.get('isDemo');

	if (isDemo) {
		return c.json({ entries: DEMO_ENTRIES, demo: true });
	}

	const userId = c.get('userId');

	const entries = await db
		.select({
			id: budgetEntries.id,
			amount: budgetEntries.amount,
			description: budgetEntries.description,
			type: budgetEntries.type,
			createdAt: budgetEntries.createdAt,
		})
		.from(budgetEntries)
		.where(
			and(eq(budgetEntries.userId, userId), isNull(budgetEntries.deletedAt)),
		)
		.orderBy(budgetEntries.createdAt);

	// Transform to match the frontend's BudgetEntry shape
	const transformed = entries.map((e) => ({
		...e,
		amount: Number(e.amount),
		createdAt: e.createdAt.toISOString(),
	}));

	return c.json({ entries: transformed, demo: false });
});

export default budget;
