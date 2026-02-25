import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
	DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
	JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
	CORS_ORIGIN: z.string().url().default('https://budgeto.app'),
	PORT: z.coerce.number().default(4000),
	NODE_ENV: z
		.enum(['development', 'production', 'test'])
		.default('development'),
});

export type Env = z.infer<typeof envSchema>;

function validateEnv(): Env {
	const result = envSchema.safeParse(process.env);

	if (!result.success) {
		console.error(
			'❌ Invalid environment variables:',
			result.error.flatten().fieldErrors,
		);
		process.exit(1);
	}

	return result.data;
}

export const env = validateEnv();
