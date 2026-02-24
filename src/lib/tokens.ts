import { sign, verify } from 'hono/jwt';
import { randomBytes, createHash } from 'node:crypto';
import { env } from './env';

const ACCESS_TOKEN_EXPIRY = 15 * 60; // 15 minutes

/** "Keep me signed in" unchecked — session-length refresh (24 h) */
export const REFRESH_TOKEN_EXPIRY_SHORT = 24 * 60 * 60; // 24 hours

/** "Keep me signed in" checked — long-lived refresh (30 days) */
export const REFRESH_TOKEN_EXPIRY_LONG = 30 * 24 * 60 * 60; // 30 days

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

export async function verifyAccessToken(
  token: string,
): Promise<{ sub: string }> {
  const payload = await verify(token, env.JWT_SECRET);
  return payload as { sub: string };
}

// ── Refresh tokens (opaque, hashed for storage) ─────────────────────

export function generateRefreshToken(): string {
  return randomBytes(48).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
