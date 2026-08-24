/**
 * Satu endpoint AI untuk seluruh aplikasi.
 *
 * Sebelumnya tiap modul punya endpoint AI-nya sendiri dengan prompt sendiri,
 * dan modul yang belum sempat dibuatkan tidak punya AI sama sekali. Rute ini
 * menggantikannya dengan satu alur: potret data nyata pengguna masuk ke
 * prompt, model menjawab sekaligus memilih alat, alat yang aman dijalankan,
 * dan yang menyentuh uang dikembalikan untuk dikonfirmasi.
 *
 * Yang membuat jawabannya tidak generik bukan modelnya, melainkan konteks
 * dari lib/ai_context.ts: pertanyaan "kenapa boros bulan ini" dijawab dengan
 * kategori dan angkanya sendiri, bukan dengan nasihat yang sama untuk semua.
 */

import { Hono } from 'hono';
import { requireAuth, type AuthContext } from '../middleware/auth';
import { runJson } from '../lib/ai';
import { jakartaToday } from '../lib/validate';
import { buildContext, isModuleKey, MODULES, type ModuleKey } from '../lib/ai_context';
import {
  ToolError, describeTools, planSchema, toolsFor, type ToolResult,
} from '../lib/agent_tools';
import { parsePlan } from '../lib/agent_plan';

const agent = new Hono<AuthContext>();
agent.use('/*', requireAuth);

/** Aksi seperti yang dilaporkan balik ke layar. */
interface ActionReport {
  alat: string;
  modul: ModuleKey;
  status: 'dijalankan' | 'perlu_konfirmasi' | 'gagal';
  ringkasan: string;
  /** Id baris yang dibuat — dipakai UI untuk menawarkan pembatalan. */
  ids?: string[];
  /** Argumen yang diusulkan, hanya untuk aksi yang perlu dikonfirmasi. */
  argumen?: Record<string, unknown>;
}

const SYSTEM = `Kamu asisten pribadi di dalam aplikasi Fayolla, berbahasa Indonesia.

Aturan menjawab:
- Pakai DATA PENGGUNA di bawah. Sebut angka, nama, dan tanggal yang benar-benar ada di sana.
- Kalau datanya tidak cukup untuk menjawab, katakan apa yang kurang. Jangan mengarang angka.
- Jawaban maksimal tiga kalimat, tanpa basa-basi pembuka.

Aturan bertindak:
- Kalau pengguna meminta sesuatu dibuat, dicatat, ditambahkan, atau disusun, panggil alat yang sesuai.
- Kalau pengguna hanya bertanya, jangan panggil alat apa pun.
- Satu alat bisa menerima banyak item sekaligus. Untuk sepuluh tanaman, panggil sekali dengan sepuluh nama, bukan sepuluh kali.
- Isi argumen hanya dengan yang kamu yakin. Yang tidak disebut pengguna biarkan kosong.`;

// POST /api/agent — tanya atau perintah, dengan cakupan alat per layar
agent.post('/', async (c) => {
  const user = c.get('user');
  type AskBody = { message?: string; module?: string };
  const body = await c.req.json<AskBody>().catch((): AskBody => ({}));

  const message = body.message?.trim();
  if (!message) return c.json({ error: 'pertanyaan kosong' }, 400);
  if (message.length > 2000) return c.json({ error: 'pertanyaan terlalu panjang' }, 400);

  const module = isModuleKey(body.module) ? body.module : undefined;
  const today = jakartaToday();
  const available = toolsFor(module);

  // Layar tertentu membawa konteks modulnya sendiri; tanpa modul, potretnya
  // lintas-modul karena pertanyaannya bisa menyeberang ("cukup nggak uangnya
  // buat belanja bahan minggu ini").
  const modules: ModuleKey[] = module ? [module] : [...MODULES];
  const context = await buildContext(c.env.DB, user.sub, modules, today);

  let raw: unknown;
  try {
    raw = await runJson<Record<string, unknown>>(
      c.env,
      [
        { role: 'system', content: `${SYSTEM}\n\nALAT YANG TERSEDIA:\n${describeTools(available)}` },
        {
          role: 'user',
          content: `Hari ini ${today}.\n\nDATA PENGGUNA:\n${context || '(belum ada data)'}\n\nPermintaan: ${message}`,
        },
      ],
      planSchema(available),
      { maxTokens: 900 }
    );
  } catch (err) {
    console.error('[agent] AI gagal', err);
    return c.json({ error: 'AI sedang tidak bisa dihubungi' }, 503);
  }

  const plan = parsePlan(raw, available);
  if (!plan.jawaban && plan.actions.length === 0) {
    return c.json({ error: 'AI tidak memberi jawaban yang bisa dibaca' }, 502);
  }

  const laporan: ActionReport[] = [];

  for (const { tool, args } of plan.actions) {
    if (tool.risk === 'konfirmasi') {
      laporan.push({
        alat: tool.name,
        modul: tool.module,
        status: 'perlu_konfirmasi',
        ringkasan: 'Perlu persetujuanmu sebelum disimpan.',
        argumen: args,
      });
      continue;
    }

    try {
      const result: ToolResult = await tool.run({ db: c.env.DB, userId: user.sub, today }, args);
      laporan.push({
        alat: tool.name, modul: tool.module, status: 'dijalankan',
        ringkasan: result.ringkasan, ids: result.ids,
      });
    } catch (err) {
      // Satu aksi gagal tidak menghentikan sisanya: kalau delapan tanaman
      // masuk dan satu namanya tidak terbaca, membatalkan semuanya lebih
      // merugikan daripada melaporkan yang satu itu.
      const pesan = err instanceof ToolError ? err.message : 'gagal dijalankan';
      if (!(err instanceof ToolError)) console.error(`[agent] ${tool.name} gagal`, err);
      laporan.push({ alat: tool.name, modul: tool.module, status: 'gagal', ringkasan: pesan });
    }
  }

  return c.json({
    jawaban: plan.jawaban,
    aksi: laporan,
    // Alat yang diminta tapi tidak ada di layar ini dilaporkan apa adanya,
    // supaya "kenapa tidak terjadi apa-apa" punya jawaban.
    alatTidakDikenal: plan.unknownTools,
  });
});

// POST /api/agent/confirm — jalankan aksi yang tadi ditahan
agent.post('/confirm', async (c) => {
  const user = c.get('user');
  type ConfirmBody = { tool?: string; args?: Record<string, unknown> };
  const body = await c.req.json<ConfirmBody>().catch((): ConfirmBody => ({}));

  const name = body.tool?.trim();
  if (!name) return c.json({ error: 'alat tidak disebut' }, 400);

  // Cakupannya seluruh alat: yang sampai ke sini sudah dilihat dan disetujui
  // pengguna, dan alatnya tetap divalidasi ulang lewat daftar tertutup.
  const tool = toolsFor().find((t) => t.name === name);
  if (!tool) return c.json({ error: 'alat tidak dikenal' }, 400);

  try {
    const result = await tool.run(
      { db: c.env.DB, userId: user.sub, today: jakartaToday() },
      body.args ?? {}
    );
    return c.json({ status: 'dijalankan', ringkasan: result.ringkasan, ids: result.ids });
  } catch (err) {
    if (err instanceof ToolError) return c.json({ error: err.message }, 400);
    console.error(`[agent] konfirmasi ${name} gagal`, err);
    return c.json({ error: 'gagal menjalankan aksi' }, 500);
  }
});

export default agent;
