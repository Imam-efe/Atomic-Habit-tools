import { Hono } from 'hono';
import { requireAuth, type AuthContext } from '../middleware/auth';
import { TEXT_MODEL } from '../lib/ai';

const insights = new Hono<AuthContext>();
insights.use('/*', requireAuth);

interface AiInsightBody {
  habitScore: number;
  doneHabs: number;
  totalHabs: number;
  deepWorkHours: number;
  protein: number;
  proteinTarget: number;
  income: number;
  expense: number;
}


// POST /api/insights/ai — a personalized paragraph from the day's stats,
// layered on top of the always-available rule-based insight text the
// frontend already computes locally. Runs on Cloudflare Workers AI (the
// [ai] binding in wrangler.toml) — no API key, no separate account, 10,000
// free neurons/day on the same platform the rest of the backend runs on.
insights.post('/ai', async (c) => {
  const body = await c.req.json<AiInsightBody>().catch(() => null);
  if (!body) return c.json({ error: 'Invalid body' }, 400);

  try {
    const response = await c.env.AI.run(TEXT_MODEL, {
      messages: [
        {
          role: 'system',
          content: 'Kamu asisten personal yang menganalisis data harian pengguna aplikasi Atomic Habits (kebiasaan, produktivitas, nutrisi, keuangan) dan memberi SATU paragraf insight personal dalam Bahasa Indonesia, maksimal 3 kalimat, suportif dan actionable — hubungkan pola antar data, bukan cuma mengulang angka. Teks biasa saja, tanpa markdown atau list.',
        },
        {
          role: 'user',
          content: `Data hari ini:
- Kebiasaan: ${body.doneHabs}/${body.totalHabs} selesai (${body.habitScore}%)
- Deep Work: ${body.deepWorkHours} jam
- Protein: ${body.protein}g dari target ${body.proteinTarget}g
- Keuangan bulan ini: pemasukan Rp${body.income}, pengeluaran Rp${body.expense}`,
        },
      ],
      max_tokens: 300,
    }) as { response?: string };

    return c.json({ text: response.response?.trim() ?? '' });
  } catch (err) {
    console.error('AI insight generation failed', err);
    return c.json({ error: 'AI insight generation failed' }, 502);
  }
});

export default insights;
