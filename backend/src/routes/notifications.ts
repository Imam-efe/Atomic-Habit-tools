import { Hono } from 'hono';
import { requireAuth, type AuthContext } from '../middleware/auth';
import { nanoid } from '../lib/nanoid';
import { sendPushToUser } from '../lib/push';

const notifications = new Hono<AuthContext>();

notifications.use('/*', requireAuth);

notifications.post('/subscribe', async (c) => {
  const user = c.get('user');
  type SubBody = { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  const body = await c.req.json<SubBody>().catch((): SubBody => ({}));

  if (!body.endpoint || !body.keys?.p256dh || !body.keys?.auth) {
    return c.json({ error: 'invalid subscription payload' }, 400);
  }

  const id = nanoid();
  const now = Math.floor(Date.now() / 1000);

  // Insert or update subscription
  await c.env.DB.prepare(`
    INSERT OR REPLACE INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, created_at)
    VALUES (
      COALESCE((SELECT id FROM push_subscriptions WHERE endpoint = ?3), ?1),
      ?2, ?3, ?4, ?5, ?6
    )
  `).bind(id, user.sub, body.endpoint, body.keys.p256dh, body.keys.auth, now).run();

  return c.json({ ok: true });
});

notifications.post('/test', async (c) => {
  const user = c.get('user');

  const result = await sendPushToUser(c.env, user.sub, {
    title: 'Fayolla Test Notifikasi',
    body: 'Hebat! Notifikasi berhasil diaktifkan di iPhone Anda! 🎉',
    url: '/',
  });

  if (result.subscriptions === 0) {
    return c.json({ error: 'no subscriptions found for this user' }, 400);
  }

  return c.json({ success: true, count: result.sent });
});

export default notifications;
