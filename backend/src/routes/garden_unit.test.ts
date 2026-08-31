/**
 * Uji rute nomor pot: SQL sungguhan terhadap skema produksi, kepemilikan
 * antar pengguna, dan yang paling menentukan — bahwa mengganti kode tidak
 * pernah menggeser riwayat perawatan.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import gardenUnit from './garden_unit';
import garden from './garden';
import { Hono } from 'hono';
import { signJWT } from '../lib/jwt';
import { createTestDb, seedUser, type FakeD1 } from '../test/d1';

const JWT_SECRET = 'rahasia-untuk-test';

let db: FakeD1;
let app: Hono<never>;
let token: string;
let otherToken: string;

function makeEnv() {
  return { DB: db, JWT_SECRET } as unknown as Record<string, unknown>;
}

async function mint(sub: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return signJWT({ sub, name: 'Penguji', role: 'user', iat: now, exp: now + 3600 }, JWT_SECRET);
}

function req(path: string, init: RequestInit = {}, auth = token) {
  return app.request(
    `http://test${path}`,
    { ...init, headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) } },
    makeEnv()
  );
}

beforeEach(async () => {
  db = createTestDb();
  seedUser(db, 'user-1');
  seedUser(db, 'user-2');
  token = await mint('user-1');
  otherToken = await mint('user-2');
  app = new Hono() as Hono<never>;
  // Urutan sama dengan produksi: rute unit didaftarkan lebih dulu, karena
  // garden.ts punya '/:id' yang akan menelan '/units'.
  app.route('/api/garden', gardenUnit as never);
  app.route('/api/garden', garden as never);
});

afterEach(() => db.__close());

function seedPlanting(
  userId: string, id: string, plantId: string | null, quantity = 1, customName: string | null = null
) {
  db.prepare(
    `INSERT INTO garden_plantings (id, user_id, plant_id, custom_name, quantity, planted_date, status)
     VALUES (?1, ?2, ?3, ?4, ?5, '2026-01-01', 'tumbuh')`
  ).bind(id, userId, plantId, customName, quantity).run();
  return id;
}

/** Baca cakupan pot satu log langsung dari database. `all()` di FakeD1 async. */
async function cakupanLog(logId: string): Promise<number[]> {
  const res = await db.prepare(
    'SELECT unit_no FROM garden_care_log_unit WHERE care_log_id = ?1 ORDER BY unit_no'
  ).bind(logId).all<{ unit_no: number }>();
  return (res.results ?? []).map((r) => r.unit_no);
}

/** Unit dibuat manual di sini: backfill migrasi hanya jalan sekali di awal. */
function seedUnit(
  userId: string, plantingId: string, unitNo: number, speciesKey: string, code: string, retired = false
) {
  db.prepare(
    `INSERT INTO garden_planting_unit (planting_id, unit_no, user_id, species_key, code, retired_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)`
  ).bind(plantingId, unitNo, userId, speciesKey, code, retired ? 1 : null).run();
}

// ───────────────────────────── DAFTAR POT ─────────────────────────────

describe('daftar pot', () => {
  it('mengelompokkan pot per penanaman dan meringkas kodenya', async () => {
    seedPlanting('user-1', 'p1', 'cabai-rawit', 3);
    seedUnit('user-1', 'p1', 1, 'cabai-rawit', '1');
    seedUnit('user-1', 'p1', 2, 'cabai-rawit', '2');
    seedUnit('user-1', 'p1', 3, 'cabai-rawit', '3');

    const body = await (await req('/api/garden/units')).json() as {
      penanaman: Array<{ plantingId: string; units: unknown[]; kodeRingkas: string }>;
    };
    expect(body.penanaman).toHaveLength(1);
    expect(body.penanaman[0].units).toHaveLength(3);
    expect(body.penanaman[0].kodeRingkas).toBe('#1–#3');
  });

  it('pengguna lain tidak melihat pot pengguna ini', async () => {
    seedPlanting('user-1', 'p1', 'cabai-rawit', 1);
    seedUnit('user-1', 'p1', 1, 'cabai-rawit', '1');

    const body = await (await req('/api/garden/units', {}, otherToken)).json() as {
      penanaman: unknown[];
    };
    expect(body.penanaman).toEqual([]);
  });

  it('GET satu penanaman milik pengguna lain menjawab 404', async () => {
    seedPlanting('user-2', 'lain', 'cabai-rawit', 1);
    expect((await req('/api/garden/units/lain')).status).toBe(404);
  });
});

// ───────────────────────────── TAMBAH POT ─────────────────────────────

describe('tambah pot', () => {
  it('kode otomatis melanjutkan deret jenis, lintas catatan', async () => {
    seedPlanting('user-1', 'p1', 'cabai-rawit', 2);
    seedUnit('user-1', 'p1', 1, 'cabai-rawit', '1');
    seedUnit('user-1', 'p1', 2, 'cabai-rawit', '2');
    seedPlanting('user-1', 'p2', 'cabai-rawit', 1);
    seedUnit('user-1', 'p2', 1, 'cabai-rawit', '3');

    const res = await req('/api/garden/units/p2', { method: 'POST' });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ unitNo: 2, code: '4' });
  });

  it('kode otomatis tidak memakai ulang nomor pot yang sudah pensiun', async () => {
    // Label #2 bisa saja masih tergeletak di gudang.
    seedPlanting('user-1', 'p1', 'cabai-rawit', 2);
    seedUnit('user-1', 'p1', 1, 'cabai-rawit', '1');
    seedUnit('user-1', 'p1', 2, 'cabai-rawit', '2', true);

    const res = await req('/api/garden/units/p1', { method: 'POST' });
    expect(await res.json()).toMatchObject({ code: '3' });
  });

  it('unit_no baru tidak memakai ulang nomor pensiunan — riwayat menggantung padanya', async () => {
    seedPlanting('user-1', 'p1', 'cabai-rawit', 2);
    seedUnit('user-1', 'p1', 1, 'cabai-rawit', '1');
    seedUnit('user-1', 'p1', 2, 'cabai-rawit', '2', true);

    const res = await req('/api/garden/units/p1', { method: 'POST' });
    expect(await res.json()).toMatchObject({ unitNo: 3 });
  });

  it('tanaman di luar katalog punya deret sendiri', async () => {
    seedPlanting('user-1', 'p1', 'tomat', 1);
    seedUnit('user-1', 'p1', 1, 'tomat', '1');
    seedPlanting('user-1', 'p2', null, 1, 'Tomat Ceri Kampung');

    const res = await req('/api/garden/units/p2', { method: 'POST' });
    // Bukan '2': nama kustom tidak ikut deret slug katalog.
    expect(await res.json()).toMatchObject({ code: '1' });
  });

  it('unit dari backfill tetap terbaca meski nama tanaman punya huruf non-ASCII', async () => {
    // LOWER() SQLite hanya menurunkan huruf ASCII, sedangkan toLowerCase() di
    // TypeScript menurunkan Unicode juga. Backfill migrasi memakai yang
    // pertama, rutenya memakai yang kedua — kalau kunci jenis dihitung ulang
    // dari nama, keduanya tidak akan pernah bertemu, unit lama jadi tak
    // terlihat, dan unit_no mengulang dari 1 lalu menabrak primary key.
    seedPlanting('user-1', 'p1', null, 1, 'Cabai Émas');
    seedUnit('user-1', 'p1', 1, 'nama:cabai Émas', '1');   // seperti hasil migrasi

    const res = await req('/api/garden/units/p1', { method: 'POST' });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ unitNo: 2, code: '2' });
  });

  it('menambah pot pada tanaman pengguna lain menjawab 404', async () => {
    seedPlanting('user-2', 'lain', 'cabai-rawit', 1);
    expect((await req('/api/garden/units/lain', { method: 'POST' })).status).toBe(404);
  });
});

// ─────────────────────────── UBAH DAN TUKAR ───────────────────────────

describe('ubah kode', () => {
  beforeEach(() => {
    seedPlanting('user-1', 'p1', 'cabai-rawit', 2);
    seedUnit('user-1', 'p1', 1, 'cabai-rawit', '1');
    seedUnit('user-1', 'p1', 2, 'cabai-rawit', '2');
  });

  it('mengubah kode ke nilai yang belum dipakai', async () => {
    const res = await req('/api/garden/units/p1/2', {
      method: 'PATCH', body: JSON.stringify({ code: 'A9' }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ unitNo: 2, code: 'A9' });
  });

  it('menolak kode kosong dan kode kepanjangan', async () => {
    for (const code of ['', '   ', 'ABCDEFGHI', 'A/B']) {
      const res = await req('/api/garden/units/p1/2', {
        method: 'PATCH', body: JSON.stringify({ code }),
      });
      expect(res.status, JSON.stringify(code)).toBe(400);
    }
  });

  it('kode yang dipakai pot aktif lain menjawab 409 dengan usul tukar, tanpa mengubah apa pun', async () => {
    const res = await req('/api/garden/units/p1/2', {
      method: 'PATCH', body: JSON.stringify({ code: '1' }),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ usulTukar: { plantingId: 'p1', unitNo: 1, code: '1' } });

    // Tidak boleh ada yang berubah sebelum pengguna menyetujui.
    const body = await (await req('/api/garden/units/p1')).json() as {
      units: Array<{ unitNo: number; code: string }>;
    };
    expect(body.units.map((u) => u.code)).toEqual(['1', '2']);
  });

  it('izinkanTukar menukar kedua kode sekaligus', async () => {
    const res = await req('/api/garden/units/p1/2', {
      method: 'PATCH', body: JSON.stringify({ code: '1', izinkanTukar: true }),
    });
    expect(res.status).toBe(200);

    const body = await (await req('/api/garden/units/p1')).json() as {
      units: Array<{ unitNo: number; code: string }>;
    };
    expect(body.units.find((u) => u.unitNo === 1)!.code).toBe('2');
    expect(body.units.find((u) => u.unitNo === 2)!.code).toBe('1');
  });

  it('tukar berlaku lintas catatan tanaman sejenis', async () => {
    seedPlanting('user-1', 'p2', 'cabai-rawit', 1);
    seedUnit('user-1', 'p2', 1, 'cabai-rawit', '7');

    const res = await req('/api/garden/units/p1/1', {
      method: 'PATCH', body: JSON.stringify({ code: '7', izinkanTukar: true }),
    });
    expect(res.status).toBe(200);

    const b1 = await (await req('/api/garden/units/p1')).json() as { units: Array<{ unitNo: number; code: string }> };
    const b2 = await (await req('/api/garden/units/p2')).json() as { units: Array<{ unitNo: number; code: string }> };
    expect(b1.units.find((u) => u.unitNo === 1)!.code).toBe('7');
    expect(b2.units.find((u) => u.unitNo === 1)!.code).toBe('1');
  });

  it('kode milik pot yang sudah pensiun boleh dipakai ulang tanpa tukar', async () => {
    seedUnit('user-1', 'p1', 3, 'cabai-rawit', 'X1', true);
    const res = await req('/api/garden/units/p1/2', {
      method: 'PATCH', body: JSON.stringify({ code: 'X1' }),
    });
    expect(res.status).toBe(200);
  });

  it('mengubah kode tidak menyentuh unit_no, jadi riwayat perawatan tetap menunjuk pot yang sama', async () => {
    // Inilah alasan unit_no dan code dipisah sejak awal.
    db.prepare(
      `INSERT INTO garden_care_log (id, user_id, planting_id, action, action_date)
       VALUES ('log1', 'user-1', 'p1', 'pupuk', '2026-02-01')`
    ).run();
    db.prepare(
      `INSERT INTO garden_care_log_unit (care_log_id, unit_no, user_id) VALUES ('log1', 2, 'user-1')`
    ).run();

    await req('/api/garden/units/p1/2', {
      method: 'PATCH', body: JSON.stringify({ code: 'ZZ' }),
    });

    expect(await cakupanLog('log1')).toEqual([2]);
  });

  it('mengubah pot milik pengguna lain menjawab 404', async () => {
    const res = await req('/api/garden/units/p1/2', {
      method: 'PATCH', body: JSON.stringify({ code: 'B1' }),
    }, otherToken);
    expect(res.status).toBe(404);
  });

  it('pot yang tidak ada menjawab 404', async () => {
    const res = await req('/api/garden/units/p1/99', {
      method: 'PATCH', body: JSON.stringify({ code: 'B1' }),
    });
    expect(res.status).toBe(404);
  });
});

// ────────────────────────── PENSIUN DAN PULIH ──────────────────────────

describe('pensiun dan pulih', () => {
  it('pensiun mengeluarkan pot dari ringkasan tanpa menghapus barisnya', async () => {
    seedPlanting('user-1', 'p1', 'cabai-rawit', 2);
    seedUnit('user-1', 'p1', 1, 'cabai-rawit', '1');
    seedUnit('user-1', 'p1', 2, 'cabai-rawit', '2');

    expect((await req('/api/garden/units/p1/2/retire', { method: 'POST' })).status).toBe(200);

    const body = await (await req('/api/garden/units/p1')).json() as {
      units: Array<{ unitNo: number; retired: boolean }>; kodeRingkas: string;
    };
    expect(body.units).toHaveLength(2);
    expect(body.units.find((u) => u.unitNo === 2)!.retired).toBe(true);
    expect(body.kodeRingkas).toBe('#1');
  });

  it('pulih mengembalikan pot tanpa mengubah kodenya', async () => {
    seedPlanting('user-1', 'p1', 'cabai-rawit', 1);
    seedUnit('user-1', 'p1', 1, 'cabai-rawit', 'K7', true);

    await req('/api/garden/units/p1/1/restore', { method: 'POST' });

    const body = await (await req('/api/garden/units/p1')).json() as {
      units: Array<{ code: string; retired: boolean }>;
    };
    expect(body.units[0]).toMatchObject({ code: 'K7', retired: false });
  });

  it('pensiun pot pengguna lain menjawab 404', async () => {
    seedPlanting('user-2', 'lain', 'cabai-rawit', 1);
    seedUnit('user-2', 'lain', 1, 'cabai-rawit', '1');
    expect((await req('/api/garden/units/lain/1/retire', { method: 'POST' })).status).toBe(404);
  });
});

// ──────────────────── PERAWATAN PER POT ────────────────────

describe('perawatan per pot', () => {
  beforeEach(() => {
    seedPlanting('user-1', 'p1', 'cabai-rawit', 3);
    seedUnit('user-1', 'p1', 1, 'cabai-rawit', '1');
    seedUnit('user-1', 'p1', 2, 'cabai-rawit', '2');
    seedUnit('user-1', 'p1', 3, 'cabai-rawit', '3');
  });

  it('tanpa units, log tidak menulis baris cakupan sama sekali — artinya semua pot', async () => {
    const res = await req('/api/garden/p1/care', {
      method: 'POST', body: JSON.stringify({ action: 'pupuk', date: '2026-02-01' }),
    });
    expect(res.status).toBe(201);
    const { id } = await res.json() as { id: string };
    expect(await cakupanLog(id)).toEqual([]);
  });

  it('dengan units, hanya pot yang disebut tercatat', async () => {
    const res = await req('/api/garden/p1/care', {
      method: 'POST', body: JSON.stringify({ action: 'pupuk', date: '2026-02-01', units: [1, 3] }),
    });
    expect(res.status).toBe(201);
    const { id } = await res.json() as { id: string };
    expect(await cakupanLog(id)).toEqual([1, 3]);
  });

  it('pot yang bukan milik tanaman itu ditolak 400 dan tidak menyisakan log', async () => {
    // Kalau divalidasi sesudah log tersimpan, permintaan yang ditolak sudah
    // tercatat sebagai "sudah dipupuk" dan pengguna akan memupuk dua kali.
    const res = await req('/api/garden/p1/care', {
      method: 'POST', body: JSON.stringify({ action: 'pupuk', date: '2026-02-01', units: [1, 99] }),
    });
    expect(res.status).toBe(400);

    const log = await db.prepare(
      "SELECT COUNT(*) AS n FROM garden_care_log WHERE planting_id = 'p1'"
    ).first<{ n: number }>();
    expect(log!.n).toBe(0);
  });

  it('nomor pot ganda dalam satu kiriman tidak menggandakan cakupan', async () => {
    const res = await req('/api/garden/p1/care', {
      method: 'POST', body: JSON.stringify({ action: 'siram', date: '2026-02-01', units: [2, 2, 2] }),
    });
    const { id } = await res.json() as { id: string };
    expect(await cakupanLog(id)).toEqual([2]);
  });

  it('kiriman ulang dengan clientId sama tidak menggandakan cakupan', async () => {
    const kirim = () => req('/api/garden/p1/care', {
      method: 'POST',
      body: JSON.stringify({ action: 'pupuk', date: '2026-02-01', units: [1, 2], clientId: 'offline-123' }),
    });
    const { id } = await (await kirim()).json() as { id: string };
    await kirim();
    expect(await cakupanLog(id)).toEqual([1, 2]);
  });

  it('pot milik tanaman lain ditolak meski sama-sama milik pengguna ini', async () => {
    seedPlanting('user-1', 'p2', 'tomat', 1);
    seedUnit('user-1', 'p2', 1, 'tomat', '1');

    const res = await req('/api/garden/p1/care', {
      method: 'POST', body: JSON.stringify({ action: 'pupuk', units: [5] }),
    });
    expect(res.status).toBe(400);
  });
});

// ──────────────────── DAFTAR TANAMAN MEMBAWA KODE ────────────────────

describe('daftar tanaman', () => {
  it('tiap tanaman membawa units dan kodeRingkas', async () => {
    seedPlanting('user-1', 'p1', 'cabai-rawit', 2);
    seedUnit('user-1', 'p1', 1, 'cabai-rawit', '4');
    seedUnit('user-1', 'p1', 2, 'cabai-rawit', '5');

    const body = await (await req('/api/garden')).json() as {
      plantings: Array<{ id: string; units: unknown[]; kodeRingkas: string }>;
    };
    const p = body.plantings.find((x) => x.id === 'p1')!;
    expect(p.units).toHaveLength(2);
    expect(p.kodeRingkas).toBe('#4–#5');
  });

  it('tanaman tanpa pot tetap punya keterangan, bukan string kosong', async () => {
    seedPlanting('user-1', 'p9', 'cabai-rawit', 1);

    const body = await (await req('/api/garden')).json() as {
      plantings: Array<{ id: string; kodeRingkas: string }>;
    };
    expect(body.plantings.find((x) => x.id === 'p9')!.kodeRingkas).toBe('tidak ada pot aktif');
  });
});
