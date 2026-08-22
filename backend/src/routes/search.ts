import { Hono } from 'hono';
import { requireAuth, type AuthContext } from '../middleware/auth';

const search = new Hono<AuthContext>();
search.use('/*', requireAuth);

/**
 * One query across every module.
 *
 * The app has twenty screens and no way to answer "kapan aku beli beras?"
 * without opening Inventory and scrolling. Each source contributes a small
 * capped slice, and every hit carries the navigation target the frontend
 * needs to jump straight to the screen holding it.
 */

export interface SearchHit {
  type: string;
  label: string;
  id: string;
  title: string;
  subtitle: string | null;
  date: string | null;
  /** Tab name, or a sub-screen key the shell can push. */
  tab?: string;
  subScreen?: string;
}

const PER_SOURCE = 6;

/**
 * `%` and `_` are wildcards in LIKE, so a user searching for "50%" would
 * otherwise match everything. ESCAPE '\' is declared on each query below.
 */
function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, ch => `\\${ch}`)}%`;
}

// GET /api/search?q=beras
search.get('/', async (c) => {
  const user = c.get('user');
  const q = (c.req.query('q') ?? '').trim();

  // One character matches half the database and is never a real search.
  if (q.length < 2) return c.json({ query: q, hits: [] });

  const p = likePattern(q);
  const uid = user.sub;

  const [budget, inventory, habits, goals, projects, tasks, kids, debts, events] = await Promise.all([
    c.env.DB.prepare(
      `SELECT id, type, amount_idr, category, note, entry_date FROM budget_entries
       WHERE user_id = ?1 AND (note LIKE ?2 ESCAPE '\\' OR category LIKE ?2 ESCAPE '\\')
       ORDER BY entry_date DESC LIMIT ?3`
    ).bind(uid, p, PER_SOURCE).all<{
      id: string; type: string; amount_idr: number; category: string; note: string | null; entry_date: string;
    }>(),

    c.env.DB.prepare(
      `SELECT id, name, quantity, unit, category, expiry_date FROM inventory_items
       WHERE user_id = ?1 AND (name LIKE ?2 ESCAPE '\\' OR note LIKE ?2 ESCAPE '\\' OR category LIKE ?2 ESCAPE '\\')
       ORDER BY name ASC LIMIT ?3`
    ).bind(uid, p, PER_SOURCE).all<{
      id: string; name: string; quantity: number; unit: string; category: string; expiry_date: string | null;
    }>(),

    c.env.DB.prepare(
      `SELECT id, name, streak, trigger_cue FROM habits
       WHERE user_id = ?1 AND (name LIKE ?2 ESCAPE '\\' OR trigger_cue LIKE ?2 ESCAPE '\\' OR two_min LIKE ?2 ESCAPE '\\')
       ORDER BY sort_order ASC LIMIT ?3`
    ).bind(uid, p, PER_SOURCE).all<{
      id: string; name: string; streak: number; trigger_cue: string | null;
    }>(),

    c.env.DB.prepare(
      `SELECT id, identity_statement FROM goals
       WHERE user_id = ?1 AND identity_statement LIKE ?2 ESCAPE '\\'
       ORDER BY sort_order ASC LIMIT ?3`
    ).bind(uid, p, PER_SOURCE).all<{ id: string; identity_statement: string }>(),

    c.env.DB.prepare(
      `SELECT id, name FROM projects
       WHERE user_id = ?1 AND name LIKE ?2 ESCAPE '\\'
       ORDER BY created_at DESC LIMIT ?3`
    ).bind(uid, p, PER_SOURCE).all<{ id: string; name: string }>(),

    c.env.DB.prepare(
      `SELECT t.id, t.name, t.status, p.name AS project_name FROM tasks t
       LEFT JOIN projects p ON p.id = t.project_id
       WHERE t.user_id = ?1 AND t.name LIKE ?2 ESCAPE '\\'
       ORDER BY t.created_at DESC LIMIT ?3`
    ).bind(uid, p, PER_SOURCE).all<{
      id: string; name: string; status: string; project_name: string | null;
    }>(),

    c.env.DB.prepare(
      `SELECT id, kid_name, title, schedule_time, schedule_date FROM kids_schedules
       WHERE user_id = ?1 AND (title LIKE ?2 ESCAPE '\\' OR kid_name LIKE ?2 ESCAPE '\\' OR note LIKE ?2 ESCAPE '\\')
       ORDER BY created_at DESC LIMIT ?3`
    ).bind(uid, p, PER_SOURCE).all<{
      id: string; kid_name: string; title: string; schedule_time: string | null; schedule_date: string | null;
    }>(),

    c.env.DB.prepare(
      `SELECT id, type, person_name, amount_idr, status, due_date FROM debts
       WHERE user_id = ?1 AND (person_name LIKE ?2 ESCAPE '\\' OR note LIKE ?2 ESCAPE '\\')
       ORDER BY created_at DESC LIMIT ?3`
    ).bind(uid, p, PER_SOURCE).all<{
      id: string; type: string; person_name: string; amount_idr: number; status: string; due_date: string | null;
    }>(),

    c.env.DB.prepare(
      `SELECT id, title, kind, event_date, event_time FROM calendar_events
       WHERE user_id = ?1 AND (title LIKE ?2 ESCAPE '\\' OR note LIKE ?2 ESCAPE '\\')
       ORDER BY event_date DESC LIMIT ?3`
    ).bind(uid, p, PER_SOURCE).all<{
      id: string; title: string; kind: string; event_date: string; event_time: string | null;
    }>(),
  ]);

  const rp = (n: number) => `Rp${n.toLocaleString('id-ID')}`;

  const hits: SearchHit[] = [
    ...(budget.results ?? []).map(e => ({
      type: 'budget',
      label: e.type === 'income' ? 'Pemasukan' : 'Pengeluaran',
      id: e.id,
      title: e.note || e.category,
      subtitle: `${rp(e.amount_idr)} · ${e.category}`,
      date: e.entry_date,
      tab: 'uang',
    })),
    ...(inventory.results ?? []).map(i => ({
      type: 'inventory',
      label: 'Stok',
      id: i.id,
      title: i.name,
      subtitle: `${i.quantity} ${i.unit} · ${i.category}`,
      date: i.expiry_date,
      subScreen: 'inventory',
    })),
    ...(habits.results ?? []).map(h => ({
      type: 'habit',
      label: 'Kebiasaan',
      id: h.id,
      title: h.name,
      subtitle: h.trigger_cue ? `Pemicu: ${h.trigger_cue}` : `Streak ${h.streak} hari`,
      date: null,
      tab: 'kebiasaan',
    })),
    ...(goals.results ?? []).map(g => ({
      type: 'goal',
      label: 'Identitas',
      id: g.id,
      title: g.identity_statement,
      subtitle: null,
      date: null,
      tab: 'goals',
    })),
    ...(projects.results ?? []).map(pr => ({
      type: 'project',
      label: 'Proyek',
      id: pr.id,
      title: pr.name,
      subtitle: null,
      date: null,
      subScreen: 'projects',
    })),
    ...(tasks.results ?? []).map(t => ({
      type: 'task',
      label: 'Tugas',
      id: t.id,
      title: t.name,
      subtitle: t.project_name ? `${t.project_name} · ${t.status}` : t.status,
      date: null,
      subScreen: 'projects',
    })),
    ...(kids.results ?? []).map(k => ({
      type: 'kid',
      label: 'Jadwal Anak',
      id: k.id,
      title: k.title,
      subtitle: k.schedule_time ? `${k.kid_name} · ${k.schedule_time}` : k.kid_name,
      date: k.schedule_date,
      subScreen: 'kids-schedule',
    })),
    ...(debts.results ?? []).map(d => ({
      type: 'debt',
      label: d.type === 'receivable' ? 'Piutang' : 'Utang',
      id: d.id,
      title: d.person_name,
      subtitle: `${rp(d.amount_idr)} · ${d.status === 'paid' ? 'lunas' : 'belum lunas'}`,
      date: d.due_date,
      subScreen: 'debt-planner',
    })),
    ...(events.results ?? []).map(ev => ({
      type: 'event',
      label: 'Agenda',
      id: ev.id,
      title: ev.title,
      subtitle: ev.event_time ? `${ev.kind} · ${ev.event_time}` : ev.kind,
      date: ev.event_date,
      tab: 'kalender',
    })),
  ];

  // Dated hits first, newest first — a search is nearly always about something
  // recent. Undated rows (habits, goals) keep their source order at the end.
  hits.sort((a, b) => {
    if (a.date && b.date) return b.date.localeCompare(a.date);
    if (a.date) return -1;
    if (b.date) return 1;
    return 0;
  });

  return c.json({ query: q, hits });
});

export default search;
