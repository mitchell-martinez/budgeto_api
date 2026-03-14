import
	{
		boolean,
		index,
		integer,
		numeric,
		pgTable,
		text,
		timestamp,
		uuid,
	} from 'drizzle-orm/pg-core';

// ── Users ────────────────────────────────────────────────────────────

export const users = pgTable('users', {
	id: uuid('id').defaultRandom().primaryKey(),
	email: text('email').notNull().unique(),
	passwordHash: text('password_hash').notNull(),
	createdAt: timestamp('created_at', { withTimezone: true })
		.defaultNow()
		.notNull(),
});

// ── Budget entries ───────────────────────────────────────────────────

export const budgetEntries = pgTable(
	'budget_entries',
	{
		id: text('id').primaryKey(), // Client-generated ID preserved for offline sync
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
		description: text('description').notNull().default(''),
		type: text('type').notNull(), // income | expense | savings_deposit | savings_withdrawal
		createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true })
			.defaultNow()
			.notNull(),
		deletedAt: timestamp('deleted_at', { withTimezone: true }), // Soft-delete for idempotent sync
	},
	(table) => [
		index('idx_entries_user_deleted_created').on(
			table.userId,
			table.deletedAt,
			table.createdAt,
		),
	],
);

// ── Refresh tokens ───────────────────────────────────────────────────

export const refreshTokens = pgTable('refresh_tokens', {
	id: uuid('id').defaultRandom().primaryKey(),
	userId: uuid('user_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	tokenHash: text('token_hash').notNull(),
	expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
	createdAt: timestamp('created_at', { withTimezone: true })
		.defaultNow()
		.notNull(),
});

// ── Budget cycle settings ───────────────────────────────────────────

export const budgetCycleSettings = pgTable(
	'budget_cycle_settings',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		userId: uuid('user_id')
			.notNull()
			.unique()
			.references(() => users.id, { onDelete: 'cascade' }),
		cycleType: text('cycle_type').notNull().default('monthly'),
		cycleStartDay: integer('cycle_start_day').notNull().default(1),
		customCycleDays: integer('custom_cycle_days'),
		autoCloseEnabled: boolean('auto_close_enabled').notNull().default(true),
		autoResetEnabled: boolean('auto_reset_enabled').notNull().default(true),
		includeLeftoverInSaved: boolean('include_leftover_in_saved')
			.notNull()
			.default(false),
		timezone: text('timezone').notNull().default('UTC'),
		currentCycleStart: timestamp('current_cycle_start', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [index('idx_cycle_settings_user').on(table.userId)],
);

// ── Long-term cycle history snapshots ───────────────────────────────

export const budgetCycleHistory = pgTable(
	'budget_cycle_history',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		cycleStart: timestamp('cycle_start', { withTimezone: true }).notNull(),
		cycleEnd: timestamp('cycle_end', { withTimezone: true }).notNull(),
		totalIncome: numeric('total_income', { precision: 12, scale: 2 })
			.notNull()
			.default('0'),
		totalExpenses: numeric('total_expenses', { precision: 12, scale: 2 })
			.notNull()
			.default('0'),
		totalSavings: numeric('total_savings', { precision: 12, scale: 2 })
			.notNull()
			.default('0'),
		totalLeftover: numeric('total_leftover', { precision: 12, scale: 2 })
			.notNull()
			.default('0'),
		totalSavedWithLeftover: numeric('total_saved_with_leftover', {
			precision: 12,
			scale: 2,
		})
			.notNull()
			.default('0'),
		entryCount: integer('entry_count').notNull().default(0),
		closedAt: timestamp('closed_at', { withTimezone: true })
			.defaultNow()
			.notNull(),
		createdAt: timestamp('created_at', { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		index('idx_cycle_history_user_cycle').on(
			table.userId,
			table.cycleStart,
			table.cycleEnd,
		),
	],
);

// ── Password reset tokens ───────────────────────────────────────────

export const passwordResetTokens = pgTable(
	'password_reset_tokens',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		tokenHash: text('token_hash').notNull().unique(),
		expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
		usedAt: timestamp('used_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [index('idx_password_reset_tokens_user').on(table.userId)],
);
