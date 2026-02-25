import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const requiredVars = ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'] as const;

async function runMigrations() {
	const missing = requiredVars.filter((k) => !process.env[k]);
	if (missing.length) {
		console.error(`❌ Missing required env vars: ${missing.join(', ')}`);
		process.exit(1);
	}

	const client = postgres({
		host: process.env.DB_HOST!,
		port: Number(process.env.DB_PORT ?? 5432),
		database: process.env.DB_NAME!,
		username: process.env.DB_USER!,
		password: process.env.DB_PASSWORD!,
		max: 1,
	});
	const db = drizzle(client);

	console.log('⏳ Running migrations...');
	await migrate(db, { migrationsFolder: './drizzle' });
	console.log('✅ Migrations complete.');

	await client.end();
}

runMigrations().catch((err) => {
	// Sanitize — never log connection strings or credentials
	const safeMessage =
		err instanceof Error ? err.message : 'Unknown error';
	console.error('❌ Migration failed:', safeMessage);
	process.exit(1);
});
