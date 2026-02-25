import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';
import { env } from './lib/env';
import { rateLimiter } from './middleware/rateLimiter';
import authRoutes from './routes/auth';
import budgetRoutes from './routes/budget';

const app = new Hono();

// ── Global middleware ────────────────────────────────────────────────

app.use('*', logger());
app.use('*', secureHeaders());
app.use(
	'*',
	cors({
		origin: env.CORS_ORIGIN,
		credentials: true,
		allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
		allowHeaders: ['Content-Type', 'Authorization'],
		maxAge: 86400,
	}),
);
app.use('*', rateLimiter({ max: 100, windowMs: 60 * 1000 }));

// ── Health check ─────────────────────────────────────────────────────

app.get('/api/health', (c) =>
	c.json({ status: 'ok', timestamp: new Date().toISOString() }),
);

// ── Routes ───────────────────────────────────────────────────────────

app.route('/api/auth', authRoutes);
app.route('/api/budget', budgetRoutes);

// ── Error handling ───────────────────────────────────────────────────

app.onError((err, c) => {
	console.error('Unhandled error:', err);
	return c.json(
		{
			error:
				env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
		},
		500,
	);
});

app.notFound((c) => c.json({ error: 'Not found' }, 404));

// ── Start server ─────────────────────────────────────────────────────

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
	console.log(`🚀 Budgeto API running on http://localhost:${info.port}`);
});

export default app;
