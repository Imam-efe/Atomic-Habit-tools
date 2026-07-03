import { Hono } from 'hono';
import type { Env, JWTPayload, UserRow } from '../types';
import { signJWT, verifyJWT } from '../lib/jwt';
import { nanoid, generateRefreshToken, hashToken } from '../lib/nanoid';
import { validate } from '../lib/validate';

type AuthEnv = { Bindings: Env };

const auth = new Hono<AuthEnv>();

const ACCESS_TOKEN_TTL = 15 * 60; // 15 min
const REFRESH_TOKEN_TTL = 30 * 24 * 60 * 60; // 30 days

auth.post('/login', async (c) => {
  const body = await c.req.json<{ name?: string; role?: string }>().catch(() => ({} as { name?: string; role?: string }));
  const rawName = (body.name ?? '').trim();
  const err = validate({ name: rawName }, { name: { type: 'string', min: 2 } });
  if (err) return c.json({ error: err }, 400);

  let user = await c.env.DB.prepare(
    'SELECT id, name, role, accent, theme FROM users WHERE lower(name) = lower(?1)'
  ).bind(rawName).first<UserRow>();

  if (!user) {
    const now = Math.floor(Date.now() / 1000);
    const id = nanoid();
    const role = body.role === 'admin' ? 'admin' : 'user';
    const email = `${id}@fayolla.local`;
    await c.env.DB.prepare(
      'INSERT INTO users (id, email, name, role, accent, theme, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)'
    ).bind(id, email, rawName, role, 'violet', 'dark', now).run();
    user = { id, name: rawName, role, accent: 'violet', theme: 'dark', created_at: now };
  }

  const now = Math.floor(Date.now() / 1000);
  const payload: JWTPayload = {
    sub: user.id,
    name: user.name,
    role: user.role,
    iat: now,
    exp: now + ACCESS_TOKEN_TTL,
  };
  const accessToken = await signJWT(payload as unknown as Record<string, unknown>, c.env.JWT_SECRET);

  const rawRefresh = generateRefreshToken();
  const hashed = await hashToken(rawRefresh);
  await c.env.DB.prepare(
    'INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, created_at) VALUES (?1, ?2, ?3, ?4, ?5)'
  ).bind(nanoid(), user.id, hashed, now + REFRESH_TOKEN_TTL, now).run();

  return c.json({
    access_token: accessToken,
    refresh_token: rawRefresh,
    user: { id: user.id, name: user.name, role: user.role, accent: user.accent, theme: user.theme },
  });
});

auth.post('/refresh', async (c) => {
  const body = await c.req.json<{ refresh_token?: string }>().catch(() => ({} as { refresh_token?: string }));
  const raw = body.refresh_token ?? '';
  if (!raw) return c.json({ error: 'missing refresh_token' }, 400);

  const hashed = await hashToken(raw);
  const now = Math.floor(Date.now() / 1000);

  const tokenRow = await c.env.DB.prepare(
    'SELECT id, user_id, expires_at FROM refresh_tokens WHERE token_hash = ?1 AND revoked = 0'
  ).bind(hashed).first<{ id: string; user_id: string; expires_at: number }>();

  if (!tokenRow || tokenRow.expires_at <= now) {
    return c.json({ error: 'invalid or expired refresh token' }, 401);
  }

  const user = await c.env.DB.prepare(
    'SELECT id, name, role, accent, theme FROM users WHERE id = ?1'
  ).bind(tokenRow.user_id).first<UserRow>();

  if (!user) return c.json({ error: 'user not found' }, 401);

  // rotate: revoke old, issue new
  const newRaw = generateRefreshToken();
  const newHashed = await hashToken(newRaw);
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE id = ?1').bind(tokenRow.id),
    c.env.DB.prepare(
      'INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, created_at) VALUES (?1, ?2, ?3, ?4, ?5)'
    ).bind(nanoid(), user.id, newHashed, now + REFRESH_TOKEN_TTL, now),
  ]);

  const payload: JWTPayload = {
    sub: user.id,
    name: user.name,
    role: user.role,
    iat: now,
    exp: now + ACCESS_TOKEN_TTL,
  };
  const accessToken = await signJWT(payload as unknown as Record<string, unknown>, c.env.JWT_SECRET);

  return c.json({
    access_token: accessToken,
    refresh_token: newRaw,
    user: { id: user.id, name: user.name, role: user.role, accent: user.accent, theme: user.theme },
  });
});

auth.post('/logout', async (c) => {
  const body = await c.req.json<{ refresh_token?: string }>().catch(() => ({} as { refresh_token?: string }));
  const raw = body.refresh_token ?? '';
  if (raw) {
    const hashed = await hashToken(raw);
    await c.env.DB.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE token_hash = ?1').bind(hashed).run();
  }
  return c.json({ ok: true });
});

auth.get('/me', async (c) => {
  const authHeader = c.req.header('Authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) return c.json({ error: 'unauthorized' }, 401);

  const payload = await verifyJWT(token, c.env.JWT_SECRET);
  if (!payload) return c.json({ error: 'unauthorized' }, 401);

  const user = await c.env.DB.prepare(
    'SELECT id, name, role, accent, theme FROM users WHERE id = ?1'
  ).bind(payload['sub']).first<UserRow>();

  if (!user) return c.json({ error: 'user not found' }, 404);
  return c.json({ id: user.id, name: user.name, role: user.role, accent: user.accent, theme: user.theme });
});

auth.put('/profile', async (c) => {
  const authHeader = c.req.header('Authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) return c.json({ error: 'unauthorized' }, 401);

  const payload = await verifyJWT(token, c.env.JWT_SECRET);
  if (!payload) return c.json({ error: 'unauthorized' }, 401);

  type ProfileBody = { accent?: string; theme?: string };
  const body = await c.req.json<ProfileBody>().catch((): ProfileBody => ({}));

  if (!body.accent && !body.theme) {
    return c.json({ error: 'accent or theme required' }, 400);
  }

  const userId = payload['sub'] as string;

  if (body.accent && body.theme) {
    await c.env.DB.prepare('UPDATE users SET accent = ?1, theme = ?2 WHERE id = ?3')
      .bind(body.accent, body.theme, userId).run();
  } else if (body.accent) {
    await c.env.DB.prepare('UPDATE users SET accent = ?1 WHERE id = ?2')
      .bind(body.accent, userId).run();
  } else if (body.theme) {
    await c.env.DB.prepare('UPDATE users SET theme = ?1 WHERE id = ?2')
      .bind(body.theme, userId).run();
  }

  return c.json({ ok: true });
});

export default auth;
