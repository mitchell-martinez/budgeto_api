import { zValidator } from '@hono/zod-validator';
import bcrypt from 'bcryptjs';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { db } from '../db';
import { passwordResetTokens, refreshTokens, users } from '../db/schema';
import { env } from '../lib/env';
import
	{
		createAccessToken,
		generateRefreshToken,
		hashToken,
		REFRESH_TOKEN_EXPIRY_LONG,
		REFRESH_TOKEN_EXPIRY_SHORT
	} from '../lib/tokens';
import { authMiddleware } from '../middleware/auth';
import { rateLimiter } from '../middleware/rateLimiter';

const auth = new Hono<{
	Variables: { userId: string; isDemo: boolean };
}>();

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

const passwordResetRequestSchema = z.object({
	email: z
		.string()
		.email()
		.max(255)
		.transform((e) => e.toLowerCase().trim()),
});

const passwordResetConfirmSchema = z.object({
	token: z.string().min(20).max(256),
	newPassword: z.string().min(8).max(128),
});

const deleteAccountSchema = z.object({
	confirmEmail: z
		.string()
		.email()
		.max(255)
		.transform((e) => e.toLowerCase().trim()),
});

// ── Helpers ──────────────────────────────────────────────────────────

const REFRESH_COOKIE_NAME = 'refresh_token';
const REFRESH_COOKIE_PATH = '/api/auth';
const PASSWORD_RESET_EXPIRY_SECONDS = 15 * 60;

async function issueRefreshToken(
	context: Context,
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

	setCookie(context, REFRESH_COOKIE_NAME, token, {
		httpOnly: true,
		secure: env.NODE_ENV === 'production',
		sameSite: 'Strict',
		path: REFRESH_COOKIE_PATH,
		...(rememberMe ? { maxAge: expirySeconds } : {}),
	});
}

function generatePasswordResetToken(): string {
	return randomBytes(32).toString('base64url');
}

function hashOpaqueToken(token: string): string {
	return createHash('sha256').update(token).digest('hex');
}

// ── POST /api/auth/register ──────────────────────────────────────────

auth.post(
	'/register',
	rateLimiter({ max: 5, windowMs: 60 * 1000 }),
	zValidator('json', registerSchema),
	async (context) => {
		const { email, password } = context.req.valid('json');

		// Check if email is already taken
		const existing = await db
			.select({ id: users.id })
			.from(users)
			.where(eq(users.email, email))
			.limit(1);

		if (existing.length > 0) {
			return context.json({ error: 'Email already registered' }, 409);
		}

		const passwordHash = await bcrypt.hash(password, 12);

		const [user] = await db
			.insert(users)
			.values({ email, passwordHash })
			.returning({ id: users.id });

		const accessToken = await createAccessToken(user.id);
		await issueRefreshToken(context, user.id, false);

		return context.json({ accessToken, user: { id: user.id, email } }, 201);
	},
);

// ── POST /api/auth/login ─────────────────────────────────────────────

auth.post(
	'/login',
	rateLimiter({ max: 10, windowMs: 60 * 1000 }),
	zValidator('json', loginSchema),
	async (context) => {
		const { email, password, rememberMe } = context.req.valid('json');

		const [user] = await db
			.select()
			.from(users)
			.where(eq(users.email, email))
			.limit(1);

		if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
			return context.json({ error: 'Invalid email or password' }, 401);
		}

		const accessToken = await createAccessToken(user.id);
		await issueRefreshToken(context, user.id, rememberMe);

		return context.json({
			accessToken,
			user: { id: user.id, email: user.email },
		});
	},
);

// ── POST /api/auth/refresh ───────────────────────────────────────────
// Silent refresh — the frontend calls this on startup and on 401 responses
// to transparently extend the session without forcing a re-login.

auth.post('/refresh', async (context) => {
	const token = getCookie(context, REFRESH_COOKIE_NAME);

	if (!token) {
		return context.json({ error: 'No refresh token' }, 401);
	}

	const tokenHash = hashToken(token);

	const [stored] = await db
		.select()
		.from(refreshTokens)
		.where(eq(refreshTokens.tokenHash, tokenHash))
		.limit(1);

	if (!stored || stored.expiresAt < new Date()) {
		// Clean up expired/invalid token
		deleteCookie(context, REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH });
		if (stored) {
			await db.delete(refreshTokens).where(eq(refreshTokens.id, stored.id));
		}
		return context.json({ error: 'Invalid or expired refresh token' }, 401);
	}

	// Rotate: delete old token, issue new one
	await db.delete(refreshTokens).where(eq(refreshTokens.id, stored.id));

	// Infer "remember me" from the original token's intended lifetime
	const originalLifetimeMs =
		stored.expiresAt.getTime() - stored.createdAt.getTime();
	const rememberMe = originalLifetimeMs > REFRESH_TOKEN_EXPIRY_SHORT * 1000;

	const accessToken = await createAccessToken(stored.userId);
	await issueRefreshToken(context, stored.userId, rememberMe);

	return context.json({ accessToken });
});

// ── POST /api/auth/logout ────────────────────────────────────────────

auth.post('/logout', async (context) => {
	const token = getCookie(context, REFRESH_COOKIE_NAME);

	if (token) {
		const tokenHash = hashToken(token);
		await db
			.delete(refreshTokens)
			.where(eq(refreshTokens.tokenHash, tokenHash));
		deleteCookie(context, REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH });
	}

	return context.json({ success: true });
});

// ── POST /api/auth/password-reset/request ───────────────────────────

auth.post(
	'/password-reset/request',
	rateLimiter({ max: 5, windowMs: 60 * 1000 }),
	zValidator('json', passwordResetRequestSchema),
	async (context) => {
		const { email } = context.req.valid('json');

		const [user] = await db
			.select({ id: users.id, email: users.email })
			.from(users)
			.where(eq(users.email, email))
			.limit(1);

		if (!user) {
			return context.json({ success: true });
		}

		const token = generatePasswordResetToken();
		const tokenHash = hashOpaqueToken(token);
		const expiresAt = new Date(Date.now() + PASSWORD_RESET_EXPIRY_SECONDS * 1000);

		await db.insert(passwordResetTokens).values({
			userId: user.id,
			tokenHash,
			expiresAt,
		});

		if (env.NODE_ENV !== 'production') {
			return context.json({
				success: true,
				resetUrl: `http://localhost:5173/reset-password?token=${token}`,
			});
		}

		return context.json({ success: true });
	},
);

// ── POST /api/auth/password-reset/confirm ───────────────────────────

auth.post(
	'/password-reset/confirm',
	rateLimiter({ max: 10, windowMs: 60 * 1000 }),
	zValidator('json', passwordResetConfirmSchema),
	async (context) => {
		const { token, newPassword } = context.req.valid('json');
		const tokenHash = hashOpaqueToken(token);

		const [resetToken] = await db
			.select({
				id: passwordResetTokens.id,
				userId: passwordResetTokens.userId,
				expiresAt: passwordResetTokens.expiresAt,
			})
			.from(passwordResetTokens)
			.where(
				and(
					eq(passwordResetTokens.tokenHash, tokenHash),
					isNull(passwordResetTokens.usedAt),
					gt(passwordResetTokens.expiresAt, new Date()),
				),
			)
			.limit(1);

		if (!resetToken) {
			return context.json({ error: 'Invalid or expired reset token' }, 400);
		}

		const passwordHash = await bcrypt.hash(newPassword, 12);

		await db.transaction(async (tx) => {
			await tx
				.update(users)
				.set({ passwordHash })
				.where(eq(users.id, resetToken.userId));

			await tx
				.update(passwordResetTokens)
				.set({ usedAt: new Date() })
				.where(eq(passwordResetTokens.id, resetToken.id));

			await tx
				.delete(refreshTokens)
				.where(eq(refreshTokens.userId, resetToken.userId));
		});

		return context.json({ success: true });
	},
);

// ── GET /api/auth/me ─────────────────────────────────────────────────

auth.get('/me', authMiddleware, async (context) => {
	const userId = context.get('userId');

	const [user] = await db
		.select({ id: users.id, email: users.email })
		.from(users)
		.where(eq(users.id, userId))
		.limit(1);

	if (!user) {
		return context.json({ error: 'User not found' }, 404);
	}

	return context.json(user);
});

// ── DELETE /api/auth/account ────────────────────────────────────────

auth.delete(
	'/account',
	authMiddleware,
	zValidator('json', deleteAccountSchema),
	async (context) => {
		const userId = context.get('userId');
		const { confirmEmail } = context.req.valid('json');

		const [user] = await db
			.select({ id: users.id, email: users.email })
			.from(users)
			.where(eq(users.id, userId))
			.limit(1);

		if (!user) {
			return context.json({ error: 'User not found' }, 404);
		}

		if (user.email !== confirmEmail) {
			return context.json({ error: 'Confirmation email does not match account' }, 400);
		}

		await db.delete(users).where(eq(users.id, userId));
		deleteCookie(context, REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH });

		return context.json({ success: true });
	},
);

export default auth;
