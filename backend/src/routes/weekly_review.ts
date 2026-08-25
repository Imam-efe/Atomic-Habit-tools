import { Hono } from 'hono';
import { requireAuth, type AuthContext } from '../middleware/auth';
import { nanoid } from '../lib/nanoid';
import { jakartaToday } from '../lib/validate';
import { runJson } from '../lib/ai';

const weeklyReview = new Hono<AuthContext>();
weeklyReview.use('/*', requireAuth);

/**
 * Senin dari pekan yang memuat sebuah tanggal YYYY-MM-DD.
 *
 * Seluruh perhitungannya di UTC. Bentuk sebelumnya membangun `Date` pada
 * tengah malam WAKTU LOKAL lalu mengembalikannya lewat `toISOString()`, yang
 * membacanya sebagai UTC — dua zona berbeda untuk satu tanggal. Di server
 * Cloudflare yang berjalan pada UTC keduanya kebetulan sama, jadi salahnya
 * tidak pernah terlihat di produksi; di mesin mana pun yang di timur UTC,
 * termasuk laptop di Jakarta, fungsi ini mengembalikan pekan yang salah.
 */
export function getMondayOf(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const day = d.getUTCDay(); // 0=Minggu, 1=Senin...
  d.setUTCDate(d.getUTCDate() + (day === 0 ? -6 : 1 - day));
  return d.toISOString().slice(0, 10);
}

/** Minggu penutup dari sebuah Senin. */
function akhirPekan(weekStart: string): string {
  const d = new Date(`${weekStart}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 6);
  return d.toISOString().slice(0, 10);
}

// GET /api/weekly-review?week=YYYY-MM-DD  (defaults to current week)
weeklyReview.get('/', async (c) => {
  const user = c.get('user');
  const weekParam = c.req.query('week');
  const today = jakartaToday();
  const weekStart = getMondayOf(weekParam || today);
  const weekEnd = akhirPekan(weekStart);

  const review = await c.env.DB.prepare(
    'SELECT * FROM weekly_reviews WHERE user_id = ?1 AND week_start = ?2'
  ).bind(user.sub, weekStart).first<{
    id: string; week_start: string; habit_reflection: string | null;
    obstacle: string | null; adjustment: string | null;
    identity_affirmation: string | null; rating: number;
  }>();

  const habitStats = await c.env.DB.prepare(`
    SELECT h.id, h.name, h.color, h.streak,
           hf.frequency_type, hf.target_per_week,
           COUNT(hc.id) as completions_this_week
    FROM habits h
    LEFT JOIN habit_frequency hf ON hf.habit_id = h.id
    LEFT JOIN habit_completions hc
      ON hc.habit_id = h.id
      AND hc.completed_date BETWEEN ?2 AND ?3
      AND hc.user_id = h.user_id
    WHERE h.user_id = ?1
    GROUP BY h.id
  `).bind(user.sub, weekStart, weekEnd).all<{
    id: string; name: string; color: string; streak: number;
    frequency_type: string | null; target_per_week: number | null;
    completions_this_week: number;
  }>();

  const todayDate = new Date(today);
  const weekEndDate = new Date(weekEnd);
  const cappedEnd = todayDate < weekEndDate ? today : weekEnd;
  const startDate = new Date(weekStart);
  const daysElapsed = Math.max(1, Math.round((new Date(cappedEnd).getTime() - startDate.getTime()) / 86400000) + 1);

  // A 3x/week habit doing 3/7 days is at 100% of what it actually asks for,
  // not 43% — the daily denominator only makes sense for daily habits.
  const habits = (habitStats.results ?? []).map(({ frequency_type, target_per_week, ...h }) => {
    const isWeekly = frequency_type === 'weekly' && !!target_per_week;
    const denominator = isWeekly ? target_per_week! : Math.min(daysElapsed, 7);
    return {
      ...h,
      consistency: Math.min(100, Math.round((h.completions_this_week / denominator) * 100)),
    };
  });

  const overallConsistency = habits.length > 0
    ? Math.round(habits.reduce((s, h) => s + h.consistency, 0) / habits.length)
    : 0;

  return c.json({
    weekStart,
    weekEnd,
    daysElapsed,
    overallConsistency,
    habits,
    review: review ?? null,
  });
});

// GET /api/weekly-review/list — last 10 reviews
weeklyReview.get('/list', async (c) => {
  const user = c.get('user');
  const rows = await c.env.DB.prepare(
    'SELECT id, week_start, rating, habit_reflection FROM weekly_reviews WHERE user_id = ?1 ORDER BY week_start DESC LIMIT 10'
  ).bind(user.sub).all<{ id: string; week_start: string; rating: number; habit_reflection: string | null }>();
  return c.json(rows.results ?? []);
});

// POST /api/weekly-review — upsert review for a week
weeklyReview.post('/', async (c) => {
  const user = c.get('user');
  type Body = {
    weekStart?: string;
    habitReflection?: string;
    obstacle?: string;
    adjustment?: string;
    identityAffirmation?: string;
    rating?: number;
  };
  const body = await c.req.json<Body>().catch((): Body => ({}));
  const today = jakartaToday();
  const weekStart = getMondayOf(body.weekStart || today);

  const existing = await c.env.DB.prepare(
    'SELECT id FROM weekly_reviews WHERE user_id = ?1 AND week_start = ?2'
  ).bind(user.sub, weekStart).first<{ id: string }>();

  if (existing) {
    await c.env.DB.prepare(`
      UPDATE weekly_reviews
      SET habit_reflection = ?1, obstacle = ?2, adjustment = ?3,
          identity_affirmation = ?4, rating = ?5
      WHERE id = ?6
    `).bind(
      body.habitReflection ?? null,
      body.obstacle ?? null,
      body.adjustment ?? null,
      body.identityAffirmation ?? null,
      body.rating ?? 3,
      existing.id
    ).run();
    return c.json({ id: existing.id, weekStart });
  }

  const id = nanoid();
  await c.env.DB.prepare(`
    INSERT INTO weekly_reviews (id, user_id, week_start, habit_reflection, obstacle, adjustment, identity_affirmation, rating)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
  `).bind(
    id, user.sub, weekStart,
    body.habitReflection ?? null,
    body.obstacle ?? null,
    body.adjustment ?? null,
    body.identityAffirmation ?? null,
    body.rating ?? 3
  ).run();

  return c.json({ id, weekStart }, 201);
});

interface RawDraft {
  habit_reflection?: string;
  obstacle?: string;
  adjustment?: string;
  identity_affirmation?: string;
}

const DRAFT_SCHEMA = {
  type: 'object',
  properties: {
    habit_reflection: { type: 'string', description: 'Refleksi kebiasaan minggu ini, 2-3 kalimat' },
    obstacle: { type: 'string', description: 'Hambatan yang paling mungkin terjadi berdasarkan data, 1-2 kalimat' },
    adjustment: { type: 'string', description: 'Satu penyesuaian konkret untuk minggu depan, 1-2 kalimat' },
    identity_affirmation: { type: 'string', description: 'Afirmasi identitas, satu kalimat, diawali "Saya adalah..."' },
  },
  required: ['habit_reflection', 'obstacle', 'adjustment', 'identity_affirmation'],
} as const;

// POST /api/weekly-review/draft — AI first pass at the four reflection fields
//
// The form has four free-text boxes the user has to fill from memory every
// week, so in practice they stay empty. This drafts them from the week's own
// numbers; the frontend drops the text into the editable inputs and the user
// still has to press save, so nothing is stored without a human reading it.
weeklyReview.post('/draft', async (c) => {
  const user = c.get('user');
  const body = await c.req.json<{ weekStart?: string }>().catch(() => null);
  const today = jakartaToday();
  const weekStart = getMondayOf(body?.weekStart || today);
  const weekEnd = akhirPekan(weekStart);

  const [habitStats, goalRow] = await Promise.all([
    c.env.DB.prepare(`
      SELECT h.name, h.streak, COUNT(hc.id) as completions_this_week
      FROM habits h
      LEFT JOIN habit_completions hc
        ON hc.habit_id = h.id
        AND hc.completed_date BETWEEN ?2 AND ?3
        AND hc.user_id = h.user_id
      WHERE h.user_id = ?1
      GROUP BY h.id
    `).bind(user.sub, weekStart, weekEnd).all<{
      name: string; streak: number; completions_this_week: number;
    }>(),
    c.env.DB.prepare(
      'SELECT identity_statement FROM goals WHERE user_id = ?1 ORDER BY sort_order ASC, created_at ASC LIMIT 1'
    ).bind(user.sub).first<{ identity_statement: string }>(),
  ]);

  const habits = habitStats.results ?? [];
  if (habits.length === 0) {
    return c.json({ error: 'Belum ada kebiasaan untuk direfleksikan' }, 422);
  }

  const cappedEnd = today < weekEnd ? today : weekEnd;
  const startDate = new Date(weekStart);
  const daysElapsed = Math.max(
    1,
    Math.round((new Date(cappedEnd).getTime() - startDate.getTime()) / 86400000) + 1
  );
  const possible = Math.min(daysElapsed, 7);

  const lines = habits
    .map(h => `- ${h.name}: ${h.completions_this_week}/${possible} hari, streak ${h.streak} hari`)
    .join('\n');

  let draft: RawDraft | null = null;
  try {
    draft = await runJson<RawDraft>(
      c.env,
      [
        {
          role: 'system',
          content: 'Kamu membantu pengguna menulis draft review mingguan Atomic Habits dalam Bahasa Indonesia. Tulis dari sudut pandang pengguna (aku/saya), suportif tapi jujur pada data, dan spesifik pada angka yang diberikan. Hindari markdown dan daftar.',
        },
        {
          role: 'user',
          content: [
            `Minggu ${weekStart} sampai ${weekEnd} (${daysElapsed} hari berjalan).`,
            goalRow?.identity_statement ? `Identitas yang sedang dibangun: ${goalRow.identity_statement}.` : '',
            'Kebiasaan minggu ini:',
            lines,
          ].filter(Boolean).join('\n'),
        },
      ],
      DRAFT_SCHEMA as unknown as Record<string, unknown>,
      { maxTokens: 700 }
    );
  } catch (err) {
    console.error('Weekly review draft failed', err);
    return c.json({ error: 'Draft generation failed' }, 502);
  }

  if (!draft) return c.json({ error: 'Draft generation failed' }, 502);

  return c.json({
    weekStart,
    habitReflection: draft.habit_reflection ?? '',
    obstacle: draft.obstacle ?? '',
    adjustment: draft.adjustment ?? '',
    identityAffirmation: draft.identity_affirmation ?? '',
  });
});

export default weeklyReview;
