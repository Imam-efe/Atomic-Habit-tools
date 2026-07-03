import { Hono } from 'hono';
import { requireAuth, type AuthContext } from '../middleware/auth';
import { nanoid } from '../lib/nanoid';
import { validate } from '../lib/validate';

const activity = new Hono<AuthContext>();

activity.use('/*', requireAuth);

interface DBActivityLog {
  id: string;
  label: string;
  hours: number;
  log_date: string;
  created_at: number;
}

const LABELS = ['Deep Work', 'Shallow Work', 'Rest', 'Social', 'Health', 'Learning'];

// GET /api/activity?date=YYYY-MM-DD
activity.get('/', async (c) => {
  const user = c.get('user');
  const date = c.req.query('date') ?? new Date().toISOString().slice(0, 10);

  const rows = await c.env.DB.prepare(
    'SELECT * FROM activity_logs WHERE user_id = ?1 AND log_date = ?2 ORDER BY created_at ASC'
  ).bind(user.sub, date).all<DBActivityLog>();

  return c.json(rows.results ?? []);
});

// POST /api/activity
activity.post('/', async (c) => {
  const user = c.get('user');
  type ActivityBody = { label?: string; hours?: number; date?: string };
  const body = await c.req.json<ActivityBody>().catch((): ActivityBody => ({}));

  const err = validate(body as Record<string, unknown>, {
    label: { type: 'enum', values: LABELS },
    hours: { type: 'number', min: 0.01 },
  });
  if (err) return c.json({ error: err }, 400);

  const hours = body.hours!;

  const id = nanoid();
  const date = body.date ?? new Date().toISOString().slice(0, 10);
  const now = Math.floor(Date.now() / 1000);

  await c.env.DB.prepare(
    `INSERT INTO activity_logs (id, user_id, label, hours, log_date, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)`
  ).bind(id, user.sub, body.label, hours, date, now).run();

  return c.json({ id, label: body.label, hours, log_date: date }, 201);
});

// DELETE /api/activity/:id
activity.delete('/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');

  await c.env.DB.prepare('DELETE FROM activity_logs WHERE id = ?1 AND user_id = ?2').bind(id, user.sub).run();
  return c.json({ ok: true });
});

export default activity;
