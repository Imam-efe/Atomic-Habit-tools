import { Hono } from 'hono';
import { requireAuth, type AuthContext } from '../middleware/auth';
import { nanoid } from '../lib/nanoid';
import { validate } from '../lib/validate';

const menstrual = new Hono<AuthContext>();

menstrual.use('/*', requireAuth);

menstrual.get('/', async (c) => {
  const user = c.get('user');

  let settings = await c.env.DB.prepare(
    'SELECT cycle_length, period_length FROM menstrual_settings WHERE user_id = ?1'
  ).bind(user.sub).first<{ cycle_length: number; period_length: number }>();

  if (!settings) {
    settings = { cycle_length: 28, period_length: 5 };
  }

  const logs = await c.env.DB.prepare(
    'SELECT id, start_date, end_date, notes FROM menstrual_logs WHERE user_id = ?1 ORDER BY start_date DESC'
  ).bind(user.sub).all<{ id: string; start_date: string; end_date: string | null; notes: string | null }>();

  return c.json({
    settings: {
      cycleLength: settings.cycle_length,
      periodLength: settings.period_length,
    },
    logs: (logs.results ?? []).map(l => ({
      id: l.id,
      startDate: l.start_date,
      endDate: l.end_date,
      notes: l.notes,
    }))
  });
});

menstrual.post('/logs', async (c) => {
  const user = c.get('user');
  type LogBody = { startDate?: string; endDate?: string; notes?: string };
  const body = await c.req.json<LogBody>().catch((): LogBody => ({}));

  const err = validate(body as Record<string, unknown>, { startDate: { type: 'date' } });
  if (err) return c.json({ error: err }, 400);

  const id = nanoid();
  const now = Math.floor(Date.now() / 1000);

  await c.env.DB.prepare(`
    INSERT INTO menstrual_logs (id, user_id, start_date, end_date, notes, created_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6)
  `).bind(
    id, user.sub,
    body.startDate,
    body.endDate || null,
    body.notes || null,
    now
  ).run();

  return c.json({ id, startDate: body.startDate, endDate: body.endDate || null, notes: body.notes || null }, 201);
});

menstrual.delete('/logs/:id', async (c) => {
  const user = c.get('user');
  const logId = c.req.param('id');

  await c.env.DB.prepare(
    'DELETE FROM menstrual_logs WHERE id = ?1 AND user_id = ?2'
  ).bind(logId, user.sub).run();

  return c.json({ ok: true });
});

menstrual.post('/settings', async (c) => {
  const user = c.get('user');
  type SettingsBody = { cycleLength?: number; periodLength?: number };
  const body = await c.req.json<SettingsBody>().catch((): SettingsBody => ({}));

  const cycleLength = body.cycleLength || 28;
  const periodLength = body.periodLength || 5;
  const now = Math.floor(Date.now() / 1000);

  await c.env.DB.prepare(`
    INSERT OR REPLACE INTO menstrual_settings (user_id, cycle_length, period_length, updated_at)
    VALUES (?1, ?2, ?3, ?4)
  `).bind(user.sub, cycleLength, periodLength, now).run();

  return c.json({ cycleLength, periodLength });
});

export default menstrual;
