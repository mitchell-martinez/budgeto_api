import { createMiddleware } from 'hono/factory';

type BucketEntry = {
	tokens: number;
	lastRefill: number;
};

const buckets = new Map<string, BucketEntry>();

// Clean up stale entries every 5 minutes
const cleanupInterval = setInterval(() => {
	const now = Date.now();
	for (const [key, entry] of buckets) {
		if (now - entry.lastRefill > 10 * 60 * 1000) {
			buckets.delete(key);
		}
	}
}, 5 * 60 * 1000);
cleanupInterval.unref(); // Don't prevent Node from exiting

/**
 * Simple in-memory token-bucket rate limiter.
 * Fine for a single-instance VPS — swap to Redis-backed if you scale out.
 */
export function rateLimiter(opts: { max: number; windowMs: number }) {
	const { max, windowMs } = opts;

	return createMiddleware(async (c, next) => {
		const ip =
			c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
			c.req.header('x-real-ip') ??
			'unknown';

		const now = Date.now();
		let bucket = buckets.get(ip);

		if (!bucket) {
			bucket = { tokens: max, lastRefill: now };
			buckets.set(ip, bucket);
		}

		// Refill tokens proportionally to elapsed time
		const elapsed = now - bucket.lastRefill;
		const refillRate = max / windowMs;
		bucket.tokens = Math.min(max, bucket.tokens + elapsed * refillRate);
		bucket.lastRefill = now;

		if (bucket.tokens < 1) {
			c.header('Retry-After', String(Math.ceil(windowMs / 1000)));
			return c.json({ error: 'Too many requests' }, 429);
		}

		bucket.tokens -= 1;
		await next();
	});
}
