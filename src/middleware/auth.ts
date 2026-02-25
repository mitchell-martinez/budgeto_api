import { createMiddleware } from 'hono/factory';
import { verifyAccessToken } from '../lib/tokens';

type AuthEnv = {
	Variables: {
		userId: string;
	};
};

export const authMiddleware = createMiddleware<AuthEnv>(async (c, next) => {
	const authHeader = c.req.header('Authorization');

	if (!authHeader?.startsWith('Bearer ')) {
		return c.json({ error: 'Missing or invalid Authorization header' }, 401);
	}

	const token = authHeader.slice(7);

	try {
		const payload = await verifyAccessToken(token);
		c.set('userId', payload.sub);
		await next();
	} catch {
		return c.json({ error: 'Invalid or expired token' }, 401);
	}
});
