/**
 * Perawatan ternak: apa yang jatuh tempo, apa yang sudah dikerjakan, dan
 * penyesuaian pengguna atas jadwal katalog.
 *
 * `jadwalPengguna` sengaja diekspor. Ia satu-satunya tempat jadwal kandang
 * dan jadwal hewan digabung, dan cron push serta Pagi Ini memakainya juga —
 * dua hitungan terpisah untuk pertanyaan yang sama pasti akan menyimpang,
 * dan yang menyimpang diam-diam adalah pengingat yang salah.
 */

import { Hono } from 'hono';
import { requireAuth, type AuthContext } from '../middleware/auth';
import { nanoid } from '../lib/nanoid';
import { jakartaToday } from '../lib/validate';
import { ANIMAL_BY_ID, type TugasKatalog } from '../data/animals';
import { jadwalSubjek, type Subjek, type Ubahan, type TugasJatuhTempo } from '../lib/ternak_jadwal';
import { namaSubjekHewan } from './ternak';

const care = new Hono<AuthContext>();
care.use('/*', requireAuth);

const TANGGAL = /^\d{4}-\d{2}-\d{2}$/;
const SUBJEK_TIPE = ['kandang', 'hewan'] as const;
type SubjekTipe = (typeof SUBJEK_TIPE)[number];

function isSubjekTipe(v: unknown): v is SubjekTipe {
  return v === 'kandang' || v === 'hewan';
}

/** Sama dengan `geser` di lib/ternak_jadwal.ts — tidak diekspor dari sana. */
function geser(tanggal: string, hari: number): string {
  const d = new Date(`${tanggal}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + hari);
  return d.toISOString().slice(0, 10);
}

interface KandangJadwalRow {
  id: string;
  nama: string;
  tanggal_mulai: string;
  animal_id: string | null;
}

interface HewanJadwalRow {
  id: string;
  animal_id: string | null;
  nama_kustom: string | null;
  nama_panggilan: string | null;
  tanggal_masuk: string;
}

interface UbahanRow {
  subjek_tipe: string;
  subjek_id: string;
  kode_tugas: string;
  tiap_hari: number | null;
  nonaktif: number;
  nama_kustom: string | null;
  cara_kustom: string | null;
}

interface LogTerakhirRow {
  subjek_tipe: string;
  subjek_id: string;
  kode_tugas: string;
  tanggal: string;
}

/**
 * Seluruh tugas jatuh tempo milik satu pengguna, kandang dan hewan sekaligus.
 *
 * Empat kueri, bukan satu per subjek: kebun dengan dua puluh tanaman pernah
 * membuat halaman jadwal mengeluarkan puluhan kueri berurutan, dan D1
 * membatasi jumlah subrequest per permintaan.
 */
export async function jadwalPengguna(
  db: D1Database,
  userId: string,
  hariIni: string
): Promise<TugasJatuhTempo[]> {
  const [kandang, hewan, ubahan, log] = await Promise.all([
    db.prepare(
      `SELECT k.id, k.nama, k.tanggal_mulai,
              (SELECT h.animal_id FROM ternak_hewan h
                WHERE h.kandang_id = k.id AND h.status = 'hidup'
                ORDER BY h.created_at ASC LIMIT 1) AS animal_id
         FROM ternak_kandang k
        WHERE k.user_id = ?1 AND k.status = 'aktif'`
    ).bind(userId).all<KandangJadwalRow>(),
    db.prepare(
      `SELECT id, animal_id, nama_kustom, nama_panggilan, tanggal_masuk
         FROM ternak_hewan WHERE user_id = ?1 AND status = 'hidup'`
    ).bind(userId).all<HewanJadwalRow>(),
    db.prepare(
      `SELECT subjek_tipe, subjek_id, kode_tugas, tiap_hari, nonaktif,
              nama_kustom, cara_kustom
         FROM ternak_tugas_ubah WHERE user_id = ?1`
    ).bind(userId).all<UbahanRow>(),
    db.prepare(
      `SELECT subjek_tipe, subjek_id, kode_tugas, MAX(tanggal) AS tanggal
         FROM ternak_log WHERE user_id = ?1
        GROUP BY subjek_tipe, subjek_id, kode_tugas`
    ).bind(userId).all<LogTerakhirRow>(),
  ]);

  // Tugas kandang diambil dari spesies penghuni pertamanya. Satu akuarium
  // berisi satu jenis ikan adalah kasus yang jauh lebih umum daripada
  // campuran, dan mengambil tugas dari semua penghuni akan menagih ganti air
  // berkali-kali — persis yang dicegah pemisahan sasaran.
  //
  // Kandang tanpa penghuni hidup tidak punya spesies, jadi tidak menagih apa
  // pun; itu benar, karena akuarium kosong memang tidak perlu diganti airnya.
  const ubahanPerSubjek = new Map<string, Ubahan[]>();
  for (const u of ubahan.results ?? []) {
    const key = `${u.subjek_tipe}|${u.subjek_id}`;
    const list = ubahanPerSubjek.get(key) ?? [];
    list.push({
      kodeTugas: u.kode_tugas,
      tiapHari: u.tiap_hari,
      nonaktif: !!u.nonaktif,
      namaKustom: u.nama_kustom,
      caraKustom: u.cara_kustom,
    });
    ubahanPerSubjek.set(key, list);
  }

  const logPerSubjek = new Map<string, Map<string, string>>();
  for (const l of log.results ?? []) {
    const key = `${l.subjek_tipe}|${l.subjek_id}`;
    const map = logPerSubjek.get(key) ?? new Map<string, string>();
    map.set(l.kode_tugas, l.tanggal);
    logPerSubjek.set(key, map);
  }

  const hasil: TugasJatuhTempo[] = [];

  for (const k of kandang.results ?? []) {
    const subjek: Subjek = {
      tipe: 'kandang', id: k.id, nama: k.nama, animalId: k.animal_id, mulai: k.tanggal_mulai,
    };
    const katalog: TugasKatalog[] = subjek.animalId
      ? (ANIMAL_BY_ID.get(subjek.animalId)?.tugas ?? [])
      : [];
    const key = `kandang|${k.id}`;
    hasil.push(...jadwalSubjek(
      subjek, katalog, ubahanPerSubjek.get(key) ?? [], logPerSubjek.get(key) ?? new Map(), hariIni
    ));
  }

  for (const h of hewan.results ?? []) {
    const subjek: Subjek = {
      tipe: 'hewan', id: h.id, nama: namaSubjekHewan(h), animalId: h.animal_id, mulai: h.tanggal_masuk,
    };
    const katalog: TugasKatalog[] = subjek.animalId
      ? (ANIMAL_BY_ID.get(subjek.animalId)?.tugas ?? [])
      : [];
    const key = `hewan|${h.id}`;
    hasil.push(...jadwalSubjek(
      subjek, katalog, ubahanPerSubjek.get(key) ?? [], logPerSubjek.get(key) ?? new Map(), hariIni
    ));
  }

  return hasil.sort(
    (a, b) => b.telat - a.telat || a.berikutnya.localeCompare(b.berikutnya)
  );
}

/** 404 untuk subjek yang bukan milik pengguna ini, apa pun tipenya. */
async function subjekMilik(
  db: D1Database, userId: string, tipe: SubjekTipe, id: string
): Promise<boolean> {
  const tabel = tipe === 'kandang' ? 'ternak_kandang' : 'ternak_hewan';
  const row = await db.prepare(
    `SELECT id FROM ${tabel} WHERE id = ?1 AND user_id = ?2`
  ).bind(id, userId).first<{ id: string }>();
  return row !== null;
}

/**
 * Spesies efektif satu subjek: animal_id-nya sendiri untuk hewan, animal_id
 * penghuni hidup pertama untuk kandang. Dipakai untuk mencegah kode tugas
 * custom bentrok dengan kode katalog spesies yang sama.
 */
async function spesiesSubjek(db: D1Database, tipe: SubjekTipe, id: string): Promise<string | null> {
  if (tipe === 'hewan') {
    const row = await db.prepare(
      'SELECT animal_id FROM ternak_hewan WHERE id = ?1'
    ).bind(id).first<{ animal_id: string | null }>();
    return row?.animal_id ?? null;
  }
  const row = await db.prepare(
    `SELECT h.animal_id FROM ternak_hewan h
      WHERE h.kandang_id = ?1 AND h.status = 'hidup'
      ORDER BY h.created_at ASC LIMIT 1`
  ).bind(id).first<{ animal_id: string | null }>();
  return row?.animal_id ?? null;
}

// GET /api/ternak/jadwal?hari=14
// `hari` adalah cakrawala tampil (default 14, maksimal 60) — hanya membatasi
// `tugas`, bukan hitungannya; tugas yang sudah lama telat tetap terhitung
// telat penuh, tidak dipotong ke batas cakrawala.
care.get('/jadwal', async (c) => {
  const user = c.get('user');
  const today = jakartaToday();
  const hari = Math.min(60, Math.max(1, Number(c.req.query('hari')) || 14));
  const until = geser(today, hari);

  const semua = await jadwalPengguna(c.env.DB, user.sub, today);
  const tugas = semua.filter((t) => t.berikutnya <= until);
  const jatuhTempo = tugas.filter((t) => t.berikutnya <= today);
  const penting = jatuhTempo.filter((t) => t.penting);

  return c.json({ today, tugas, jatuhTempo, penting });
});

// POST /api/ternak/log  { subjekTipe, subjekId, kodeTugas, tanggal?, nilai?, catatan? }
care.post('/log', async (c) => {
  const user = c.get('user');
  type Body = {
    subjekTipe?: string; subjekId?: string; kodeTugas?: string;
    tanggal?: string; nilai?: number; catatan?: string;
  };
  const body = await c.req.json<Body>().catch((): Body => ({}));

  if (!isSubjekTipe(body.subjekTipe)) {
    return c.json({ error: `subjekTipe harus salah satu dari: ${SUBJEK_TIPE.join(', ')}` }, 400);
  }
  const subjekId = body.subjekId?.trim();
  if (!subjekId) return c.json({ error: 'subjekId wajib diisi' }, 400);
  const kodeTugas = body.kodeTugas?.trim();
  if (!kodeTugas) return c.json({ error: 'kodeTugas wajib diisi' }, 400);

  if (!(await subjekMilik(c.env.DB, user.sub, body.subjekTipe, subjekId))) {
    return c.json({ error: `${body.subjekTipe} tidak ditemukan` }, 404);
  }

  // Tanggal yang tidak valid jatuh ke hari ini, bukan ditolak — pengguna yang
  // mencatat sambil terburu-buru tidak boleh dihukum karena keliru ketik
  // tanggal saat yang penting adalah tindakannya benar-benar tercatat.
  const tanggal = typeof body.tanggal === 'string' && TANGGAL.test(body.tanggal)
    ? body.tanggal
    : jakartaToday();

  const id = nanoid();
  await c.env.DB.prepare(`
    INSERT INTO ternak_log (id, user_id, subjek_tipe, subjek_id, kode_tugas, tanggal, nilai, catatan)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
  `).bind(
    id, user.sub, body.subjekTipe, subjekId, kodeTugas, tanggal,
    body.nilai ?? null, body.catatan?.trim() || null
  ).run();

  return c.json({ id }, 201);
});

// GET /api/ternak/log/:subjekTipe/:subjekId
care.get('/log/:subjekTipe/:subjekId', async (c) => {
  const user = c.get('user');
  const subjekTipeParam = c.req.param('subjekTipe');
  const subjekId = c.req.param('subjekId');

  if (!isSubjekTipe(subjekTipeParam)) {
    return c.json({ error: `subjekTipe harus salah satu dari: ${SUBJEK_TIPE.join(', ')}` }, 400);
  }

  if (!(await subjekMilik(c.env.DB, user.sub, subjekTipeParam, subjekId))) {
    return c.json({ error: `${subjekTipeParam} tidak ditemukan` }, 404);
  }

  const rows = await c.env.DB.prepare(`
    SELECT id, kode_tugas, tanggal, nilai, catatan
      FROM ternak_log
     WHERE user_id = ?1 AND subjek_tipe = ?2 AND subjek_id = ?3
     ORDER BY tanggal DESC, created_at DESC
  `).bind(user.sub, subjekTipeParam, subjekId)
    .all<{ id: string; kode_tugas: string; tanggal: string; nilai: number | null; catatan: string | null }>();

  const log = (rows.results ?? []).map((r) => ({
    id: r.id, kodeTugas: r.kode_tugas, tanggal: r.tanggal, nilai: r.nilai, catatan: r.catatan,
  }));

  return c.json({ log });
});

// PATCH /api/ternak/tugas  { subjekTipe, subjekId, kodeTugas, tiapHari?, nonaktif?, namaKustom?, caraKustom? }
// Baca-ubah-tulis, bukan overwrite penuh: field yang tidak dikirim tetap
// memakai nilai baris yang sudah ada (atau default katalog kalau baris belum
// ada), supaya mengubah satu field tidak diam-diam menghapus field lain yang
// sudah pernah diisi pengguna. `tiapHari: null` eksplisit tetap tersimpan
// sebagai null — itulah caranya menghapus penyesuaian dan kembali ke katalog.
care.patch('/tugas', async (c) => {
  const user = c.get('user');
  type Body = {
    subjekTipe?: string; subjekId?: string; kodeTugas?: string;
    tiapHari?: number | null; nonaktif?: boolean;
    namaKustom?: string | null; caraKustom?: string | null;
  };
  const body = await c.req.json<Body>().catch((): Body => ({}));

  if (!isSubjekTipe(body.subjekTipe)) {
    return c.json({ error: `subjekTipe harus salah satu dari: ${SUBJEK_TIPE.join(', ')}` }, 400);
  }
  const subjekId = body.subjekId?.trim();
  const kodeTugas = body.kodeTugas?.trim();
  if (!subjekId || !kodeTugas) {
    return c.json({ error: 'subjekId dan kodeTugas wajib diisi' }, 400);
  }

  if (!(await subjekMilik(c.env.DB, user.sub, body.subjekTipe, subjekId))) {
    return c.json({ error: `${body.subjekTipe} tidak ditemukan` }, 404);
  }

  const existing = await c.env.DB.prepare(`
    SELECT tiap_hari, nonaktif, nama_kustom, cara_kustom FROM ternak_tugas_ubah
     WHERE subjek_tipe = ?1 AND subjek_id = ?2 AND kode_tugas = ?3
  `).bind(body.subjekTipe, subjekId, kodeTugas)
    .first<{ tiap_hari: number | null; nonaktif: number; nama_kustom: string | null; cara_kustom: string | null }>();

  const tiapHari = 'tiapHari' in body ? body.tiapHari ?? null : (existing?.tiap_hari ?? null);
  const nonaktif = body.nonaktif !== undefined ? (body.nonaktif ? 1 : 0) : (existing?.nonaktif ?? 0);
  const namaKustom = 'namaKustom' in body ? (body.namaKustom?.trim() || null) : (existing?.nama_kustom ?? null);
  const caraKustom = 'caraKustom' in body ? (body.caraKustom?.trim() || null) : (existing?.cara_kustom ?? null);

  await c.env.DB.prepare(`
    INSERT INTO ternak_tugas_ubah
      (user_id, subjek_tipe, subjek_id, kode_tugas, tiap_hari, nonaktif, nama_kustom, cara_kustom, updated_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, unixepoch())
    ON CONFLICT (subjek_tipe, subjek_id, kode_tugas) DO UPDATE SET
      tiap_hari = excluded.tiap_hari,
      nonaktif = excluded.nonaktif,
      nama_kustom = excluded.nama_kustom,
      cara_kustom = excluded.cara_kustom,
      updated_at = excluded.updated_at
  `).bind(user.sub, body.subjekTipe, subjekId, kodeTugas, tiapHari, nonaktif, namaKustom, caraKustom).run();

  return c.json({ ok: true });
});

// POST /api/ternak/tugas/custom  { subjekTipe, subjekId, kodeTugas, nama, tiapHari, cara? }
care.post('/tugas/custom', async (c) => {
  const user = c.get('user');
  type Body = {
    subjekTipe?: string; subjekId?: string; kodeTugas?: string;
    nama?: string; tiapHari?: number; cara?: string;
  };
  const body = await c.req.json<Body>().catch((): Body => ({}));

  if (!isSubjekTipe(body.subjekTipe)) {
    return c.json({ error: `subjekTipe harus salah satu dari: ${SUBJEK_TIPE.join(', ')}` }, 400);
  }
  const subjekId = body.subjekId?.trim();
  const kodeTugas = body.kodeTugas?.trim();
  if (!subjekId || !kodeTugas) {
    return c.json({ error: 'subjekId dan kodeTugas wajib diisi' }, 400);
  }
  const nama = body.nama?.trim();
  if (!nama) return c.json({ error: 'nama wajib diisi' }, 400);
  if (typeof body.tiapHari !== 'number' || !Number.isFinite(body.tiapHari) || body.tiapHari <= 0) {
    return c.json({ error: 'tiapHari wajib diisi, harus angka positif' }, 400);
  }

  if (!(await subjekMilik(c.env.DB, user.sub, body.subjekTipe, subjekId))) {
    return c.json({ error: `${body.subjekTipe} tidak ditemukan` }, 404);
  }

  // Kalau dibiarkan bentrok, PATCH berikutnya akan mengubah dua hal
  // sekaligus tanpa pengguna tahu yang mana — jadi kode custom tidak boleh
  // sama dengan kode katalog milik spesies subjek ini.
  const animalId = await spesiesSubjek(c.env.DB, body.subjekTipe, subjekId);
  const katalog = animalId ? (ANIMAL_BY_ID.get(animalId)?.tugas ?? []) : [];
  if (katalog.some((t) => t.kode === kodeTugas)) {
    return c.json({ error: 'kodeTugas bentrok dengan kode katalog spesies ini' }, 400);
  }

  await c.env.DB.prepare(`
    INSERT INTO ternak_tugas_ubah
      (user_id, subjek_tipe, subjek_id, kode_tugas, tiap_hari, nonaktif, nama_kustom, cara_kustom)
    VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, ?7)
    ON CONFLICT (subjek_tipe, subjek_id, kode_tugas) DO UPDATE SET
      tiap_hari = excluded.tiap_hari,
      nonaktif = 0,
      nama_kustom = excluded.nama_kustom,
      cara_kustom = excluded.cara_kustom,
      updated_at = unixepoch()
  `).bind(
    user.sub, body.subjekTipe, subjekId, kodeTugas, Math.round(body.tiapHari),
    nama, body.cara?.trim() || null
  ).run();

  return c.json({ ok: true }, 201);
});

export default care;
