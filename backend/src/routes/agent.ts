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
import { findAction, listActions, recordAction, undoAction } from '../lib/agent_log';
import { cacheKey, readBudget, readCache, recordCall, writeCache } from '../lib/ai_budget';
import { loadSettings, num, bool } from '../lib/settings';

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
  /** Id catatan aksi. Dipakai tombol Batalkan; kosong kalau tidak ada yang ditulis. */
  actionId?: string;
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
  type AskBody = {
    message?: string;
    module?: string;
    /** Satu giliran sebelumnya, untuk permintaan lanjutan. */
    lanjutanDari?: { pertanyaan?: string; jawaban?: string };
  };
  const body = await c.req.json<AskBody>().catch((): AskBody => ({}));

  const message = body.message?.trim();
  if (!message) return c.json({ error: 'pertanyaan kosong' }, 400);
  if (message.length > 2000) return c.json({ error: 'pertanyaan terlalu panjang' }, 400);

  const module = isModuleKey(body.module) ? body.module : undefined;
  const today = jakartaToday();
  const available = toolsFor(module);

  const settings = await loadSettings(c.env.DB, user.sub);
  const limit = num(settings, 'ai.daily_limit');
  const budget = await readBudget(c.env.DB, user.sub, today, limit);
  if (budget.exhausted) {
    return c.json({ error: 'jatah AI habis', message: budget.notice, sisa: 0 }, 429);
  }

  // Layar tertentu membawa konteks modulnya sendiri; tanpa modul, potretnya
  // lintas-modul karena pertanyaannya bisa menyeberang ("cukup nggak uangnya
  // buat belanja bahan minggu ini").
  const modules: ModuleKey[] = module ? [module] : [...MODULES];
  const context = await buildContext(c.env.DB, user.sub, modules, today);

  /**
   * Satu giliran sebelumnya saja, bukan riwayat penuh.
   *
   * Tanpa ini, "tambahkan cabai juga" tidak mungkin — pengguna harus mengulang
   * seluruh kalimat. Dengan riwayat penuh, salah paham dari giliran ketiga
   * ikut terbawa ke giliran kesepuluh, dan di aplikasi yang aksinya menulis ke
   * database, salah paham yang menumpuk lebih mahal daripada mengetik ulang.
   * Satu giliran cukup untuk kata "juga" dan "yang tadi", dan tidak lebih.
   */
  const sebelumnya = body.lanjutanDari;
  const konteksLanjutan =
    typeof sebelumnya?.pertanyaan === 'string' && typeof sebelumnya?.jawaban === 'string'
      ? `\n\nPermintaan sebelumnya: ${sebelumnya.pertanyaan.slice(0, 500)}\nJawabanmu tadi: ${sebelumnya.jawaban.slice(0, 500)}`
      : '';

  // Cache hanya untuk pertanyaan, dan hanya jawaban yang tidak membawa aksi.
  // Memakai ulang rencana yang menulis berarti menulis dua kali. Giliran
  // sebelumnya ikut jadi kunci: "tambahkan satu lagi" berarti hal berbeda
  // setelah percakapan yang berbeda.
  const kunci = bool(settings, 'ai.cache_enabled')
    ? await cacheKey([user.sub, module ?? 'semua', message, context, konteksLanjutan])
    : null;

  if (kunci) {
    const cached = await readCache<{ jawaban: string }>(c.env.DB, user.sub, kunci);
    if (cached) {
      return c.json({
        jawaban: cached.jawaban, aksi: [], alatTidakDikenal: [],
        sisa: budget.remaining, catatanKuota: budget.notice, dariSimpanan: true,
      });
    }
  }

  let raw: unknown;
  try {
    raw = await runJson<Record<string, unknown>>(
      c.env,
      [
        { role: 'system', content: `${SYSTEM}\n\nALAT YANG TERSEDIA:\n${describeTools(available)}` },
        {
          role: 'user',
          content: `Hari ini ${today}.\n\nDATA PENGGUNA:\n${context || '(belum ada data)'}${konteksLanjutan}\n\nPermintaan: ${message}`,
        },
      ],
      planSchema(available),
      { maxTokens: 900 }
    );
  } catch (err) {
    console.error('[agent] AI gagal', err);
    return c.json({ error: 'AI sedang tidak bisa dihubungi' }, 503);
  }

  await recordCall(c.env.DB, user.sub, today);

  const plan = parsePlan(raw, available);
  if (!plan.jawaban && plan.actions.length === 0) {
    return c.json({ error: 'AI tidak memberi jawaban yang bisa dibaca' }, 502);
  }

  if (kunci && plan.actions.length === 0 && plan.jawaban) {
    await writeCache(c.env.DB, user.sub, kunci, { jawaban: plan.jawaban });
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

      // Dicatat setelah berhasil, bukan sebelum: catatan aksi yang gagal
      // hanya akan menawarkan pembatalan untuk sesuatu yang tidak pernah ada.
      let actionId: string | undefined;
      if (result.ids && result.ids.length > 0) {
        actionId = await recordAction(c.env.DB, user.sub, {
          tool: tool.name, module: tool.module, message,
          args, summary: result.ringkasan, rowIds: result.ids, undoMeta: result.undoMeta,
        });
      }

      laporan.push({
        alat: tool.name, modul: tool.module, status: 'dijalankan',
        ringkasan: result.ringkasan, ids: result.ids, actionId,
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
    // Sisa jatah dikirim tiap kali, supaya layar bisa memperingatkan sebelum
    // habis alih-alih sesudah.
    sisa: Math.max(0, budget.remaining - 1),
    catatanKuota: budget.notice,
  });
});

// POST /api/agent/confirm — jalankan aksi yang tadi ditahan
agent.post('/confirm', async (c) => {
  const user = c.get('user');
  type ConfirmBody = { tool?: string; args?: Record<string, unknown>; clientId?: string };
  const body = await c.req.json<ConfirmBody>().catch((): ConfirmBody => ({}));

  const name = body.tool?.trim();
  if (!name) return c.json({ error: 'alat tidak disebut' }, 400);

  /**
   * Id boleh datang dari klien, supaya kiriman ulang dari antrean offline
   * tidak menulis dua kali.
   *
   * Yang paling rawan justru di sini: aksi yang lewat sini adalah aksi uang,
   * dan pengeluaran yang tercatat dua kali merusak rekap berbulan-bulan.
   */
  const clientId = body.clientId?.trim();
  const actionKey = clientId && /^[A-Za-z0-9_-]{8,64}$/.test(clientId) ? clientId : undefined;

  if (actionKey) {
    const sudah = await findAction(c.env.DB, user.sub, actionKey);
    if (sudah) {
      return c.json({
        status: 'dijalankan', ringkasan: sudah.summary,
        ids: sudah.rowIds, actionId: actionKey, duplicate: true,
      });
    }
  }

  // Cakupannya seluruh alat: yang sampai ke sini sudah dilihat dan disetujui
  // pengguna, dan alatnya tetap divalidasi ulang lewat daftar tertutup.
  const tool = toolsFor().find((t) => t.name === name);
  if (!tool) return c.json({ error: 'alat tidak dikenal' }, 400);

  try {
    const args = body.args ?? {};
    const result = await tool.run({ db: c.env.DB, userId: user.sub, today: jakartaToday() }, args);

    let actionId: string | undefined;
    if (result.ids && result.ids.length > 0) {
      actionId = await recordAction(c.env.DB, user.sub, {
        tool: tool.name, module: tool.module, message: '(dikonfirmasi pengguna)',
        args, summary: result.ringkasan, rowIds: result.ids, undoMeta: result.undoMeta,
        id: actionKey,
      });
    }

    return c.json({ status: 'dijalankan', ringkasan: result.ringkasan, ids: result.ids, actionId });
  } catch (err) {
    if (err instanceof ToolError) return c.json({ error: err.message }, 400);
    console.error(`[agent] konfirmasi ${name} gagal`, err);
    return c.json({ error: 'gagal menjalankan aksi' }, 500);
  }
});

// GET /api/agent/history — apa saja yang AI lakukan
agent.get('/history', async (c) => {
  const user = c.get('user');
  const limit = Number(c.req.query('limit') ?? 50);
  const actions = await listActions(c.env.DB, user.sub, Number.isFinite(limit) ? limit : 50);
  return c.json({ actions });
});

// POST /api/agent/undo — batalkan satu aksi
agent.post('/undo', async (c) => {
  const user = c.get('user');
  type UndoBody = { actionId?: string };
  const body = await c.req.json<UndoBody>().catch((): UndoBody => ({}));

  const actionId = body.actionId?.trim();
  if (!actionId) return c.json({ error: 'aksi tidak disebut' }, 400);

  const hasil = await undoAction(c.env.DB, user.sub, actionId, jakartaToday());
  if (hasil.ok) return c.json({ ok: true, removed: hasil.removed });

  // Alasannya dipisah supaya layar bisa menjelaskan apa yang terjadi, bukan
  // sekadar bilang gagal.
  const pesan: Record<string, string> = {
    tidak_ditemukan: 'aksi tidak ditemukan',
    sudah_dibatalkan: 'aksi ini sudah dibatalkan',
    tidak_bisa_dibatalkan: 'aksi ini tidak bisa dibatalkan otomatis',
  };
  return c.json({ error: pesan[hasil.reason] }, hasil.reason === 'tidak_ditemukan' ? 404 : 400);
});

export default agent;
