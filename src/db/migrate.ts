import 'dotenv/config';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

async function runMigrations() {
  const DATABASE_URL = process.env.DATABASE_URL;

  if (!DATABASE_URL) {
    console.error('❌ DATABASE_URL environment variable is required');
    process.exit(1);
  }

  const client = postgres(DATABASE_URL, { max: 1 });
  const db = drizzle(client);

  console.log('⏳ Running migrations...');
  await migrate(db, { migrationsFolder: './drizzle' });
  console.log('✅ Migrations complete.');

  await client.end();
}

runMigrations().catch((err) => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
