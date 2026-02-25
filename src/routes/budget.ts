import { zValidator } from '@hono/zod-validator';
import { and, eq, isNull } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db';
import { budgetEntries } from '../db/schema';
import { authMiddleware } from '../middleware/auth';

type BudgetEnv = {
	Variables: {
		userId: string;
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

// ── POST /api/budget/sync ────────────────────────────────────────────
// Accepts a single SyncOperation from the frontend's offline queue.
// Operations are idempotent — safe to replay on reconnect.

budget.post('/sync', zValidator('json', syncOperationSchema), async (c) => {
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

// ── GET /api/budget/entries ──────────────────────────────────────────
// Returns the full snapshot of non-deleted entries for the authenticated user.
// The frontend calls this after draining its sync queue to pull server truth.

budget.get('/entries', async (c) => {
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

	return c.json({ entries: transformed });
});

export default budget;
