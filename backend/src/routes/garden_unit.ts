/**
 * Nomor pot: satu identitas per tanaman fisik, tercetak di label dan bisa
 * diedit sendiri oleh pengguna.
 *
 * Berkas ini dinamai menurut pokok bahasannya, bukan `garden_extra5.ts`.
 * Penomoran extra2/3/4 menandai gelombang waktu; berkas ini punya satu pokok
 * bahasan yang jelas dan namanya sebaiknya menyebutkannya.
 *
 * Yang perlu diingat saat menyentuh berkas ini: `unit_no` permanen dan dipakai
 * semua relasi, `code` hanya untuk dibaca manusia dan bebas diubah. Setiap
 * operasi di sini boleh menyentuh `code` sesuka pengguna, tapi tidak satu pun
 * boleh menggeser `unit_no` — riwayat perawatan menggantung padanya.
 */

import { Hono } from 'hono';
import { requireAuth, type AuthContext } from '../middleware/auth';
import {
  speciesKey, bersihkanKode, kodeBerikutnya, ringkasKode, rencanaUbahKode,
  MAX_UNIT_PER_PLANTING, MAX_CODE_LEN,
  type Unit, type UnitLain,
} from '../lib/garden_unit';
import { PLANT_BY_ID } from '../data/plants';

const unitRoutes = new Hono<AuthContext>();
unitRoutes.use('/*', requireAuth);

interface UnitRow {
  planting_id: string;
  unit_no: number;
  species_key: string;
  code: string;
  retired_at: number | null;
}

/** Penanaman milik pengguna ini, atau null. Dipakai tiap handler bersuffiks id. */
async function penanamanMilik(db: D1Database, userId: string, plantingId: string) {
  return db.prepare(
    'SELECT id, plant_id, custom_name, nickname FROM garden_plantings WHERE id = ?1 AND user_id = ?2'
  ).bind(plantingId, userId).first<{
    id: string; plant_id: string | null; custom_name: string | null; nickname: string | null;
  }>();
}

function toUnit(r: UnitRow): Unit {
  return { unitNo: r.unit_no, code: r.code, retired: r.retired_at !== null };
}

/**
 * Seluruh unit sejenis milik pengguna — bahan untuk memeriksa tabrakan kode.
 *
 * Diambil lintas penanaman, bukan hanya dalam satu catatan: deret nomor
 * berlaku per jenis, jadi Cabai #5 di catatan lain tetap menabrak.
 */
async function unitSejenis(
  db: D1Database, userId: string, key: string
): Promise<UnitLain[]> {
  const rows = (await db.prepare(
    `SELECT planting_id, unit_no, code, retired_at FROM garden_planting_unit
      WHERE user_id = ?1 AND species_key = ?2`
  ).bind(userId, key).all<Omit<UnitRow, 'species_key'>>()).results ?? [];

  return rows.map((r) => ({
    plantingId: r.planting_id,
    unitNo: r.unit_no,
    code: r.code,
    retired: r.retired_at !== null,
  }));
}

/**
 * Kunci jenis yang BERLAKU untuk satu penanaman.
 *
 * Yang tersimpan di baris unit selalu menang; `speciesKey()` hanya dipakai
 * untuk penanaman yang memang belum punya unit sama sekali.
 *
 * Ini bukan kehati-hatian berlebih. Backfill migrasi menurunkan huruf nama
 * dengan `LOWER()` SQLite, yang hanya menyentuh ASCII, sedangkan
 * `speciesKey()` memakai `toLowerCase()` yang juga menurunkan Unicode. Untuk
 * nama seperti "Cabai Émas" keduanya menghasilkan kunci berbeda — dan kalau
 * kunci dihitung ulang tiap kali, unit hasil backfill jadi tak terlihat,
 * `unit_no` mengulang dari 1, lalu INSERT-nya menabrak primary key.
 *
 * Menjadikan yang tersimpan sebagai penentu juga menepati maksud yang sudah
 * ditulis di migrasinya: kunci disimpan supaya deret nomor tidak ikut bergeser
 * saat nama tanamannya berubah.
 */
async function kunciJenis(
  db: D1Database,
  userId: string,
  plantingId: string,
  p: { plant_id: string | null; custom_name: string | null }
): Promise<string> {
  const ada = await db.prepare(
    `SELECT species_key FROM garden_planting_unit
      WHERE planting_id = ?1 AND user_id = ?2 LIMIT 1`
  ).bind(plantingId, userId).first<{ species_key: string }>();

  return ada?.species_key ?? speciesKey(p.plant_id, p.custom_name);
}

function namaPenanaman(r: {
  plant_id: string | null; custom_name: string | null; nickname: string | null;
}): string {
  return r.nickname
    ?? (r.plant_id ? PLANT_BY_ID.get(r.plant_id)?.name : undefined)
    ?? r.custom_name
    ?? 'Tanaman';
}

// GET /api/garden/units — seluruh pot, dikelompokkan per penanaman
unitRoutes.get('/units', async (c) => {
  const user = c.get('user');

  const [unitRows, plantingRows] = await Promise.all([
    c.env.DB.prepare(
      `SELECT planting_id, unit_no, species_key, code, retired_at
         FROM garden_planting_unit WHERE user_id = ?1
        ORDER BY planting_id, unit_no`
    ).bind(user.sub).all<UnitRow>(),
    c.env.DB.prepare(
      `SELECT id, plant_id, custom_name, nickname, location, quantity, status
         FROM garden_plantings WHERE user_id = ?1 AND status IN ('tumbuh', 'panen')`
    ).bind(user.sub).all<{
      id: string; plant_id: string | null; custom_name: string | null;
      nickname: string | null; location: string | null; quantity: number; status: string;
    }>(),
  ]);

  const byPlanting = new Map<string, UnitRow[]>();
  for (const r of unitRows.results ?? []) {
    const daftar = byPlanting.get(r.planting_id) ?? [];
    daftar.push(r);
    byPlanting.set(r.planting_id, daftar);
  }

  return c.json({
    maxCodeLen: MAX_CODE_LEN,
    maxUnitPerPlanting: MAX_UNIT_PER_PLANTING,
    penanaman: (plantingRows.results ?? []).map((p) => {
      const units = (byPlanting.get(p.id) ?? []).map(toUnit);
      return {
        plantingId: p.id,
        nama: namaPenanaman(p),
        location: p.location,
        quantity: p.quantity,
        units,
        kodeRingkas: ringkasKode(units),
      };
    }),
  });
});

// GET /api/garden/units/:plantingId — pot satu penanaman
unitRoutes.get('/units/:plantingId', async (c) => {
  const user = c.get('user');
  const plantingId = c.req.param('plantingId');

  const p = await penanamanMilik(c.env.DB, user.sub, plantingId);
  if (!p) return c.json({ error: 'tanaman tidak ditemukan' }, 404);

  const rows = (await c.env.DB.prepare(
    `SELECT planting_id, unit_no, species_key, code, retired_at
       FROM garden_planting_unit WHERE planting_id = ?1 AND user_id = ?2
      ORDER BY unit_no`
  ).bind(plantingId, user.sub).all<UnitRow>()).results ?? [];

  const units = rows.map(toUnit);
  return c.json({
    plantingId,
    nama: namaPenanaman(p),
    units,
    kodeRingkas: ringkasKode(units),
    maxCodeLen: MAX_CODE_LEN,
  });
});

// POST /api/garden/units/:plantingId — tambah satu pot, kode otomatis
unitRoutes.post('/units/:plantingId', async (c) => {
  const user = c.get('user');
  const plantingId = c.req.param('plantingId');

  const p = await penanamanMilik(c.env.DB, user.sub, plantingId);
  if (!p) return c.json({ error: 'tanaman tidak ditemukan' }, 404);

  const key = await kunciJenis(c.env.DB, user.sub, plantingId, p);
  const sejenis = await unitSejenis(c.env.DB, user.sub, key);

  const diCatatanIni = sejenis.filter((u) => u.plantingId === plantingId);
  if (diCatatanIni.filter((u) => !u.retired).length >= MAX_UNIT_PER_PLANTING) {
    return c.json({ error: `satu catatan maksimal ${MAX_UNIT_PER_PLANTING} pot aktif` }, 400);
  }

  // unit_no berikutnya dihitung dari yang TERTINGGI yang pernah ada di catatan
  // ini, termasuk yang pensiun — ia kunci permanen dan tidak boleh dipakai
  // ulang, karena log perawatan lama masih menunjuk padanya.
  const unitNo = diCatatanIni.reduce((m, u) => Math.max(m, u.unitNo), 0) + 1;
  const code = kodeBerikutnya(sejenis.map((u) => u.code));

  await c.env.DB.prepare(
    `INSERT INTO garden_planting_unit (planting_id, unit_no, user_id, species_key, code)
     VALUES (?1, ?2, ?3, ?4, ?5)`
  ).bind(plantingId, unitNo, user.sub, key, code).run();

  return c.json({ plantingId, unitNo, code }, 201);
});

// PATCH /api/garden/units/:plantingId/:unitNo — ubah kode yang tercetak
unitRoutes.patch('/units/:plantingId/:unitNo', async (c) => {
  const user = c.get('user');
  const plantingId = c.req.param('plantingId');
  const unitNo = Number(c.req.param('unitNo'));
  if (!Number.isInteger(unitNo)) return c.json({ error: 'nomor pot tidak valid' }, 400);

  const body = await c.req.json<{ code?: unknown; izinkanTukar?: boolean }>().catch(() => null);
  if (!body) return c.json({ error: 'body tidak valid' }, 400);

  const p = await penanamanMilik(c.env.DB, user.sub, plantingId);
  if (!p) return c.json({ error: 'tanaman tidak ditemukan' }, 404);

  const ada = await c.env.DB.prepare(
    'SELECT unit_no FROM garden_planting_unit WHERE planting_id = ?1 AND unit_no = ?2 AND user_id = ?3'
  ).bind(plantingId, unitNo, user.sub).first<{ unit_no: number }>();
  if (!ada) return c.json({ error: 'pot tidak ditemukan' }, 404);

  const kode = bersihkanKode(body.code);
  if (!kode) {
    return c.json(
      { error: `Kode harus 1–${MAX_CODE_LEN} karakter, hanya huruf, angka, dan tanda hubung.` },
      400
    );
  }

  const key = await kunciJenis(c.env.DB, user.sub, plantingId, p);
  const sejenis = await unitSejenis(c.env.DB, user.sub, key);
  const rencana = rencanaUbahKode(kode, { plantingId, unitNo }, sejenis);

  if (rencana.jenis === 'ditolak') return c.json({ error: rencana.alasan }, 400);

  if (rencana.jenis === 'tukar') {
    // Tabrakan TIDAK ditimpa diam-diam. Menimpa akan meninggalkan dua pot
    // berkode sama sampai pengguna sadar sendiri — keadaan yang justru
    // dilarang seluruh fitur ini.
    if (!body.izinkanTukar) {
      const lawan = sejenis.find(
        (u) => u.plantingId === rencana.denganPlantingId && u.unitNo === rencana.denganUnitNo
      )!;
      return c.json({
        error: `Kode #${kode} sedang dipakai pot lain.`,
        usulTukar: {
          plantingId: rencana.denganPlantingId,
          unitNo: rencana.denganUnitNo,
          code: lawan.code,
        },
      }, 409);
    }

    const kodeLama = sejenis.find(
      (u) => u.plantingId === plantingId && u.unitNo === unitNo
    )?.code;
    if (kodeLama === undefined) return c.json({ error: 'pot tidak ditemukan' }, 404);

    // Satu batch, bukan dua UPDATE berurutan: kegagalan di tengah akan
    // meninggalkan dua pot berkode sama.
    await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE garden_planting_unit SET code = ?1
          WHERE planting_id = ?2 AND unit_no = ?3 AND user_id = ?4`
      ).bind(kode, plantingId, unitNo, user.sub),
      c.env.DB.prepare(
        `UPDATE garden_planting_unit SET code = ?1
          WHERE planting_id = ?2 AND unit_no = ?3 AND user_id = ?4`
      ).bind(kodeLama, rencana.denganPlantingId, rencana.denganUnitNo, user.sub),
    ]);

    return c.json({
      plantingId, unitNo, code: kode,
      ditukarDengan: {
        plantingId: rencana.denganPlantingId,
        unitNo: rencana.denganUnitNo,
        code: kodeLama,
      },
    });
  }

  await c.env.DB.prepare(
    `UPDATE garden_planting_unit SET code = ?1
      WHERE planting_id = ?2 AND unit_no = ?3 AND user_id = ?4`
  ).bind(kode, plantingId, unitNo, user.sub).run();

  return c.json({ plantingId, unitNo, code: kode });
});

/** Pensiunkan atau aktifkan lagi satu pot. */
async function setRetired(
  db: D1Database, userId: string, plantingId: string, unitNo: number, retired: boolean
): Promise<boolean> {
  const res = await db.prepare(
    `UPDATE garden_planting_unit SET retired_at = ?1
      WHERE planting_id = ?2 AND unit_no = ?3 AND user_id = ?4`
  ).bind(retired ? Math.floor(Date.now() / 1000) : null, plantingId, unitNo, userId).run();
  return (res.meta?.changes ?? 0) > 0;
}

// POST /api/garden/units/:plantingId/:unitNo/retire — pot mati atau dibuang
unitRoutes.post('/units/:plantingId/:unitNo/retire', async (c) => {
  const user = c.get('user');
  const unitNo = Number(c.req.param('unitNo'));
  if (!Number.isInteger(unitNo)) return c.json({ error: 'nomor pot tidak valid' }, 400);

  // Barisnya sengaja tidak dihapus: nomornya harus tetap terpakai supaya nomor
  // otomatis berikutnya tidak menabraknya, dan supaya log perawatan yang
  // menunjuk pot ini tetap punya induk.
  const ok = await setRetired(c.env.DB, user.sub, c.req.param('plantingId'), unitNo, true);
  if (!ok) return c.json({ error: 'pot tidak ditemukan' }, 404);
  return c.json({ ok: true, retired: true });
});

// POST /api/garden/units/:plantingId/:unitNo/restore — ternyata masih hidup
unitRoutes.post('/units/:plantingId/:unitNo/restore', async (c) => {
  const user = c.get('user');
  const unitNo = Number(c.req.param('unitNo'));
  if (!Number.isInteger(unitNo)) return c.json({ error: 'nomor pot tidak valid' }, 400);

  const ok = await setRetired(c.env.DB, user.sub, c.req.param('plantingId'), unitNo, false);
  if (!ok) return c.json({ error: 'pot tidak ditemukan' }, 404);
  return c.json({ ok: true, retired: false });
});

export default unitRoutes;
