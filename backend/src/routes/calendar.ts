import { Hono } from 'hono';
import type { Context } from 'hono';
import { requireAuth, type AuthContext } from '../middleware/auth';
import { nanoid } from '../lib/nanoid';
import { validate } from '../lib/validate';

const calendar = new Hono<AuthContext>();

calendar.use('/*', requireAuth);

const KINDS = ['task', 'event', 'reminder', 'milestone'] as const;
const PRIORITIES = ['low', 'normal', 'high'] as const;
const REPEATS = ['none', 'daily', 'weekly', 'monthly', 'yearly'] as const;

export interface CalendarRow {
  id: string;
  title: string;
  note: string | null;
  kind: string;
  event_date: string;
  event_time: string | null;
  end_time: string | null;
  priority: string;
  color: string | null;
  is_done: number;
  repeat_rule: string;
  repeat_until: string | null;
  remind_minutes_before: number | null;
}

/** An expanded occurrence. `id` stays the parent's; `date` is this instance. */
interface Occurrence extends CalendarRow {
  date: string;
  /** True when this is a generated repeat, not the stored first occurrence. */
  is_repeat: boolean;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
}

function parts(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  return { y, m, d };
}

/**
 * Does a repeating row fall on `target`?
 *
 * Monthly and yearly rules are matched on the day-of-month rather than by
 * stepping dates, so an entry on the 31st simply does not occur in a month that
 * has no 31st — which is the behaviour people expect from a reminder, and
 * avoids silently sliding it to the 1st.
 */
export function occursOn(row: CalendarRow, target: string): boolean {
  if (target < row.event_date) return false;
  if (row.repeat_until && target > row.repeat_until) return false;

  const start = parts(row.event_date);
  const t = parts(target);

  switch (row.repeat_rule) {
    case 'daily':
      return true;
    case 'weekly':
      return daysBetween(row.event_date, target) % 7 === 0;
    case 'monthly':
      return t.d === start.d;
    case 'yearly':
      return t.d === start.d && t.m === start.m;
    default:
      return target === row.event_date;
  }
}

/** Expands stored rows into per-date occurrences across [from, to]. */
function expand(rows: CalendarRow[], from: string, to: string): Occurrence[] {
  const out: Occurrence[] = [];
  for (const row of rows) {
    if (row.repeat_rule === 'none') {
      if (row.event_date >= from && row.event_date <= to) {
        out.push({ ...row, date: row.event_date, is_repeat: false });
      }
      continue;
    }
    for (let cur = from; cur <= to; ) {
      if (occursOn(row, cur)) {
        out.push({ ...row, date: cur, is_repeat: cur !== row.event_date });
      }
      const d = new Date(cur + 'T00:00:00Z');
      d.setUTCDate(d.getUTCDate() + 1);
      cur = d.toISOString().slice(0, 10);
    }
  }
  return out.sort((a, b) =>
    a.date.localeCompare(b.date) || (a.event_time ?? '99:99').localeCompare(b.event_time ?? '99:99')
  );
}

async function loadRange(c: Context<AuthContext>, userId: string, from: string, to: string): Promise<Occurrence[]> {
  // Non-repeating rows are filtered in SQL; repeating ones have to come back
  // whatever their start date, since a yearly entry from years ago still lands
  // in this range.
  const res = await c.env.DB.prepare(
    `SELECT id, title, note, kind, event_date, event_time, end_time, priority, color,
            is_done, repeat_rule, repeat_until, remind_minutes_before
       FROM calendar_events
      WHERE user_id = ?1
        AND (repeat_rule != 'none' OR (event_date >= ?2 AND event_date <= ?3))`
  ).bind(userId, from, to).all<CalendarRow>();

  return expand(res.results ?? [], from, to);
}

// GET /api/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD
calendar.get('/', async (c) => {
  const user = c.get('user');
  const from = c.req.query('from');
  const to = c.req.query('to');
  if (!from || !to || !ISO.test(from) || !ISO.test(to)) {
    return c.json({ error: 'from and to are required as YYYY-MM-DD' }, 400);
  }
  if (to < from) return c.json({ error: 'to must not be before from' }, 400);
  // A month view asks for ~42 days; anything far beyond that is a mistake and
  // would expand repeats into a very large array.
  if (daysBetween(from, to) > 400) {
    return c.json({ error: 'range must be 400 days or less' }, 400);
  }

  return c.json(await loadRange(c, user.sub, from, to));
});

// POST /api/calendar
calendar.post('/', async (c) => {
  const user = c.get('user');
  type Body = {
    title?: string;
    note?: string;
    kind?: string;
    event_date?: string;
    event_time?: string;
    end_time?: string;
    priority?: string;
    color?: string;
    repeat_rule?: string;
    repeat_until?: string;
    remind_minutes_before?: number;
  };
  const body = await c.req.json<Body>().catch((): Body => ({}));

  const err = validate(body as Record<string, unknown>, {
    title: { type: 'string' },
    event_date: { type: 'date' },
  });
  if (err) return c.json({ error: err }, 400);

  const kind = KINDS.includes(body.kind as any) ? body.kind! : 'task';
  const priority = PRIORITIES.includes(body.priority as any) ? body.priority! : 'normal';
  const repeat = REPEATS.includes(body.repeat_rule as any) ? body.repeat_rule! : 'none';
  const repeatUntil = body.repeat_until && ISO.test(body.repeat_until) ? body.repeat_until : null;

  if (repeatUntil && repeatUntil < body.event_date!) {
    return c.json({ error: 'repeat_until must not be before event_date' }, 400);
  }

  const id = nanoid();
  const row = {
    id,
    title: body.title!.trim(),
    note: body.note?.trim() || null,
    kind,
    event_date: body.event_date!,
    event_time: body.event_time || null,
    end_time: body.end_time || null,
    priority,
    color: body.color || null,
    is_done: 0,
    repeat_rule: repeat,
    repeat_until: repeatUntil,
    remind_minutes_before: body.remind_minutes_before ?? null,
  };

  await c.env.DB.prepare(
    `INSERT INTO calendar_events
       (id, user_id, title, note, kind, event_date, event_time, end_time, priority,
        color, repeat_rule, repeat_until, remind_minutes_before)
     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)`
  ).bind(
    id, user.sub, row.title, row.note, row.kind, row.event_date, row.event_time,
    row.end_time, row.priority, row.color, row.repeat_rule, row.repeat_until,
    row.remind_minutes_before
  ).run();

  return c.json({ ...row, date: row.event_date, is_repeat: false }, 201);
});

// PUT /api/calendar/:id
calendar.put('/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  type Body = Record<string, unknown>;
  const body = await c.req.json<Body>().catch((): Body => ({}));

  const existing = await c.env.DB.prepare(
    `SELECT * FROM calendar_events WHERE id = ?1 AND user_id = ?2`
  ).bind(id, user.sub).first<CalendarRow>();
  if (!existing) return c.json({ error: 'not found' }, 404);

  const str = (k: string, fallback: string | null) => {
    const v = body[k];
    if (v === undefined) return fallback;
    if (v === null || v === '') return null;
    return typeof v === 'string' ? v.trim() : fallback;
  };
  const oneOf = (k: string, allowed: readonly string[], fallback: string) => {
    const v = body[k];
    return typeof v === 'string' && allowed.includes(v) ? v : fallback;
  };

  const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : existing.title;
  const eventDate = typeof body.event_date === 'string' && ISO.test(body.event_date)
    ? body.event_date : existing.event_date;
  const repeatUntil = body.repeat_until === undefined
    ? existing.repeat_until
    : (typeof body.repeat_until === 'string' && ISO.test(body.repeat_until) ? body.repeat_until : null);

  if (repeatUntil && repeatUntil < eventDate) {
    return c.json({ error: 'repeat_until must not be before event_date' }, 400);
  }

  const next = {
    title,
    note: str('note', existing.note),
    kind: oneOf('kind', KINDS, existing.kind),
    event_date: eventDate,
    event_time: str('event_time', existing.event_time),
    end_time: str('end_time', existing.end_time),
    priority: oneOf('priority', PRIORITIES, existing.priority),
    color: str('color', existing.color),
    repeat_rule: oneOf('repeat_rule', REPEATS, existing.repeat_rule),
    repeat_until: repeatUntil,
    remind_minutes_before: body.remind_minutes_before === undefined
      ? existing.remind_minutes_before
      : (typeof body.remind_minutes_before === 'number' ? body.remind_minutes_before : null),
  };

  await c.env.DB.prepare(
    `UPDATE calendar_events
        SET title=?1, note=?2, kind=?3, event_date=?4, event_time=?5, end_time=?6,
            priority=?7, color=?8, repeat_rule=?9, repeat_until=?10,
            remind_minutes_before=?11, updated_at=unixepoch()
      WHERE id=?12 AND user_id=?13`
  ).bind(
    next.title, next.note, next.kind, next.event_date, next.event_time, next.end_time,
    next.priority, next.color, next.repeat_rule, next.repeat_until,
    next.remind_minutes_before, id, user.sub
  ).run();

  return c.json({ id, ...next, is_done: existing.is_done, date: next.event_date, is_repeat: false });
});

// POST /api/calendar/:id/toggle — mark a task done or undone
calendar.post('/:id/toggle', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');

  const existing = await c.env.DB.prepare(
    `SELECT is_done FROM calendar_events WHERE id = ?1 AND user_id = ?2`
  ).bind(id, user.sub).first<{ is_done: number }>();
  if (!existing) return c.json({ error: 'not found' }, 404);

  const isDone = existing.is_done ? 0 : 1;
  await c.env.DB.prepare(
    `UPDATE calendar_events
        SET is_done = ?1, done_at = ?2, updated_at = unixepoch()
      WHERE id = ?3 AND user_id = ?4`
  ).bind(isDone, isDone ? Math.floor(Date.now() / 1000) : null, id, user.sub).run();

  return c.json({ id, is_done: isDone });
});

// DELETE /api/calendar/:id
calendar.delete('/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  await c.env.DB.prepare(
    `DELETE FROM calendar_events WHERE id = ?1 AND user_id = ?2`
  ).bind(id, user.sub).run();
  return c.json({ success: true });
});

/**
 * GET /api/calendar/agenda?date=YYYY-MM-DD
 *
 * Everything already scheduled for one day, gathered from the modules that own
 * it. The point of the calendar is that a due debt, an expiring item and a
 * child's class are all "things happening on the 24th" even though each lives
 * in its own table — without this the user has to check five screens.
 *
 * Read-only and best-effort: a module that fails to query is omitted rather
 * than failing the whole day.
 */
calendar.get('/agenda', async (c) => {
  const user = c.get('user');
  const date = c.req.query('date');
  if (!date || !ISO.test(date)) return c.json({ error: 'date is required as YYYY-MM-DD' }, 400);

  // 1=Mon..7=Sun, matching the rest of the schema.
  const jsDay = new Date(date + 'T00:00:00Z').getUTCDay();
  const isoDow = jsDay === 0 ? 7 : jsDay;
  const dayNames = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu'];
  const dayName = dayNames[isoDow - 1];

  const items: {
    source: string;
    id: string;
    title: string;
    detail?: string | null;
    time?: string | null;
  }[] = [];

  const safe = async (fn: () => Promise<void>) => { try { await fn(); } catch { /* module omitted */ } };

  await safe(async () => {
    const r = await c.env.DB.prepare(
      `SELECT id, person_name, amount_idr, type FROM debts
        WHERE user_id = ?1 AND due_date = ?2 AND status != 'paid'`
    ).bind(user.sub, date).all<{ id: string; person_name: string; amount_idr: number; type: string }>();
    for (const d of r.results ?? []) {
      items.push({
        source: 'debt',
        id: d.id,
        title: d.type === 'debt' ? `Bayar utang ke ${d.person_name}` : `Tagih piutang ${d.person_name}`,
        detail: `Rp${d.amount_idr.toLocaleString('id-ID')}`,
      });
    }
  });

  await safe(async () => {
    const r = await c.env.DB.prepare(
      `SELECT id, amount_idr, note FROM debt_payments
        WHERE user_id = ?1 AND payment_date = ?2 AND status = 'scheduled'`
    ).bind(user.sub, date).all<{ id: string; amount_idr: number; note: string | null }>();
    for (const p of r.results ?? []) {
      items.push({
        source: 'debt_payment',
        id: p.id,
        title: 'Jadwal pelunasan utang',
        detail: `Rp${p.amount_idr.toLocaleString('id-ID')}${p.note ? ` · ${p.note}` : ''}`,
      });
    }
  });

  await safe(async () => {
    const r = await c.env.DB.prepare(
      `SELECT id, name, quantity, unit FROM inventory_items
        WHERE user_id = ?1 AND expiry_date = ?2`
    ).bind(user.sub, date).all<{ id: string; name: string; quantity: number; unit: string }>();
    for (const i of r.results ?? []) {
      items.push({ source: 'inventory', id: i.id, title: `${i.name} kedaluwarsa`, detail: `${i.quantity} ${i.unit}` });
    }
  });

  await safe(async () => {
    const r = await c.env.DB.prepare(
      `SELECT id, kid_name, title, schedule_time FROM kids_schedules
        WHERE user_id = ?1 AND (schedule_date = ?2 OR day_of_week = ?3)`
    ).bind(user.sub, date, dayName).all<{ id: string; kid_name: string; title: string; schedule_time: string | null }>();
    for (const k of r.results ?? []) {
      items.push({ source: 'kids', id: k.id, title: `${k.kid_name}: ${k.title}`, time: k.schedule_time });
    }
  });

  // Habits carry a time of day but no date — they recur daily, so they belong
  // on every day's agenda rather than being matched against one.
  await safe(async () => {
    const r = await c.env.DB.prepare(
      `SELECT id, name, action_time FROM habits
        WHERE user_id = ?1 AND action_time IS NOT NULL AND action_time != ''
        ORDER BY action_time`
    ).bind(user.sub).all<{ id: string; name: string; action_time: string }>();
    for (const h of r.results ?? []) {
      items.push({ source: 'habit', id: h.id, title: h.name, time: h.action_time });
    }
  });

  items.sort((a, b) => (a.time ?? '99:99').localeCompare(b.time ?? '99:99'));
  return c.json({ date, items });
});

export default calendar;
