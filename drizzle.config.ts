import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

const { DB_HOST, DB_PORT = '5432', DB_NAME, DB_USER, DB_PASSWORD } = process.env;

const encodedPassword = encodeURIComponent(DB_PASSWORD ?? '');
const url = `postgresql://${DB_USER}:${encodedPassword}@${DB_HOST}:${DB_PORT}/${DB_NAME}`;

export default defineConfig({
	schema: './src/db/schema.ts',
	out: './drizzle',
	dialect: 'postgresql',
	dbCredentials: { url },
});
