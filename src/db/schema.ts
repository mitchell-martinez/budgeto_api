import {
	index,
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
