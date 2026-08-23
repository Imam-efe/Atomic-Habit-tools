import { Hono } from 'hono';
import { requireAuth, type AuthContext } from '../middleware/auth';
import { nanoid } from '../lib/nanoid';
import { validate } from '../lib/validate';
import { runText } from '../lib/ai';

const notes = new Hono<AuthContext>();
notes.use('/*', requireAuth);

interface NoteRow {
  id: string;
  body: string;
  summary: string | null;
  linked_habit_id: string | null;
  linked_goal_id: string | null;
  created_at: number;
  updated_at: number;
}

/**
 * Turunkan id tautan yang bukan milik pengguna jadi null.
 *
 * Foreign key di migrasi hanya memastikan baris itu ADA, bukan bahwa ia milik
 * pengguna yang sama — tanpa cek ini sebuah catatan bisa menyimpan id habit
 * atau goal orang lain, dan namanya ikut terbaca saat catatan ditampilkan.
 */
async function ownedLinks(
  db: D1Database,
  userId: string,
  habitId: string | undefined,
  goalId: string | undefined
): Promise<{ habitId: string | null; goalId: string | null }> {
  const [habit, goal] = await Promise.all([
    habitId
      ? db.prepare('SELECT id FROM habits WHERE id = ?1 AND user_id = ?2').bind(habitId, userId).first<{ id: string }>()
      : Promise.resolve(null),
    goalId
      ? db.prepare('SELECT id FROM goals WHERE id = ?1 AND user_id = ?2').bind(goalId, userId).first<{ id: string }>()
      : Promise.resolve(null),
  ]);
  return { habitId: habit?.id ?? null, goalId: goal?.id ?? null };
}

// GET /api/notes — newest first
notes.get('/', async (c) => {
  const user = c.get('user');
  const rows = await c.env.DB.prepare(
    `SELECT n.id, n.body, n.summary, n.linked_habit_id, n.linked_goal_id, n.created_at, n.updated_at,
            h.name as habit_name, g.identity_statement as goal_statement
     FROM notes n
     LEFT JOIN habits h ON h.id = n.linked_habit_id AND h.user_id = ?1
     LEFT JOIN goals g ON g.id = n.linked_goal_id AND g.user_id = ?1
     WHERE n.user_id = ?1
     ORDER BY n.created_at DESC`
  ).bind(user.sub).all<NoteRow & { habit_name: string | null; goal_statement: string | null }>();

  return c.json((rows.results ?? []).map(r => ({
    id: r.id,
    body: r.body,
    summary: r.summary,
    linkedHabitId: r.linked_habit_id,
    linkedHabitName: r.habit_name,
    linkedGoalId: r.linked_goal_id,
    linkedGoalStatement: r.goal_statement,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  })));
});

// POST /api/notes
notes.post('/', async (c) => {
  const user = c.get('user');
  type Body = { body?: string; linkedHabitId?: string; linkedGoalId?: string };
  const body = await c.req.json<Body>().catch((): Body => ({}));

  const err = validate(body as Record<string, unknown>, { body: { type: 'string' } });
  if (err) return c.json({ error: err }, 400);

  const id = nanoid();
  const now = Math.floor(Date.now() / 1000);
  const text = body.body!.trim();
  const links = await ownedLinks(c.env.DB, user.sub, body.linkedHabitId, body.linkedGoalId);

  await c.env.DB.prepare(
    `INSERT INTO notes (id, user_id, body, linked_habit_id, linked_goal_id, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)`
  ).bind(id, user.sub, text, links.habitId, links.goalId, now).run();

  return c.json({
    id, body: text, summary: null,
    linkedHabitId: links.habitId, linkedGoalId: links.goalId,
    createdAt: now, updatedAt: now,
  }, 201);
});

// PUT /api/notes/:id
notes.put('/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  type Body = { body?: string; linkedHabitId?: string; linkedGoalId?: string };
  const body = await c.req.json<Body>().catch((): Body => ({}));

  const err = validate(body as Record<string, unknown>, { body: { type: 'string' } });
  if (err) return c.json({ error: err }, 400);

  const now = Math.floor(Date.now() / 1000);
  const text = body.body!.trim();
  const links = await ownedLinks(c.env.DB, user.sub, body.linkedHabitId, body.linkedGoalId);

  // Editing the body invalidates any prior AI summary — it would silently
  // describe text that no longer exists otherwise.
  const res = await c.env.DB.prepare(
    `UPDATE notes SET body = ?1, summary = NULL, linked_habit_id = ?2, linked_goal_id = ?3, updated_at = ?4
     WHERE id = ?5 AND user_id = ?6`
  ).bind(text, links.habitId, links.goalId, now, id, user.sub).run();

  if (res.meta.changes === 0) return c.json({ error: 'note not found' }, 404);

  return c.json({ id, body: text, summary: null, linkedHabitId: links.habitId, linkedGoalId: links.goalId, updatedAt: now });
});

// DELETE /api/notes/:id
notes.delete('/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const res = await c.env.DB.prepare('DELETE FROM notes WHERE id = ?1 AND user_id = ?2').bind(id, user.sub).run();
  if (res.meta.changes === 0) return c.json({ error: 'note not found' }, 404);
  return c.json({ ok: true });
});

// POST /api/notes/:id/summarize — one-line AI summary, opt-in and on-demand
//
// Never runs on save: jotting a note should never wait on a network round
// trip. A note under ~120 characters is already its own summary, so this
// skips the AI call entirely rather than paraphrasing something this short.
notes.post('/:id/summarize', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');

  const note = await c.env.DB.prepare(
    'SELECT body FROM notes WHERE id = ?1 AND user_id = ?2'
  ).bind(id, user.sub).first<{ body: string }>();
  if (!note) return c.json({ error: 'note not found' }, 404);

  // Sudah jadi ringkasannya sendiri — tetap disimpan, supaya tombol "Ringkas"
  // tidak muncul lagi setelah halaman dimuat ulang.
  if (note.body.length <= 120) {
    await c.env.DB.prepare('UPDATE notes SET summary = ?1 WHERE id = ?2 AND user_id = ?3')
      .bind(note.body, id, user.sub).run();
    return c.json({ summary: note.body });
  }

  let summary: string;
  try {
    summary = await runText(
      c.env,
      [
        {
          role: 'system',
          content: 'Ringkas catatan berikut jadi satu kalimat pendek dalam Bahasa Indonesia, maksimal 15 kata. Tanpa markdown, tanpa tanda kutip.',
        },
        { role: 'user', content: note.body },
      ],
      { maxTokens: 60 }
    );
  } catch (err) {
    console.error('Note summarize failed', err);
    return c.json({ error: 'Ringkas gagal' }, 502);
  }

  if (!summary) return c.json({ error: 'Ringkas gagal' }, 502);

  await c.env.DB.prepare('UPDATE notes SET summary = ?1 WHERE id = ?2 AND user_id = ?3')
    .bind(summary, id, user.sub).run();

  return c.json({ summary });
});

export default notes;
