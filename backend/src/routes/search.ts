import { Hono } from 'hono';
import { requireAuth, type AuthContext } from '../middleware/auth';
import { resolvePlants } from './garden';
import { namaSubjekHewan } from './ternak';

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

  const [budget, inventory, habits, goals, projects, tasks, kids, debts, events, userNotes, garden, recipes, ternakHewan, ternakKandang] = await Promise.all([
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

    c.env.DB.prepare(
      `SELECT id, body, created_at FROM notes
       WHERE user_id = ?1 AND body LIKE ?2 ESCAPE '\\'
       ORDER BY created_at DESC LIMIT ?3`
    ).bind(uid, p, PER_SOURCE).all<{ id: string; body: string; created_at: number }>(),

    // plant_id (slug katalog, mis. 'cabai-rawit') dicocokkan juga sebagai
    // proxy nama tanaman — nama aslinya baru diketahui setelah resolvePlants
    // di bawah, karena katalog tidak hidup sebagai tabel di D1.
    c.env.DB.prepare(
      `SELECT id, plant_id, custom_name, nickname, location, planted_date FROM garden_plantings
       WHERE user_id = ?1 AND (plant_id LIKE ?2 ESCAPE '\\' OR custom_name LIKE ?2 ESCAPE '\\'
         OR nickname LIKE ?2 ESCAPE '\\' OR location LIKE ?2 ESCAPE '\\' OR note LIKE ?2 ESCAPE '\\')
       ORDER BY planted_date DESC LIMIT ?3`
    ).bind(uid, p, PER_SOURCE).all<{
      id: string; plant_id: string | null; custom_name: string | null;
      nickname: string | null; location: string | null; planted_date: string;
    }>(),

    // Resep dicari lewat namanya dan lewat bahannya: "ada resep pakai tempe?"
    // adalah cara paling wajar orang mencari masakan.
    c.env.DB.prepare(
      `SELECT id, name, have_json, missing_json, minutes FROM cooking_recipes
       WHERE user_id = ?1 AND (name LIKE ?2 ESCAPE '\\' OR have_json LIKE ?2 ESCAPE '\\'
         OR missing_json LIKE ?2 ESCAPE '\\')
       ORDER BY created_at DESC LIMIT ?3`
    ).bind(uid, p, PER_SOURCE).all<{
      id: string; name: string; have_json: string; missing_json: string; minutes: number | null;
    }>(),

    // animal_id (slug katalog, mis. 'kucing-domestik') dicocokkan juga —
    // panggilan sering diketik lebih pendek dari spesiesnya.
    c.env.DB.prepare(
      `SELECT id, animal_id, nama_kustom, nama_panggilan, status FROM ternak_hewan
       WHERE user_id = ?1 AND status = 'hidup'
         AND (nama_kustom LIKE ?2 ESCAPE '\\' OR nama_panggilan LIKE ?2 ESCAPE '\\' OR animal_id LIKE ?2 ESCAPE '\\')
       ORDER BY created_at DESC LIMIT ?3`
    ).bind(uid, p, PER_SOURCE).all<{
      id: string; animal_id: string | null; nama_kustom: string | null;
      nama_panggilan: string | null; status: string;
    }>(),

    c.env.DB.prepare(
      `SELECT id, nama, jenis, lokasi FROM ternak_kandang
       WHERE user_id = ?1 AND status = 'aktif' AND (nama LIKE ?2 ESCAPE '\\' OR lokasi LIKE ?2 ESCAPE '\\')
       ORDER BY created_at DESC LIMIT ?3`
    ).bind(uid, p, PER_SOURCE).all<{
      id: string; nama: string; jenis: string; lokasi: string | null;
    }>(),
  ]);

  const gardenRows = garden.results ?? [];
  const gardenPlantMap = await resolvePlants(
    c.env.DB,
    [...new Set(gardenRows.map(g => g.plant_id).filter((id): id is string => !!id))]
  );

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
    ...(userNotes.results ?? []).map(n => {
      const firstLine = n.body.split('\n')[0].trim();
      return {
        type: 'note',
        label: 'Catatan',
        id: n.id,
        title: firstLine.length > 60 ? `${firstLine.slice(0, 60)}…` : firstLine,
        subtitle: n.body.length > firstLine.length ? n.body.slice(firstLine.length).trim().slice(0, 80) : null,
        date: new Date(n.created_at * 1000).toISOString().slice(0, 10),
        subScreen: 'notes',
      };
    }),
    ...(recipes.results ?? []).map(r => {
      const kurang = (() => {
        try {
          const v = JSON.parse(r.missing_json);
          return Array.isArray(v) ? v.length : 0;
        } catch {
          return 0;
        }
      })();
      return {
        type: 'recipe',
        label: 'Resep',
        id: r.id,
        title: r.name,
        subtitle: [
          r.minutes ? `${r.minutes} menit` : null,
          kurang > 0 ? `${kurang} bahan kurang` : 'bahan lengkap',
        ].filter(Boolean).join(' · '),
        date: null,
        subScreen: 'masakan',
      };
    }),
    ...gardenRows.map(g => {
      const plant = g.plant_id ? gardenPlantMap.get(g.plant_id) : undefined;
      const plantName = plant?.name ?? g.custom_name ?? 'Tanaman';
      return {
        type: 'garden',
        label: 'Kebun',
        id: g.id,
        title: g.nickname || plantName,
        subtitle: g.nickname ? plantName : g.location,
        date: g.planted_date,
        subScreen: 'garden',
      };
    }),
    ...(ternakHewan.results ?? []).map(h => ({
      type: 'ternak',
      label: 'Ternak',
      id: h.id,
      title: namaSubjekHewan(h),
      subtitle: null,
      date: null,
      subScreen: 'ternak',
    })),
    ...(ternakKandang.results ?? []).map(k => ({
      type: 'ternak',
      label: 'Ternak',
      id: k.id,
      title: k.nama,
      subtitle: [k.jenis, k.lokasi].filter(Boolean).join(' · ') || null,
      date: null,
      subScreen: 'ternak',
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
