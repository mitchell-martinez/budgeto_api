import { sign, verify } from 'hono/jwt';
import { createHash, randomBytes } from 'node:crypto';
import { env } from './env';

const ACCESS_TOKEN_EXPIRY = 15 * 60; // 15 minutes

/** "Keep me signed in" unchecked — session-length refresh (24 h) */
export const REFRESH_TOKEN_EXPIRY_SHORT = 24 * 60 * 60; // 24 hours

/** "Keep me signed in" checked — long-lived refresh (30 days) */
export const REFRESH_TOKEN_EXPIRY_LONG = 30 * 24 * 60 * 60; // 30 days

/** Demo sessions expire after 1 hour */
export const DEMO_TOKEN_EXPIRY = 60 * 60; // 1 hour

// ── Access tokens (JWT) ──────────────────────────────────────────────

export async function createAccessToken(userId: string): Promise<string> {
	const now = Math.floor(Date.now() / 1000);
	return sign(
		{
			sub: userId,
			iat: now,
			exp: now + ACCESS_TOKEN_EXPIRY,
		},
		env.JWT_SECRET,
	);
}

/**
 * Creates a short-lived demo access token.
 * The `demo: true` claim signals that the bearer is an unauthenticated
 * visitor trying the app — budget writes are rejected and only static
 * demo data is returned.
 */
export async function createDemoToken(): Promise<string> {
	const now = Math.floor(Date.now() / 1000);
	return sign(
		{
			sub: 'demo',
			demo: true,
			iat: now,
			exp: now + DEMO_TOKEN_EXPIRY,
		},
		env.JWT_SECRET,
	);
}

export async function verifyAccessToken(
	token: string,
): Promise<{ sub: string; demo?: boolean }> {
	const payload = await verify(token, env.JWT_SECRET, 'HS256');
	return payload as { sub: string; demo?: boolean };
}

// ── Refresh tokens (opaque, hashed for storage) ─────────────────────

export function generateRefreshToken(): string {
	return randomBytes(48).toString('base64url');
}

export function hashToken(token: string): string {
	return createHash('sha256').update(token).digest('hex');
}
