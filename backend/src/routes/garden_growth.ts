/**
 * Pertumbuhan yang terukur: log ukuran, tanaman terlantar, jadwal pangkas,
 * dan kalibrasi interval siram/pupuk dari kebiasaan nyata.
 *
 * Benang merahnya: modul kebun sudah tahu banyak tentang apa yang SEHARUSNYA
 * terjadi — interval katalog, umur panen, jadwal pupuk. Berkas ini menghadapkan
 * semua itu pada apa yang BENAR-BENAR terjadi di kebun ini.
 */

import { Hono } from 'hono';
import { requireAuth, type AuthContext } from '../middleware/auth';
import { nanoid } from '../lib/nanoid';
import { jakartaToday } from '../lib/validate';
import { PLANT_BY_ID } from '../data/plants';
import {
  bersihkanUkuran, lajuTumbuh, MAX_HEIGHT_CM, MAX_LEAF, type Ukuran,
} from '../lib/garden_measure';
import { cariTerlantar, AMBANG_TERLANTAR, type Sentuhan } from '../lib/garden_neglect';
import { jadwalPangkas } from '../lib/garden_pruning';
import { calibrateInterval, type CareGap } from '../lib/garden_calibration';

const growth = new Hono<AuthContext>();
growth.use('/*', requireAuth);

const TANGGAL = /^\d{4}-\d{2}-\d{2}$/;

function tanggalSah(v: unknown): string | null {
  return typeof v === 'string' && TANGGAL.test(v) ? v : null;
}

async function penanamanMilik(db: D1Database, userId: string, plantingId: string) {
  return db.prepare(
    `SELECT id, plant_id, custom_name, nickname, planted_date
       FROM garden_plantings WHERE id = ?1 AND user_id = ?2`
  ).bind(plantingId, userId).first<{
    id: string; plant_id: string | null; custom_name: string | null;
    nickname: string | null; planted_date: string;
  }>();
}

function namaPenanaman(r: {
  plant_id: string | null; custom_name: string | null; nickname: string | null;
}): string {
  return r.nickname
    ?? (r.plant_id ? PLANT_BY_ID.get(r.plant_id)?.name : undefined)
    ?? r.custom_name
    ?? 'Tanaman';
}

// ──────────────────────── UKURAN ────────────────────────

// GET /api/garden/measurements/:plantingId
growth.get('/measurements/:plantingId', async (c) => {
  const user = c.get('user');
  const plantingId = c.req.param('plantingId');

  const p = await penanamanMilik(c.env.DB, user.sub, plantingId);
  if (!p) return c.json({ error: 'tanaman tidak ditemukan' }, 404);

  const rows = (await c.env.DB.prepare(
    `SELECT id, unit_no, measured_date, height_cm, leaf_count, note
       FROM garden_measurement WHERE planting_id = ?1 AND user_id = ?2
      ORDER BY measured_date ASC, created_at ASC`
  ).bind(plantingId, user.sub).all<{
    id: string; unit_no: number | null; measured_date: string;
    height_cm: number | null; leaf_count: number | null; note: string | null;
  }>()).results ?? [];

  const riwayat: Ukuran[] = rows.map((r) => ({
    measuredDate: r.measured_date,
    heightCm: r.height_cm,
    leafCount: r.leaf_count,
  }));

  return c.json({
    plantingId,
    nama: namaPenanaman(p),
    riwayat: rows.map((r) => ({
      id: r.id,
      unitNo: r.unit_no,
      measuredDate: r.measured_date,
      heightCm: r.height_cm,
      leafCount: r.leaf_count,
      note: r.note,
    })),
    laju: lajuTumbuh(riwayat),
    batas: { tinggiCm: MAX_HEIGHT_CM, daun: MAX_LEAF },
  });
});

// POST /api/garden/measurements/:plantingId
growth.post('/measurements/:plantingId', async (c) => {
  const user = c.get('user');
  const plantingId = c.req.param('plantingId');

  const body = await c.req.json<{
    heightCm?: unknown; leafCount?: unknown; unitNo?: unknown;
    measuredDate?: string; note?: string;
  }>().catch(() => null);
  if (!body) return c.json({ error: 'body tidak valid' }, 400);

  const p = await penanamanMilik(c.env.DB, user.sub, plantingId);
  if (!p) return c.json({ error: 'tanaman tidak ditemukan' }, 404);

  const heightCm = bersihkanUkuran(body.heightCm, MAX_HEIGHT_CM);
  const leafRaw = bersihkanUkuran(body.leafCount, MAX_LEAF);
  const leafCount = leafRaw === null ? null : Math.round(leafRaw);

  // Pengukuran tanpa satu angka pun bukan pengukuran — ia baris kosong yang
  // akan muncul di kurva sebagai titik tanpa nilai.
  if (heightCm === null && leafCount === null) {
    return c.json({ error: 'isi tinggi atau jumlah daun, minimal salah satu' }, 400);
  }

  // Pot tertentu boleh disebut, tapi harus benar-benar milik catatan ini.
  let unitNo: number | null = null;
  if (body.unitNo !== undefined && body.unitNo !== null) {
    const n = Number(body.unitNo);
    if (!Number.isInteger(n)) return c.json({ error: 'nomor pot tidak valid' }, 400);
    const ada = await c.env.DB.prepare(
      'SELECT unit_no FROM garden_planting_unit WHERE planting_id = ?1 AND unit_no = ?2 AND user_id = ?3'
    ).bind(plantingId, n, user.sub).first<{ unit_no: number }>();
    if (!ada) return c.json({ error: 'pot tidak ditemukan' }, 404);
    unitNo = n;
  }

  const id = nanoid();
  await c.env.DB.prepare(
    `INSERT INTO garden_measurement
       (id, user_id, planting_id, unit_no, measured_date, height_cm, leaf_count, note)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`
  ).bind(
    id, user.sub, plantingId, unitNo,
    tanggalSah(body.measuredDate) ?? jakartaToday(),
    heightCm, leafCount, body.note?.trim().slice(0, 300) || null
  ).run();

  return c.json({ id, heightCm, leafCount, unitNo }, 201);
});

// DELETE /api/garden/measurements/:id
growth.delete('/measurements/:id', async (c) => {
  const user = c.get('user');
  const res = await c.env.DB.prepare(
    'DELETE FROM garden_measurement WHERE id = ?1 AND user_id = ?2'
  ).bind(c.req.param('id'), user.sub).run();

  if ((res.meta?.changes ?? 0) === 0) return c.json({ error: 'pengukuran tidak ditemukan' }, 404);
  return c.json({ ok: true });
});

// ──────────────────────── TERLANTAR ────────────────────────

// GET /api/garden/neglected
growth.get('/neglected', async (c) => {
  const user = c.get('user');
  const today = jakartaToday();

  // Satu kueri: tanaman aktif beserta tanggal perawatan terakhir apa pun
  // jenisnya. Bukan hanya siram — tanaman yang dipanen kemarin jelas tidak
  // terlantar meski terakhir disiram sebulan lalu.
  const rows = (await c.env.DB.prepare(
    `SELECT p.id, p.plant_id, p.custom_name, p.nickname, p.planted_date,
            (SELECT MAX(l.action_date) FROM garden_care_log l
              WHERE l.planting_id = p.id AND l.user_id = ?1) AS last_care
       FROM garden_plantings p
      WHERE p.user_id = ?1 AND p.status IN ('tumbuh', 'panen')`
  ).bind(user.sub).all<{
    id: string; plant_id: string | null; custom_name: string | null;
    nickname: string | null; planted_date: string; last_care: string | null;
  }>()).results ?? [];

  const sentuhan: Sentuhan[] = rows.map((r) => ({
    plantingId: r.id,
    nama: namaPenanaman(r),
    lastCare: r.last_care,
    plantedDate: r.planted_date,
  }));

  return c.json({ ambang: AMBANG_TERLANTAR, terlantar: cariTerlantar(sentuhan, today) });
});

// ──────────────────────── PANGKAS ────────────────────────

// GET /api/garden/pruning
growth.get('/pruning', async (c) => {
  const user = c.get('user');
  const today = jakartaToday();

  const rows = (await c.env.DB.prepare(
    `SELECT p.id, p.plant_id, p.custom_name, p.nickname, p.planted_date,
            (SELECT MAX(l.action_date) FROM garden_care_log l
              WHERE l.planting_id = p.id AND l.user_id = ?1 AND l.action = 'pangkas') AS last_pangkas
       FROM garden_plantings p
      WHERE p.user_id = ?1 AND p.status IN ('tumbuh', 'panen') AND p.plant_id IS NOT NULL`
  ).bind(user.sub).all<{
    id: string; plant_id: string; custom_name: string | null;
    nickname: string | null; planted_date: string; last_pangkas: string | null;
  }>()).results ?? [];

  const jadwal = rows
    .map((r) => {
      const plant = PLANT_BY_ID.get(r.plant_id);
      // Tanaman tanpa aturan pangkas di katalog memang tidak dipangkas;
      // memaksakan jadwal untuknya berarti mengarang tindakan.
      const j = jadwalPangkas(plant?.pruning, r.planted_date, r.last_pangkas, today);
      if (!j || !plant) return null;
      return {
        plantingId: r.id,
        nama: namaPenanaman(r),
        emoji: plant.emoji,
        catatan: plant.pruning!.catatan,
        lastPangkas: r.last_pangkas,
        ...j,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => b.telat - a.telat || a.berikutnya.localeCompare(b.berikutnya));

  return c.json({ today, jadwal, jatuhTempo: jadwal.filter((j) => j.telat > 0).length });
});

// ──────────────────── KALIBRASI INTERVAL ────────────────────

// GET /api/garden/calibration/interval
growth.get('/calibration/interval', async (c) => {
  const user = c.get('user');

  // Seluruh log siram dan pupuk, diurutkan per tanaman — jarak antar baris
  // berurutan itulah interval yang benar-benar dijalani.
  const rows = (await c.env.DB.prepare(
    `SELECT p.plant_id, l.planting_id, l.action, l.action_date
       FROM garden_care_log l
       JOIN garden_plantings p ON p.id = l.planting_id
      WHERE l.user_id = ?1 AND l.action IN ('siram', 'pupuk') AND p.plant_id IS NOT NULL
      ORDER BY l.planting_id, l.action, l.action_date`
  ).bind(user.sub).all<{
    plant_id: string; planting_id: string; action: string; action_date: string;
  }>()).results ?? [];

  const gaps: CareGap[] = [];
  let prev: { plantingId: string; action: string; date: string } | null = null;
  for (const r of rows) {
    if (prev && prev.plantingId === r.planting_id && prev.action === r.action) {
      gaps.push({
        plantId: r.plant_id,
        action: r.action as 'siram' | 'pupuk',
        gapDays: Math.round(
          (Date.parse(`${r.action_date}T00:00:00Z`) - Date.parse(`${prev.date}T00:00:00Z`)) / 86_400_000
        ),
      });
    }
    prev = { plantingId: r.planting_id, action: r.action, date: r.action_date };
  }

  const hasil: Array<{
    plantId: string; nama: string; action: string;
    katalog: number; nyata: number; selisih: number; sampel: number;
  }> = [];

  const kunci = new Set(gaps.map((g) => `${g.plantId}|${g.action}`));
  for (const k of kunci) {
    const [plantId, action] = k.split('|');
    const plant = PLANT_BY_ID.get(plantId);
    if (!plant) continue;

    const katalog = action === 'siram' ? plant.waterIntervalDays : plant.fertilizeIntervalDays;
    if (!katalog || katalog <= 0) continue;

    const cal = calibrateInterval(
      gaps.filter((g) => g.plantId === plantId && g.action === action),
      katalog
    );
    if (!cal?.andal) continue;

    hasil.push({
      plantId, nama: plant.name, action,
      katalog, nyata: cal.intervalNyata,
      selisih: cal.intervalNyata - katalog,
      sampel: cal.sampel,
    });
  }

  // Yang paling jauh dari katalog lebih dulu — itu yang paling layak ditinjau.
  hasil.sort((a, b) => Math.abs(b.selisih) - Math.abs(a.selisih));
  return c.json({ hasil });
});

export default growth;
