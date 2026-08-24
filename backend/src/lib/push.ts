/**
 * push.ts — shared Web Push delivery + Shortcuts event queue.
 *
 * Every notification the system emits goes through here so it lands in two places:
 * an iOS Web Push message, and the `notification_events` queue that the iOS
 * Shortcut polls via GET /api/shortcut/notifications.
 */

import { buildPushPayload } from '@block65/webcrypto-web-push';
import type { Env } from '../types';
import { nanoid } from './nanoid';

export interface PushMessage {
  title: string;
  body: string;
  url?: string;
}

export interface PushResult {
  /** How many push subscriptions the user had when we tried */
  subscriptions: number;
  sent: number;
  failed: number;
}

function setUrgencyHigh(headers: unknown): void {
  if (!headers) return;
  if (typeof (headers as { set?: unknown }).set === 'function') {
    (headers as Headers).set('Urgency', 'high');
  } else {
    (headers as Record<string, string>)['Urgency'] = 'high';
  }
}

/**
 * Send a Web Push message to every device registered for a user.
 * Expired subscriptions (410/404) are pruned as a side effect.
 */
export async function sendPushToUser(
  env: Env,
  userId: string,
  message: PushMessage
): Promise<PushResult> {
  const subs = await env.DB.prepare(
    'SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?1'
  ).bind(userId).all<{ endpoint: string; p256dh: string; auth: string }>();

  const rows = subs.results ?? [];
  const result: PushResult = { subscriptions: rows.length, sent: 0, failed: 0 };
  if (rows.length === 0) return result;

  const vapid = {
    subject: env.VAPID_SUBJECT,
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY,
  };

  const payloadObj = {
    data: JSON.stringify({
      title: message.title,
      body: message.body,
      url: message.url ?? '/',
    }),
  };

  const deliveries = await Promise.allSettled(rows.map(async (row) => {
    const payload = await buildPushPayload(payloadObj, {
      endpoint: row.endpoint,
      expirationTime: null,
      keys: { p256dh: row.p256dh, auth: row.auth },
    }, vapid);
    setUrgencyHigh(payload.headers);

    const res = await fetch(row.endpoint, payload);
    if (!res.ok) {
      const expired = res.status === 410 || res.status === 404;
      throw Object.assign(new Error(`push failed: ${res.status}`), { endpoint: row.endpoint, expired });
    }
  }));

  const expiredEndpoints: string[] = [];
  for (const outcome of deliveries) {
    if (outcome.status === 'fulfilled') {
      result.sent++;
    } else {
      result.failed++;
      console.error('Push delivery failed', outcome.reason);
      const endpoint = (outcome.reason as { endpoint?: string; expired?: boolean })?.endpoint;
      if (endpoint && (outcome.reason as { expired?: boolean })?.expired) {
        expiredEndpoints.push(endpoint);
      }
    }
  }

  if (expiredEndpoints.length > 0) {
    await env.DB.batch(
      expiredEndpoints.map((endpoint) =>
        env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?1').bind(endpoint)
      )
    );
  }

  return result;
}

/**
 * Queue a notification event so external consumers (the iOS Shortcut) can poll it.
 * Never throws — a queue failure must not block the push itself.
 */
export async function queueNotificationEvent(
  env: Env,
  userId: string,
  type: string,
  title: string,
  body: string,
  payload?: Record<string, unknown>
): Promise<void> {
  try {
    await env.DB.prepare(`
      INSERT INTO notification_events (id, user_id, type, title, body, payload)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6)
    `).bind(
      nanoid(),
      userId,
      type,
      title,
      body,
      payload ? JSON.stringify(payload) : null
    ).run();
  } catch (err) {
    console.error('Failed to queue notification event', err);
  }
}
