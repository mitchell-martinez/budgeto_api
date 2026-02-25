import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from '../lib/env';
import * as schema from './schema';

const client = postgres({
	host: env.DB_HOST,
	port: env.DB_PORT,
	database: env.DB_NAME,
	username: env.DB_USER,
	password: env.DB_PASSWORD,
	max: 10,
	idle_timeout: 20,
	connect_timeout: 10,
});

export const db = drizzle(client, { schema });
