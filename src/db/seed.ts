/**
 * Seed script — creates a test user and sample budget entries for local development.
 *
 * Usage: npm run db:seed
 */

import bcrypt from 'bcryptjs';
import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { budgetEntries, users } from './schema';

const TEST_EMAIL = 'test@budgeto.app';
const TEST_PASSWORD = 'password123';

async function seed() {
	const client = postgres({
		host: process.env.DB_HOST!,
		port: Number(process.env.DB_PORT ?? 5432),
		database: process.env.DB_NAME!,
		username: process.env.DB_USER!,
		password: process.env.DB_PASSWORD!,
		max: 1,
	});
	const db = drizzle(client);

	console.log('🌱 Seeding database...');

	// Create test user (or skip if already exists)
	const passwordHash = await bcrypt.hash(TEST_PASSWORD, 12);
	const [user] = await db
		.insert(users)
		.values({ email: TEST_EMAIL, passwordHash })
		.onConflictDoNothing({ target: users.email })
		.returning({ id: users.id });

	const userId = user?.id;
	if (!userId) {
		console.log(`   User ${TEST_EMAIL} already exists, skipping entries.`);
		await client.end();
		return;
	}

	// Create sample budget entries
	const now = new Date();
	const entries = [
		{ type: 'income', amount: '3500.00', description: 'Salary' },
		{ type: 'income', amount: '200.00', description: 'Freelance project' },
		{ type: 'expense', amount: '1200.00', description: 'Rent' },
		{ type: 'expense', amount: '85.50', description: 'Groceries' },
		{ type: 'expense', amount: '49.99', description: 'Internet' },
		{ type: 'savings_deposit', amount: '500.00', description: 'Emergency fund' },
		{ type: 'savings_deposit', amount: '150.00', description: 'Savings from: Salary' },
		{ type: 'expense', amount: '12.99', description: 'Streaming service' },
	];

	await db.insert(budgetEntries).values(
		entries.map((e, i) => ({
			id: randomUUID(),
			userId,
			amount: e.amount,
			description: e.description,
			type: e.type,
			createdAt: new Date(now.getTime() - (entries.length - i) * 86400000),
		})),
	);

	console.log(`✅ Seeded: user ${TEST_EMAIL} (password: ${TEST_PASSWORD}) with ${entries.length} entries.`);
	await client.end();
}

seed().catch((err) => {
	console.error('❌ Seed failed:', err instanceof Error ? err.message : err);
	process.exit(1);
});
