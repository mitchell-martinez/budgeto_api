import { zValidator } from '@hono/zod-validator';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import { db } from '../db';
import { refreshTokens, users } from '../db/schema';
import { env } from '../lib/env';
import {
    createAccessToken,
    generateRefreshToken,
    hashToken,
    REFRESH_TOKEN_EXPIRY_LONG,
    REFRESH_TOKEN_EXPIRY_SHORT,
} from '../lib/tokens';
import { rateLimiter } from '../middleware/rateLimiter';

const auth = new Hono();

// ── Request schemas ──────────────────────────────────────────────────

const registerSchema = z.object({
	email: z
		.string()
		.email()
		.max(255)
		.transform((e) => e.toLowerCase().trim()),
	password: z.string().min(8).max(128),
});

const loginSchema = z.object({
	email: z
		.string()
		.email()
		.max(255)
		.transform((e) => e.toLowerCase().trim()),
	password: z.string().min(1).max(128),
	rememberMe: z.boolean().default(false),
});

// ── Helpers ──────────────────────────────────────────────────────────

const REFRESH_COOKIE_NAME = 'refresh_token';
const REFRESH_COOKIE_PATH = '/api/auth';

async function issueRefreshToken(
	c: Context,
	userId: string,
	rememberMe: boolean,
): Promise<void> {
	const token = generateRefreshToken();
	const tokenHash = hashToken(token);
	const expirySeconds = rememberMe
		? REFRESH_TOKEN_EXPIRY_LONG
		: REFRESH_TOKEN_EXPIRY_SHORT;
	const expiresAt = new Date(Date.now() + expirySeconds * 1000);

	await db.insert(refreshTokens).values({
		userId,
		tokenHash,
		expiresAt,
	});

	setCookie(c, REFRESH_COOKIE_NAME, token, {
		httpOnly: true,
		secure: env.NODE_ENV === 'production',
		sameSite: 'Strict',
		path: REFRESH_COOKIE_PATH,
		...(rememberMe ? { maxAge: expirySeconds } : {}),
	});
}

// ── POST /api/auth/register ──────────────────────────────────────────

auth.post(
	'/register',
	rateLimiter({ max: 5, windowMs: 60 * 1000 }),
	zValidator('json', registerSchema),
	async (c) => {
		const { email, password } = c.req.valid('json');

		// Check if email is already taken
		const existing = await db
			.select({ id: users.id })
			.from(users)
			.where(eq(users.email, email))
			.limit(1);

		if (existing.length > 0) {
			return c.json({ error: 'Email already registered' }, 409);
		}

		const passwordHash = await bcrypt.hash(password, 12);

		const [user] = await db
			.insert(users)
			.values({ email, passwordHash })
			.returning({ id: users.id });

		const accessToken = await createAccessToken(user.id);
		await issueRefreshToken(c, user.id, false);

		return c.json({ accessToken, user: { id: user.id, email } }, 201);
	},
);

// ── POST /api/auth/login ─────────────────────────────────────────────

auth.post(
	'/login',
	rateLimiter({ max: 10, windowMs: 60 * 1000 }),
	zValidator('json', loginSchema),
	async (c) => {
		const { email, password, rememberMe } = c.req.valid('json');

		const [user] = await db
			.select()
			.from(users)
			.where(eq(users.email, email))
			.limit(1);

		if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
			return c.json({ error: 'Invalid email or password' }, 401);
		}

		const accessToken = await createAccessToken(user.id);
		await issueRefreshToken(c, user.id, rememberMe);

		return c.json({
			accessToken,
			user: { id: user.id, email: user.email },
		});
	},
);

// ── POST /api/auth/refresh ───────────────────────────────────────────
// Silent refresh — the frontend calls this on startup and on 401 responses
// to transparently extend the session without forcing a re-login.

auth.post('/refresh', async (c) => {
	const token = getCookie(c, REFRESH_COOKIE_NAME);

	if (!token) {
		return c.json({ error: 'No refresh token' }, 401);
	}

	const tokenHash = hashToken(token);

	const [stored] = await db
		.select()
		.from(refreshTokens)
		.where(eq(refreshTokens.tokenHash, tokenHash))
		.limit(1);

	if (!stored || stored.expiresAt < new Date()) {
		// Clean up expired/invalid token
		deleteCookie(c, REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH });
		if (stored) {
			await db.delete(refreshTokens).where(eq(refreshTokens.id, stored.id));
		}
		return c.json({ error: 'Invalid or expired refresh token' }, 401);
	}

	// Rotate: delete old token, issue new one
	await db.delete(refreshTokens).where(eq(refreshTokens.id, stored.id));

	// Infer "remember me" from the original token's intended lifetime
	const originalLifetimeMs =
		stored.expiresAt.getTime() - stored.createdAt.getTime();
	const rememberMe = originalLifetimeMs > REFRESH_TOKEN_EXPIRY_SHORT * 1000;

	const accessToken = await createAccessToken(stored.userId);
	await issueRefreshToken(c, stored.userId, rememberMe);

	return c.json({ accessToken });
});

// ── POST /api/auth/logout ────────────────────────────────────────────

auth.post('/logout', async (c) => {
	const token = getCookie(c, REFRESH_COOKIE_NAME);

	if (token) {
		const tokenHash = hashToken(token);
		await db
			.delete(refreshTokens)
			.where(eq(refreshTokens.tokenHash, tokenHash));
		deleteCookie(c, REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH });
	}

	return c.json({ success: true });
});

export default auth;
