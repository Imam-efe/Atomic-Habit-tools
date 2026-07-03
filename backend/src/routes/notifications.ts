import { Hono } from 'hono';
import { requireAuth, type AuthContext } from '../middleware/auth';
import { nanoid } from '../lib/nanoid';
import { buildPushPayload } from '@block65/webcrypto-web-push';

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

  const subs = await c.env.DB.prepare(
    'SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?1'
  ).bind(user.sub).all<{ endpoint: string; p256dh: string; auth: string }>();

  const results = subs.results ?? [];
  if (results.length === 0) {
    return c.json({ error: 'no subscriptions found for this user' }, 400);
  }

  const vapid = {
    subject: c.env.VAPID_SUBJECT,
    publicKey: c.env.VAPID_PUBLIC_KEY,
    privateKey: c.env.VAPID_PRIVATE_KEY,
  };

  const payloadObj = {
    data: JSON.stringify({
      title: 'Fayolla Test Notifikasi',
      body: 'Hebat! Notifikasi berhasil diaktifkan di iPhone Anda! 🎉',
      url: '/',
    })
  };

  let successCount = 0;
  for (const row of results) {
    try {
      const subscription = {
        endpoint: row.endpoint,
        expirationTime: null,
        keys: {
          p256dh: row.p256dh,
          auth: row.auth,
        },
      };
      const payload = await buildPushPayload(payloadObj, subscription, vapid);
      if (payload.headers) {
        if (typeof (payload.headers as any).set === 'function') {
          (payload.headers as any).set('Urgency', 'high');
        } else {
          (payload.headers as any)['Urgency'] = 'high';
        }
      }
      const res = await fetch(row.endpoint, payload);
      if (res.ok) {
        successCount++;
      } else if (res.status === 410 || res.status === 404) {
        await c.env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?1').bind(row.endpoint).run();
      }
    } catch (err) {
      console.error('Test notification failed', err);
    }
  }

  return c.json({ success: true, count: successCount });
});

export default notifications;
