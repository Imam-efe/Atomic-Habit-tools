/**
 * Kandang dan penghuninya.
 *
 * Dua lapis, karena sebagian tugas perawatan menempel pada wadah dan sebagian
 * pada ekornya. Lihat lib/ternak_jadwal.ts untuk sisi penjadwalannya.
 *
 * Tidak ada rute '/:id' telanjang di berkas ini. garden.ts punya satu, dan
 * rute itu menelan setiap path yang dipasang sesudahnya — dua kali sudah
 * memaksa urutan mounting yang rapuh.
 */

import { Hono } from 'hono';
import { requireAuth, type AuthContext } from '../middleware/auth';
import { nanoid } from '../lib/nanoid';
import { jakartaToday } from '../lib/validate';
import { ANIMAL_BY_ID } from '../data/animals';

const ternak = new Hono<AuthContext>();
ternak.use('/*', requireAuth);

const TANGGAL = /^\d{4}-\d{2}-\d{2}$/;
const HABITAT = ['darat', 'air-tawar', 'air-payau', 'air-laut'];
const JENIS_KANDANG = ['akuarium', 'kandang', 'kolam', 'umbaran'];
const STATUS_HEWAN = ['hidup', 'mati', 'dilepas', 'dijual'];

interface HewanRow {
  animal_id: string | null;
  nama_kustom: string | null;
  nama_panggilan: string | null;
}

/**
 * Nama yang ditampilkan untuk satu hewan.
 *
 * Panggilan menang atas nama katalog: pemiliknya memanggil kucingnya Mimi,
 * bukan "Kucing domestik".
 */
export function namaSubjekHewan(r: HewanRow): string {
  return r.nama_panggilan
    ?? (r.animal_id ? ANIMAL_BY_ID.get(r.animal_id)?.nama : undefined)
    ?? r.nama_kustom
    ?? 'Hewan';
}

interface KandangRow {
  id: string;
  nama: string;
  jenis: string;
  habitat: string;
  volume_liter: number | null;
  lokasi: string | null;
  tanggal_mulai: string;
  status: string;
  penghuni: number;
}

interface HewanFullRow {
  id: string;
  kandang_id: string | null;
  animal_id: string | null;
  nama_kustom: string | null;
  nama_panggilan: string | null;
  jumlah: number;
  kelamin: string | null;
  tanggal_lahir: string | null;
  tanggal_masuk: string;
  status: string;
}

// GET /api/ternak — ringkasan, kandang, dan hewan dalam satu permintaan.
// Satu panggilan, bukan tiga: layar ini dibuka dengan satu ketukan dan tiga
// permintaan berurutan membuatnya terasa lambat di jaringan seluler.
ternak.get('/', async (c) => {
  const user = c.get('user');
  const today = jakartaToday();

  const [kandangRows, hewanRows, ringkasanRow] = await Promise.all([
    c.env.DB.prepare(`
      SELECT k.id, k.nama, k.jenis, k.habitat, k.volume_liter, k.lokasi,
             k.tanggal_mulai, k.status,
             (SELECT COALESCE(SUM(h.jumlah), 0) FROM ternak_hewan h
               WHERE h.kandang_id = k.id AND h.status = 'hidup') AS penghuni
        FROM ternak_kandang k
       WHERE k.user_id = ?1
       ORDER BY k.status ASC, k.nama ASC
    `).bind(user.sub).all<KandangRow>(),
    c.env.DB.prepare(`
      SELECT id, kandang_id, animal_id, nama_kustom, nama_panggilan, jumlah,
             kelamin, tanggal_lahir, tanggal_masuk, status
        FROM ternak_hewan WHERE user_id = ?1
       ORDER BY status ASC, created_at ASC
    `).bind(user.sub).all<HewanFullRow>(),
    c.env.DB.prepare(`
      SELECT
        (SELECT COUNT(*) FROM ternak_kandang WHERE user_id = ?1 AND status = 'aktif') AS kandang_aktif,
        (SELECT COUNT(*) FROM ternak_hewan WHERE user_id = ?1 AND status = 'hidup') AS hewan_hidup,
        (SELECT COALESCE(SUM(jumlah), 0) FROM ternak_hewan WHERE user_id = ?1 AND status = 'hidup') AS ekor_total
    `).bind(user.sub).first<{ kandang_aktif: number; hewan_hidup: number; ekor_total: number }>(),
  ]);

  const kandang = (kandangRows.results ?? []).map((k) => ({
    id: k.id,
    nama: k.nama,
    jenis: k.jenis,
    habitat: k.habitat,
    volumeLiter: k.volume_liter,
    lokasi: k.lokasi,
    tanggalMulai: k.tanggal_mulai,
    status: k.status,
    jumlahPenghuni: k.penghuni,
  }));

  const hewan = (hewanRows.results ?? []).map((h) => {
    const animal = h.animal_id ? ANIMAL_BY_ID.get(h.animal_id) : undefined;
    // Hewan hidup, punya spesies katalog, tanpa kandang, dan spesiesnya
    // punya tugas bersasaran kandang: tugas itu tidak dimiliki siapa pun dan
    // tidak akan pernah dijadwalkan sampai kandangnya diisi. Lihat POST
    // /hewan untuk penjelasan lengkap kenapa ini terjadi.
    //
    // Dua populasi, bukan satu: mayoritas spesies (termasuk kucing rumahan,
    // yang litter box-nya sengaja tidak dianggap "kandang" — lihat migrasi
    // 0040) punya tugas kandang tapi bukan yang fatal kalau telat. Baris
    // catatan hewan (TernakAnimals.tsx) boleh memakai populasi luas ini;
    // strip peringatan di Hari Ini (Ternak.tsx) yang khusus untuk ancaman
    // nyawa hanya boleh memakai versi `Penting`.
    const dormanTugas = animal?.tugas.filter((t) => t.sasaran === 'kandang') ?? [];
    const tugasKandangDorman = h.status === 'hidup' && !h.kandang_id && dormanTugas.length > 0;
    const tugasKandangDormanPenting =
      tugasKandangDorman && dormanTugas.some((t) => t.penting);
    return {
      id: h.id,
      kandangId: h.kandang_id,
      animalId: h.animal_id,
      nama: namaSubjekHewan(h),
      emoji: animal?.emoji ?? '🐾',
      jumlah: h.jumlah,
      status: h.status,
      tanggalMasuk: h.tanggal_masuk,
      kesulitan: animal?.kesulitan ?? null,
      tugasKandangDorman,
      tugasKandangDormanPenting,
    };
  });

  return c.json({
    today,
    kandang,
    hewan,
    ringkasan: {
      kandangAktif: ringkasanRow?.kandang_aktif ?? 0,
      hewanHidup: ringkasanRow?.hewan_hidup ?? 0,
      ekorTotal: ringkasanRow?.ekor_total ?? 0,
    },
  });
});

// POST /api/ternak/kandang
// Validasi: nama setelah trim tidak boleh kosong (400); jenis harus di
// JENIS_KANDANG (400); habitat harus di HABITAT (400); tanggalMulai harus
// cocok TANGGAL, kalau tidak dipakai jakartaToday().
ternak.post('/kandang', async (c) => {
  const user = c.get('user');
  type Body = {
    nama?: string; jenis?: string; habitat?: string;
    volumeLiter?: number; lokasi?: string; tanggalMulai?: string; catatan?: string;
  };
  const body = await c.req.json<Body>().catch((): Body => ({}));

  const nama = body.nama?.trim();
  if (!nama) return c.json({ error: 'nama wajib diisi' }, 400);
  if (!JENIS_KANDANG.includes(body.jenis ?? '')) {
    return c.json({ error: `jenis harus salah satu dari: ${JENIS_KANDANG.join(', ')}` }, 400);
  }
  if (!HABITAT.includes(body.habitat ?? '')) {
    return c.json({ error: `habitat harus salah satu dari: ${HABITAT.join(', ')}` }, 400);
  }

  const tanggalMulai = typeof body.tanggalMulai === 'string' && TANGGAL.test(body.tanggalMulai)
    ? body.tanggalMulai
    : jakartaToday();

  const id = nanoid();
  await c.env.DB.prepare(`
    INSERT INTO ternak_kandang
      (id, user_id, nama, jenis, habitat, volume_liter, lokasi, tanggal_mulai, catatan)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
  `).bind(
    id, user.sub, nama, body.jenis, body.habitat,
    body.volumeLiter ?? null, body.lokasi?.trim() || null,
    tanggalMulai, body.catatan?.trim() || null
  ).run();

  return c.json({ id }, 201);
});

// PATCH /api/ternak/kandang/:id — UPDATE ... WHERE id = ?1 AND user_id = ?2,
// 404 bila meta.changes === 0.
ternak.patch('/kandang/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  type Body = {
    nama?: string; jenis?: string; habitat?: string;
    volumeLiter?: number; lokasi?: string; status?: string; catatan?: string;
  };
  const body = await c.req.json<Body>().catch((): Body => ({}));

  const sets: string[] = [];
  const binds: unknown[] = [];
  const set = (column: string, value: unknown) => {
    binds.push(value);
    sets.push(`${column} = ?${binds.length}`);
  };

  if (body.nama !== undefined) {
    const nama = body.nama.trim();
    if (!nama) return c.json({ error: 'nama tidak boleh kosong' }, 400);
    set('nama', nama);
  }
  if (body.jenis !== undefined) {
    if (!JENIS_KANDANG.includes(body.jenis)) {
      return c.json({ error: `jenis harus salah satu dari: ${JENIS_KANDANG.join(', ')}` }, 400);
    }
    set('jenis', body.jenis);
  }
  if (body.habitat !== undefined) {
    if (!HABITAT.includes(body.habitat)) {
      return c.json({ error: `habitat harus salah satu dari: ${HABITAT.join(', ')}` }, 400);
    }
    set('habitat', body.habitat);
  }
  if (body.volumeLiter !== undefined) set('volume_liter', body.volumeLiter);
  if (body.lokasi !== undefined) set('lokasi', body.lokasi.trim() || null);
  if (body.catatan !== undefined) set('catatan', body.catatan.trim() || null);
  if (body.status !== undefined) {
    if (!['aktif', 'nonaktif'].includes(body.status)) {
      return c.json({ error: 'status harus salah satu dari: aktif, nonaktif' }, 400);
    }
    set('status', body.status);
  }

  if (sets.length === 0) return c.json({ error: 'tidak ada yang diubah' }, 400);

  binds.push(id, user.sub);
  const res = await c.env.DB.prepare(
    `UPDATE ternak_kandang SET ${sets.join(', ')} WHERE id = ?${binds.length - 1} AND user_id = ?${binds.length}`
  ).bind(...binds).run();

  if (res.meta.changes === 0) return c.json({ error: 'kandang tidak ditemukan' }, 404);
  return c.json({ ok: true });
});

// DELETE /api/ternak/kandang/:id — sama, 404 bila tidak ada perubahan.
ternak.delete('/kandang/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const res = await c.env.DB.prepare(
    'DELETE FROM ternak_kandang WHERE id = ?1 AND user_id = ?2'
  ).bind(id, user.sub).run();
  if (res.meta.changes === 0) return c.json({ error: 'kandang tidak ditemukan' }, 404);
  return c.json({ ok: true });
});

// POST /api/ternak/hewan
// Validasi berurutan:
//   1. kandangId, bila diisi, harus milik pengguna ini — SELECT id FROM
//      ternak_kandang WHERE id = ?1 AND user_id = ?2, 404 bila tidak ada.
//   2. animalId, bila diisi, harus ada di ANIMAL_BY_ID (400 bila tidak).
//   3. Tanpa animalId maupun namaKustom, barisnya tidak punya identitas apa
//      pun dan akan tampil sebagai baris kosong di daftar — 400.
//   4. jumlah dibulatkan; kurang dari 1 ditolak 400.
//
// Respons 201 membawa `peringatan` (opsional) kalau spesiesnya punya tugas
// bersasaran kandang tapi hewan ini tidak dimasukkan ke kandang mana pun.
// jadwalSubjek/jadwalPengguna cuma menagih tugas kandang lewat kandangnya —
// tanpa kandang, tugas itu tidak dimiliki siapa pun dan diam-diam tidak
// pernah dijadwalkan. Peringatan ini satu-satunya tempat pengguna diberi
// tahu; tanpanya ia tidak akan pernah tahu kenapa jadwalnya kosong.
ternak.post('/hewan', async (c) => {
  const user = c.get('user');
  type Body = {
    kandangId?: string; animalId?: string; namaKustom?: string; namaPanggilan?: string;
    jumlah?: number; kelamin?: string; tanggalLahir?: string; tanggalMasuk?: string;
    asal?: string; catatan?: string;
  };
  const body = await c.req.json<Body>().catch((): Body => ({}));

  if (body.kandangId) {
    const owned = await c.env.DB.prepare(
      'SELECT id FROM ternak_kandang WHERE id = ?1 AND user_id = ?2'
    ).bind(body.kandangId, user.sub).first<{ id: string }>();
    if (!owned) return c.json({ error: 'kandang tidak ditemukan' }, 404);
  }

  if (body.animalId && !ANIMAL_BY_ID.has(body.animalId)) {
    return c.json({ error: 'animalId tidak ada di katalog' }, 400);
  }

  if (!body.animalId && !body.namaKustom?.trim()) {
    return c.json({ error: 'animalId atau namaKustom wajib diisi' }, 400);
  }

  const jumlah = body.jumlah !== undefined ? Math.round(body.jumlah) : 1;
  if (jumlah < 1) return c.json({ error: 'jumlah minimal 1' }, 400);

  const tanggalMasuk = typeof body.tanggalMasuk === 'string' && TANGGAL.test(body.tanggalMasuk)
    ? body.tanggalMasuk
    : jakartaToday();

  const id = nanoid();
  await c.env.DB.prepare(`
    INSERT INTO ternak_hewan
      (id, user_id, kandang_id, animal_id, nama_kustom, nama_panggilan, jumlah,
       kelamin, tanggal_lahir, tanggal_masuk, asal, catatan)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
  `).bind(
    id, user.sub, body.kandangId ?? null, body.animalId ?? null,
    body.animalId ? null : body.namaKustom!.trim(),
    body.namaPanggilan?.trim() || null,
    jumlah, body.kelamin?.trim() || null,
    body.tanggalLahir?.trim() || null, tanggalMasuk,
    body.asal?.trim() || null, body.catatan?.trim() || null
  ).run();

  if (!body.kandangId && body.animalId) {
    const jumlahTugasKandang = ANIMAL_BY_ID.get(body.animalId)?.tugas
      .filter((t) => t.sasaran === 'kandang').length ?? 0;
    if (jumlahTugasKandang > 0) {
      return c.json({
        id,
        peringatan: `${jumlahTugasKandang} tugas perawatan spesies ini menempel ke kandang, jadi belum dijadwalkan karena hewan ini belum punya kandang. Pilih kandang untuk mengaktifkannya.`,
      }, 201);
    }
  }

  return c.json({ id }, 201);
});

// PATCH /api/ternak/hewan/:id
// kandangId baru diverifikasi kepemilikannya lebih dulu (404 bila bukan
// miliknya). status di luar STATUS_HEWAN ditolak 400.
ternak.patch('/hewan/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  type Body = {
    kandangId?: string | null; namaPanggilan?: string; jumlah?: number;
    kelamin?: string; tanggalLahir?: string; status?: string; catatan?: string;
  };
  const body = await c.req.json<Body>().catch((): Body => ({}));

  if (body.kandangId !== undefined && body.kandangId !== null) {
    const owned = await c.env.DB.prepare(
      'SELECT id FROM ternak_kandang WHERE id = ?1 AND user_id = ?2'
    ).bind(body.kandangId, user.sub).first<{ id: string }>();
    if (!owned) return c.json({ error: 'kandang tidak ditemukan' }, 404);
  }

  if (body.status !== undefined && !STATUS_HEWAN.includes(body.status)) {
    return c.json({ error: `status harus salah satu dari: ${STATUS_HEWAN.join(', ')}` }, 400);
  }

  const sets: string[] = [];
  const binds: unknown[] = [];
  const set = (column: string, value: unknown) => {
    binds.push(value);
    sets.push(`${column} = ?${binds.length}`);
  };

  if (body.kandangId !== undefined) set('kandang_id', body.kandangId);
  if (body.namaPanggilan !== undefined) set('nama_panggilan', body.namaPanggilan.trim() || null);
  if (body.jumlah !== undefined) {
    const jumlah = Math.round(body.jumlah);
    if (jumlah < 1) return c.json({ error: 'jumlah minimal 1' }, 400);
    set('jumlah', jumlah);
  }
  if (body.kelamin !== undefined) set('kelamin', body.kelamin.trim() || null);
  if (body.tanggalLahir !== undefined) set('tanggal_lahir', body.tanggalLahir.trim() || null);
  if (body.catatan !== undefined) set('catatan', body.catatan.trim() || null);
  if (body.status !== undefined) set('status', body.status);

  if (sets.length === 0) return c.json({ error: 'tidak ada yang diubah' }, 400);

  binds.push(id, user.sub);
  const res = await c.env.DB.prepare(
    `UPDATE ternak_hewan SET ${sets.join(', ')} WHERE id = ?${binds.length - 1} AND user_id = ?${binds.length}`
  ).bind(...binds).run();

  if (res.meta.changes === 0) return c.json({ error: 'hewan tidak ditemukan' }, 404);
  return c.json({ ok: true });
});

// DELETE /api/ternak/hewan/:id
ternak.delete('/hewan/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const res = await c.env.DB.prepare(
    'DELETE FROM ternak_hewan WHERE id = ?1 AND user_id = ?2'
  ).bind(id, user.sub).run();
  if (res.meta.changes === 0) return c.json({ error: 'hewan tidak ditemukan' }, 404);
  return c.json({ ok: true });
});

export default ternak;
