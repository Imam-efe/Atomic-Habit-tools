import type { Context, Next } from 'hono';
import type { Env, JWTPayload } from '../types';
import { verifyJWT } from '../lib/jwt';

export type AuthContext = {
  Variables: {
    user: JWTPayload;
  };
  Bindings: Env;
};

export async function requireAuth(
  c: Context<AuthContext>,
  next: Next
): Promise<void> {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    c.res = c.json({ error: 'unauthorized' }, 401);
    return;
  }

  const token = authHeader.slice(7);
  const payload = await verifyJWT(token, c.env.JWT_SECRET);

  if (!payload) {
    c.res = c.json({ error: 'invalid or expired token' }, 401);
    return;
  }

  c.set('user', payload as unknown as JWTPayload);
  await next();
}
