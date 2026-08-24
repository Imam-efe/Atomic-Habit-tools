import { Hono } from 'hono';
import { requireAuth, type AuthContext } from '../middleware/auth';
import { nanoid } from '../lib/nanoid';
import { jakartaToday } from '../lib/validate';
import { runText } from '../lib/ai';
import { daysInMonth } from '../lib/safe_to_spend';

const monthlyReview = new Hono<AuthContext>();
monthlyReview.use('/*', requireAuth);

const MONTH_NAMES = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

/**
 * `?month=` datang mentah dari URL. Tanpa cek ini, "abc" melewati
 * split('-').map(Number) jadi NaN dan menular ke seluruh perhitungan:
 * label terbaca "undefined NaN" dan setiap angka konsistensi jadi null.
 */
function isMonth(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}$/.test(s)) return false;
  const m = Number(s.slice(5, 7));
  return m >= 1 && m <= 12;
}

function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

function prevMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

interface MonthStats {
  month: string;
  daysElapsed: number;
  overallConsistency: number;
  habits: { name: string; completions: number; expected: number; consistency: number }[];
  totalIncome: number;
  totalExpense: number;
  netProfit: number;
  netWorth: number | null;
  netWorthDelta: number | null;
  identityStatement: string | null;
}

async function computeMonthStats(db: D1Database, userId: string, month: string): Promise<MonthStats> {
  const today = jakartaToday();
  const currentMonth = today.slice(0, 7);
  const isCurrentMonth = month === currentMonth;
  const daysElapsed = isCurrentMonth ? Number(today.slice(8, 10)) : daysInMonth(month);
  const start = `${month}-01`;
  const cappedEnd = isCurrentMonth ? today : `${month}-31`;
  const weeksElapsed = Math.max(1, Math.ceil(daysElapsed / 7));

  const [habitStats, entries, currentSnapshot, previousSnapshot, goalRow] = await Promise.all([
    db.prepare(`
      SELECT h.name, hf.frequency_type, hf.target_per_week, COUNT(hc.id) as completions
      FROM habits h
      LEFT JOIN habit_frequency hf ON hf.habit_id = h.id
      LEFT JOIN habit_completions hc
        ON hc.habit_id = h.id
        AND hc.completed_date BETWEEN ?2 AND ?3
        AND hc.user_id = h.user_id
      WHERE h.user_id = ?1
      GROUP BY h.id
    `).bind(userId, start, cappedEnd).all<{
      name: string; frequency_type: string | null; target_per_week: number | null; completions: number;
    }>(),
    db.prepare(
      `SELECT type, amount_idr FROM budget_entries WHERE user_id = ?1 AND entry_date >= ?2 AND entry_date <= ?3`
    ).bind(userId, start, `${month}-31`).all<{ type: string; amount_idr: number }>(),
    db.prepare('SELECT net_worth FROM net_worth_snapshots WHERE user_id = ?1 AND month = ?2')
      .bind(userId, month).first<{ net_worth: number }>(),
    db.prepare('SELECT net_worth FROM net_worth_snapshots WHERE user_id = ?1 AND month = ?2')
      .bind(userId, prevMonth(month)).first<{ net_worth: number }>(),
    db.prepare('SELECT identity_statement FROM goals WHERE user_id = ?1 ORDER BY sort_order ASC, created_at ASC LIMIT 1')
      .bind(userId).first<{ identity_statement: string }>(),
  ]);

  const habits = (habitStats.results ?? []).map(h => {
    const isWeekly = h.frequency_type === 'weekly' && !!h.target_per_week;
    const expected = isWeekly ? h.target_per_week! * weeksElapsed : daysElapsed;
    const consistency = expected > 0 ? Math.min(100, Math.round((h.completions / expected) * 100)) : 0;
    return { name: h.name, completions: h.completions, expected, consistency };
  });

  const overallConsistency = habits.length > 0
    ? Math.round(habits.reduce((s, h) => s + h.consistency, 0) / habits.length)
    : 0;

  const entryRows = entries.results ?? [];
  const totalIncome = entryRows.filter(e => e.type === 'income').reduce((s, e) => s + e.amount_idr, 0);
  const totalExpense = entryRows.filter(e => e.type === 'expense').reduce((s, e) => s + e.amount_idr, 0);

  return {
    month,
    daysElapsed,
    overallConsistency,
    habits,
    totalIncome,
    totalExpense,
    netProfit: totalIncome - totalExpense,
    netWorth: currentSnapshot?.net_worth ?? null,
    netWorthDelta: currentSnapshot && previousSnapshot ? currentSnapshot.net_worth - previousSnapshot.net_worth : null,
    identityStatement: goalRow?.identity_statement ?? null,
  };
}

// GET /api/monthly-review?month=YYYY-MM (defaults to current month)
monthlyReview.get('/', async (c) => {
  const user = c.get('user');
  const requested = c.req.query('month');
  if (requested !== undefined && !isMonth(requested)) {
    return c.json({ error: 'month harus format YYYY-MM' }, 400);
  }
  const month = requested || jakartaToday().slice(0, 7);

  const [stats, saved] = await Promise.all([
    computeMonthStats(c.env.DB, user.sub, month),
    c.env.DB.prepare('SELECT narrative FROM monthly_reviews WHERE user_id = ?1 AND month = ?2')
      .bind(user.sub, month).first<{ narrative: string }>(),
  ]);

  return c.json({ month, monthLabel: monthLabel(month), stats, narrative: saved?.narrative ?? null });
});

// GET /api/monthly-review/list — past narratives, most recent first
monthlyReview.get('/list', async (c) => {
  const user = c.get('user');
  const rows = await c.env.DB.prepare(
    'SELECT month, narrative FROM monthly_reviews WHERE user_id = ?1 ORDER BY month DESC LIMIT 6'
  ).bind(user.sub).all<{ month: string; narrative: string }>();
  return c.json((rows.results ?? []).map(r => ({ ...r, monthLabel: monthLabel(r.month) })));
});

// POST /api/monthly-review/generate — AI narrative recap of the month, cached until regenerated
monthlyReview.post('/generate', async (c) => {
  const user = c.get('user');
  const body = await c.req.json<{ month?: string }>().catch(() => null);
  if (body?.month !== undefined && !isMonth(body.month)) {
    return c.json({ error: 'month harus format YYYY-MM' }, 400);
  }
  const month = body?.month || jakartaToday().slice(0, 7);

  const stats = await computeMonthStats(c.env.DB, user.sub, month);

  if (stats.habits.length === 0 && stats.totalIncome === 0 && stats.totalExpense === 0) {
    return c.json({ error: 'Belum ada data bulan ini untuk direkap' }, 422);
  }

  const habitLines = stats.habits
    .map(h => `- ${h.name}: ${h.completions}/${h.expected} (konsistensi ${h.consistency}%)`)
    .join('\n');

  const fmtRp = (n: number) => `Rp${n.toLocaleString('id-ID')}`;

  let narrative = '';
  try {
    narrative = await runText(
      c.env,
      [
        {
          role: 'system',
          content: 'Kamu menulis rekap bulanan dari data Atomic Habits dan keuangan pengguna, dalam Bahasa Indonesia, dari sudut pandang pengguna (aku/saya). Tulis 1-2 paragraf naratif yang hangat dan suportif tapi jujur pada angka, menghubungkan kebiasaan, keuangan, dan identitas yang sedang dibangun. Jangan pakai markdown, heading, atau daftar bernomor.',
        },
        {
          role: 'user',
          content: [
            `Rekap untuk ${monthLabel(month)} (${stats.daysElapsed} hari berjalan).`,
            stats.identityStatement ? `Identitas yang sedang dibangun: ${stats.identityStatement}.` : '',
            habitLines ? `Kebiasaan bulan ini:\n${habitLines}\nKonsistensi keseluruhan: ${stats.overallConsistency}%.` : 'Belum ada kebiasaan yang dilacak bulan ini.',
            `Keuangan: pemasukan ${fmtRp(stats.totalIncome)}, pengeluaran ${fmtRp(stats.totalExpense)}, sisa ${fmtRp(stats.netProfit)}.`,
            stats.netWorth !== null
              ? `Kekayaan bersih saat ini ${fmtRp(stats.netWorth)}${stats.netWorthDelta !== null ? ` (${stats.netWorthDelta >= 0 ? 'naik' : 'turun'} ${fmtRp(Math.abs(stats.netWorthDelta))} dari bulan lalu)` : ''}.`
              : '',
          ].filter(Boolean).join('\n'),
        },
      ],
      { maxTokens: 400 }
    );
  } catch (err) {
    console.error('Monthly review generation failed', err);
    return c.json({ error: 'Gagal membuat rekap' }, 502);
  }

  narrative = narrative.trim();
  if (!narrative) return c.json({ error: 'Gagal membuat rekap' }, 502);

  await c.env.DB.prepare(`
    INSERT INTO monthly_reviews (id, user_id, month, narrative, created_at)
    VALUES (?1, ?2, ?3, ?4, unixepoch())
    ON CONFLICT(user_id, month) DO UPDATE SET narrative = ?4, created_at = unixepoch()
  `).bind(nanoid(), user.sub, month, narrative).run();

  return c.json({ month, monthLabel: monthLabel(month), stats, narrative });
});

export default monthlyReview;
