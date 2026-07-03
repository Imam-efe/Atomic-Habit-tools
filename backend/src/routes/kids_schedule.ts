import { Hono } from 'hono';
import type { KidScheduleRow } from '../types';
import { requireAuth, type AuthContext } from '../middleware/auth';
import { nanoid } from '../lib/nanoid';
import { validate } from '../lib/validate';

const kidsSchedule = new Hono<AuthContext>();

kidsSchedule.use('/*', requireAuth);

// GET /api/kids-schedule
kidsSchedule.get('/', async (c) => {
  const user = c.get('user');
  const rows = await c.env.DB.prepare(
    `SELECT * FROM kids_schedules WHERE user_id = ?1 ORDER BY day_of_week ASC, schedule_time ASC`
  ).bind(user.sub).all<KidScheduleRow>();

  return c.json(rows.results ?? []);
});

// POST /api/kids-schedule
kidsSchedule.post('/', async (c) => {
  const user = c.get('user');
  type Body = {
    kid_name?: string;
    title?: string;
    type?: string;
    day_of_week?: string;
    schedule_time?: string;
    schedule_date?: string;
    note?: string;
  };
  const body = await c.req.json<Body>().catch((): Body => ({}));

  const err = validate(body as Record<string, unknown>, {
    kid_name: { type: 'string' },
    title:    { type: 'string' },
  });
  if (err) return c.json({ error: err }, 400);

  const id = nanoid();
  const type = body.type ?? 'pelajaran';
  const dayOfWeek = body.day_of_week || null;
  const scheduleTime = body.schedule_time || null;
  const scheduleDate = body.schedule_date || null;
  const note = body.note || null;

  await c.env.DB.prepare(
    `INSERT INTO kids_schedules (id, user_id, kid_name, title, type, day_of_week, schedule_time, schedule_date, note)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`
  ).bind(id, user.sub, body.kid_name, body.title, type, dayOfWeek, scheduleTime, scheduleDate, note).run();

  return c.json({ id, kid_name: body.kid_name, title: body.title, type, day_of_week: dayOfWeek, schedule_time: scheduleTime, schedule_date: scheduleDate, note }, 201);
});

// PUT /api/kids-schedule/:id
kidsSchedule.put('/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  type Body = {
    kid_name?: string;
    title?: string;
    type?: string;
    day_of_week?: string;
    schedule_time?: string;
    schedule_date?: string;
    note?: string;
  };
  const body = await c.req.json<Body>().catch((): Body => ({}));

  const err = validate(body as Record<string, unknown>, {
    kid_name: { type: 'string' },
    title:    { type: 'string' },
  });
  if (err) return c.json({ error: err }, 400);

  const type = body.type ?? 'pelajaran';
  const dayOfWeek = body.day_of_week || null;
  const scheduleTime = body.schedule_time || null;
  const scheduleDate = body.schedule_date || null;
  const note = body.note || null;

  const res = await c.env.DB.prepare(
    `UPDATE kids_schedules
     SET kid_name = ?1, title = ?2, type = ?3, day_of_week = ?4, schedule_time = ?5, schedule_date = ?6, note = ?7
     WHERE id = ?8 AND user_id = ?9`
  ).bind(body.kid_name, body.title, type, dayOfWeek, scheduleTime, scheduleDate, note, id, user.sub).run();

  if (res.meta.changes === 0) return c.json({ error: 'schedule not found' }, 404);

  return c.json({ id, kid_name: body.kid_name, title: body.title, type, day_of_week: dayOfWeek, schedule_time: scheduleTime, schedule_date: scheduleDate, note });
});

// DELETE /api/kids-schedule/:id
kidsSchedule.delete('/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');

  const res = await c.env.DB.prepare(
    `DELETE FROM kids_schedules WHERE id = ?1 AND user_id = ?2`
  ).bind(id, user.sub).run();

  if (res.meta.changes === 0) return c.json({ error: 'schedule not found' }, 404);

  return c.json({ ok: true });
});

export default kidsSchedule;
