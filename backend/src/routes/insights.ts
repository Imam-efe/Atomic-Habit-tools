import { Hono } from 'hono';
import Anthropic from '@anthropic-ai/sdk';
import { requireAuth, type AuthContext } from '../middleware/auth';

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
// frontend already computes locally. Returns 501 when ANTHROPIC_API_KEY
// isn't configured, so the frontend can silently keep the rule-based text
// instead of surfacing a broken feature.
insights.post('/ai', async (c) => {
  if (!c.env.ANTHROPIC_API_KEY) {
    return c.json({ error: 'AI insights not configured' }, 501);
  }

  const body = await c.req.json<AiInsightBody>().catch(() => null);
  if (!body) return c.json({ error: 'Invalid body' }, 400);

  const client = new Anthropic({ apiKey: c.env.ANTHROPIC_API_KEY });

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 300,
      system: 'Kamu asisten personal yang menganalisis data harian pengguna aplikasi Atomic Habits (kebiasaan, produktivitas, nutrisi, keuangan) dan memberi SATU paragraf insight personal dalam Bahasa Indonesia, maksimal 3 kalimat, suportif dan actionable — hubungkan pola antar data, bukan cuma mengulang angka. Teks biasa saja, tanpa markdown atau list.',
      messages: [{
        role: 'user',
        content: `Data hari ini:
- Kebiasaan: ${body.doneHabs}/${body.totalHabs} selesai (${body.habitScore}%)
- Deep Work: ${body.deepWorkHours} jam
- Protein: ${body.protein}g dari target ${body.proteinTarget}g
- Keuangan bulan ini: pemasukan Rp${body.income}, pengeluaran Rp${body.expense}`,
      }],
    });

    const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text');
    return c.json({ text: textBlock?.text ?? '' });
  } catch (err) {
    console.error('AI insight generation failed', err);
    return c.json({ error: 'AI insight generation failed' }, 502);
  }
});

export default insights;
