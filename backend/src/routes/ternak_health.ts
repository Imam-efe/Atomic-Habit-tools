/**
 * Kesehatan ternak: ukur pertumbuhan, tes air, kepadatan kandang, dan
 * karantina hewan baru.
 *
 * Empat hal yang tidak muncul di jadwal perawatan karena tidak punya jadwal
 * tetap — berat badan turun kapan saja, air memburuk kapan saja, kandang jadi
 * sesak begitu penghuni baru ditambah, dan risiko penularan cuma berlaku
 * selama dua pekan pertama seekor hewan baru datang. Semuanya baru kelihatan
 * kalau seseorang mengukurnya dan membaca angkanya terhadap sesuatu, bukan
 * cuma mencatatnya.
 */

import { Hono } from 'hono';
import { requireAuth, type AuthContext } from '../middleware/auth';
import { nanoid } from '../lib/nanoid';
import { jakartaToday } from '../lib/validate';
import { ANIMAL_BY_ID } from '../data/animals';
import { nilaiAir, type HasilAir } from '../lib/ternak_air';
import { cekKepadatan, type Penghuni } from '../lib/ternak_kepadatan';
import { statusKarantina } from '../lib/ternak_biosekuriti';
import { spesiesKandang } from '../lib/ternak_spesies';
import { namaSubjekHewan } from './ternak';

const health = new Hono<AuthContext>();
health.use('/*', requireAuth);

const TANGGAL = /^\d{4}-\d{2}-\d{2}$/;

async function hewanMilik(db: D1Database, userId: string, hewanId: string): Promise<boolean> {
  const row = await db.prepare(
    'SELECT id FROM ternak_hewan WHERE id = ?1 AND user_id = ?2'
  ).bind(hewanId, userId).first<{ id: string }>();
  return row !== null;
}

async function kandangMilik(
  db: D1Database, userId: string, kandangId: string
): Promise<{ habitat: string } | null> {
  return db.prepare(
    'SELECT habitat FROM ternak_kandang WHERE id = ?1 AND user_id = ?2'
  ).bind(kandangId, userId).first<{ habitat: string }>();
}

// ────────────────────────────── PERTUMBUHAN ──────────────────────────────

// POST /api/ternak/ukur/:hewanId  { tanggal?, beratGram?, panjangCm?, catatan? }
// Setidaknya salah satu dari beratGram/panjangCm wajib diisi — baris tanpa
// keduanya bukan pengukuran apa pun. beratGram (dan panjangCm bila diisi)
// harus positif; nol atau negatif adalah salah ukur, bukan data.
health.post('/ukur/:hewanId', async (c) => {
  const user = c.get('user');
  const hewanId = c.req.param('hewanId');
  type Body = { tanggal?: string; beratGram?: number; panjangCm?: number; catatan?: string };
  const body = await c.req.json<Body>().catch((): Body => ({}));

  if (!(await hewanMilik(c.env.DB, user.sub, hewanId))) {
    return c.json({ error: 'hewan tidak ditemukan' }, 404);
  }

  const beratGram = body.beratGram !== undefined ? body.beratGram : null;
  const panjangCm = body.panjangCm !== undefined ? body.panjangCm : null;

  if (beratGram === null && panjangCm === null) {
    return c.json({ error: 'isi berat atau panjang, minimal salah satu' }, 400);
  }
  if (beratGram !== null && beratGram <= 0) {
    return c.json({ error: 'berat harus lebih dari 0' }, 400);
  }
  if (panjangCm !== null && panjangCm <= 0) {
    return c.json({ error: 'panjang harus lebih dari 0' }, 400);
  }

  const tanggal = typeof body.tanggal === 'string' && TANGGAL.test(body.tanggal)
    ? body.tanggal
    : jakartaToday();

  const id = nanoid();
  await c.env.DB.prepare(`
    INSERT INTO ternak_ukur (id, user_id, hewan_id, tanggal, berat_gram, panjang_cm, catatan)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
  `).bind(id, user.sub, hewanId, tanggal, beratGram, panjangCm, body.catatan?.trim() || null).run();

  return c.json({ id }, 201);
});

// GET /api/ternak/ukur/:hewanId — riwayat pengukuran, terbaru lebih dulu.
health.get('/ukur/:hewanId', async (c) => {
  const user = c.get('user');
  const hewanId = c.req.param('hewanId');

  if (!(await hewanMilik(c.env.DB, user.sub, hewanId))) {
    return c.json({ error: 'hewan tidak ditemukan' }, 404);
  }

  const rows = await c.env.DB.prepare(`
    SELECT id, tanggal, berat_gram, panjang_cm, catatan FROM ternak_ukur
     WHERE user_id = ?1 AND hewan_id = ?2
     ORDER BY tanggal DESC, created_at DESC
  `).bind(user.sub, hewanId).all<{
    id: string; tanggal: string; berat_gram: number | null; panjang_cm: number | null; catatan: string | null;
  }>();

  const ukur = (rows.results ?? []).map((r) => ({
    id: r.id, tanggal: r.tanggal, beratGram: r.berat_gram, panjangCm: r.panjang_cm, catatan: r.catatan,
  }));

  return c.json({ ukur });
});

// ──────────────────────────────── TES AIR ────────────────────────────────

// POST /api/ternak/air/:kandangId
// { tanggal?, suhuC?, ph?, amoniaPpm?, nitritPpm?, nitratPpm?, salinitasPpt?, catatan? }
//
// Kandang berhabitat darat ditolak dengan alasan yang disebutkan, bukan
// disimpan diam-diam sebagai baris yang tidak akan pernah dibaca — kandang
// kucing atau ayam tidak punya air untuk dites.
health.post('/air/:kandangId', async (c) => {
  const user = c.get('user');
  const kandangId = c.req.param('kandangId');
  type Body = {
    tanggal?: string; suhuC?: number; ph?: number; amoniaPpm?: number;
    nitritPpm?: number; nitratPpm?: number; salinitasPpt?: number; catatan?: string;
  };
  const body = await c.req.json<Body>().catch((): Body => ({}));

  const kandang = await kandangMilik(c.env.DB, user.sub, kandangId);
  if (!kandang) return c.json({ error: 'kandang tidak ditemukan' }, 404);

  if (kandang.habitat === 'darat') {
    return c.json({
      error: 'kandang ini berhabitat darat — tidak ada air untuk dites di sini',
    }, 400);
  }

  const suhuC = body.suhuC ?? null;
  const ph = body.ph ?? null;
  const amoniaPpm = body.amoniaPpm ?? null;
  const nitritPpm = body.nitritPpm ?? null;
  const nitratPpm = body.nitratPpm ?? null;
  const salinitasPpt = body.salinitasPpt ?? null;

  if ([suhuC, ph, amoniaPpm, nitritPpm, nitratPpm, salinitasPpt].every((v) => v === null)) {
    return c.json({ error: 'isi minimal satu parameter tes air' }, 400);
  }

  const tanggal = typeof body.tanggal === 'string' && TANGGAL.test(body.tanggal)
    ? body.tanggal
    : jakartaToday();

  const id = nanoid();
  await c.env.DB.prepare(`
    INSERT INTO ternak_air
      (id, user_id, kandang_id, tanggal, suhu_c, ph, amonia_ppm, nitrit_ppm, nitrat_ppm, salinitas_ppt, catatan)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
  `).bind(
    id, user.sub, kandangId, tanggal, suhuC, ph, amoniaPpm, nitritPpm, nitratPpm, salinitasPpt,
    body.catatan?.trim() || null
  ).run();

  return c.json({ id }, 201);
});

// GET /api/ternak/air/:kandangId — riwayat tes air BESERTA penilaiannya.
//
// Angka mentah tidak berarti apa-apa bagi orang yang baru memelihara ikan;
// `nilaiAir` yang menerjemahkannya jadi "aman/waspada/bahaya" dan saran
// konkret. Rentang pH/suhu/salinitas dinilai terhadap spesies penghuni
// pertama kandang ini, sama seperti jadwal tugas mengambilnya.
health.get('/air/:kandangId', async (c) => {
  const user = c.get('user');
  const kandangId = c.req.param('kandangId');

  const kandang = await kandangMilik(c.env.DB, user.sub, kandangId);
  if (!kandang) return c.json({ error: 'kandang tidak ditemukan' }, 404);

  const animalIdKandang = await spesiesKandang(c.env.DB, kandangId, user.sub);
  const animal = animalIdKandang ? (ANIMAL_BY_ID.get(animalIdKandang) ?? null) : null;

  const rows = await c.env.DB.prepare(`
    SELECT id, tanggal, suhu_c, ph, amonia_ppm, nitrit_ppm, nitrat_ppm, salinitas_ppt, catatan
      FROM ternak_air WHERE user_id = ?1 AND kandang_id = ?2
     ORDER BY tanggal DESC, created_at DESC
  `).bind(user.sub, kandangId).all<{
    id: string; tanggal: string; suhu_c: number | null; ph: number | null;
    amonia_ppm: number | null; nitrit_ppm: number | null; nitrat_ppm: number | null;
    salinitas_ppt: number | null; catatan: string | null;
  }>();

  const air = (rows.results ?? []).map((r) => {
    const hasil: HasilAir = {
      suhuC: r.suhu_c, ph: r.ph, amoniaPpm: r.amonia_ppm,
      nitritPpm: r.nitrit_ppm, nitratPpm: r.nitrat_ppm, salinitasPpt: r.salinitas_ppt,
    };
    return {
      id: r.id,
      tanggal: r.tanggal,
      suhuC: r.suhu_c,
      ph: r.ph,
      amoniaPpm: r.amonia_ppm,
      nitritPpm: r.nitrit_ppm,
      nitratPpm: r.nitrat_ppm,
      salinitasPpt: r.salinitas_ppt,
      catatan: r.catatan,
      penilaian: nilaiAir(hasil, animal),
    };
  });

  return c.json({ air });
});

// ────────────────────────────── KEPADATAN ──────────────────────────────

// GET /api/ternak/kepadatan
//
// Hanya kandang dengan volume_liter yang bisa dinilai — filter di kueri, jadi
// kandang tanpa volume tidak muncul sama sekali, bukan muncul dengan nilai
// kosong yang harus ditafsirkan sendiri oleh tampilan.
health.get('/kepadatan', async (c) => {
  const user = c.get('user');

  const [kandangRows, hewanRows] = await Promise.all([
    c.env.DB.prepare(`
      SELECT id, nama, volume_liter FROM ternak_kandang
       WHERE user_id = ?1 AND volume_liter IS NOT NULL AND volume_liter > 0
    `).bind(user.sub).all<{ id: string; nama: string; volume_liter: number }>(),
    c.env.DB.prepare(`
      SELECT kandang_id, animal_id, jumlah FROM ternak_hewan
       WHERE user_id = ?1 AND status = 'hidup' AND kandang_id IS NOT NULL
    `).bind(user.sub).all<{ kandang_id: string; animal_id: string | null; jumlah: number }>(),
  ]);

  const penghuniPerKandang = new Map<string, Penghuni[]>();
  for (const h of hewanRows.results ?? []) {
    const list = penghuniPerKandang.get(h.kandang_id) ?? [];
    list.push({
      animalId: h.animal_id,
      jumlah: h.jumlah,
      literPerEkor: h.animal_id ? (ANIMAL_BY_ID.get(h.animal_id)?.literPerEkor ?? null) : null,
    });
    penghuniPerKandang.set(h.kandang_id, list);
  }

  const kepadatan = (kandangRows.results ?? [])
    .map((k) => {
      const nilai = cekKepadatan(k.volume_liter, penghuniPerKandang.get(k.id) ?? []);
      if (!nilai) return null;
      return { kandangId: k.id, nama: k.nama, volumeLiter: k.volume_liter, ...nilai };
    })
    .filter((k): k is NonNullable<typeof k> => k !== null);

  return c.json({ kepadatan });
});

// ────────────────────────────── KARANTINA ──────────────────────────────

interface HewanKarantinaRow {
  id: string;
  kandang_id: string;
  animal_id: string | null;
  nama_kustom: string | null;
  nama_panggilan: string | null;
  jumlah: number;
  tanggal_masuk: string;
}

// GET /api/ternak/karantina
//
// Hanya hewan yang (a) masuk kurang dari HARI_KARANTINA hari lalu DAN (b)
// berbagi kandang dengan penghuni lain yang bisa ditulari. "Penghuni lain"
// dihitung dari total penghuni hidup kandang itu dikurangi jumlah baris ini
// sendiri — definisi yang sama dengan `penghuni` di GET /api/ternak.
health.get('/karantina', async (c) => {
  const user = c.get('user');
  const today = jakartaToday();

  const rows = await c.env.DB.prepare(`
    SELECT id, kandang_id, animal_id, nama_kustom, nama_panggilan, jumlah, tanggal_masuk
      FROM ternak_hewan
     WHERE user_id = ?1 AND status = 'hidup' AND kandang_id IS NOT NULL
  `).bind(user.sub).all<HewanKarantinaRow>();

  const list = rows.results ?? [];

  const totalPerKandang = new Map<string, number>();
  for (const r of list) {
    totalPerKandang.set(r.kandang_id, (totalPerKandang.get(r.kandang_id) ?? 0) + r.jumlah);
  }

  const karantina = list
    .map((r) => {
      const totalLain = (totalPerKandang.get(r.kandang_id) ?? 0) - r.jumlah;
      const status = statusKarantina(r.tanggal_masuk, today, totalLain > 0);
      if (!status || status.aman) return null;
      return {
        hewanId: r.id,
        kandangId: r.kandang_id,
        nama: namaSubjekHewan(r),
        tanggalMasuk: r.tanggal_masuk,
        selesai: status.selesai,
        sisaHari: status.sisaHari,
      };
    })
    .filter((k): k is NonNullable<typeof k> => k !== null);

  return c.json({ today, karantina });
});

export default health;
