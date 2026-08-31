/**
 * Uji rute pertumbuhan: pengukuran, tanaman terlantar, jadwal pangkas, dan
 * kalibrasi interval — dengan SQL sungguhan terhadap skema produksi.
 *
 * Yang paling penting di sini bukan angkanya, melainkan bahwa setiap kueri
 * membawa user_id: catatan tinggi tanaman orang lain tidak boleh terbaca,
 * terhapus, atau ikut menggeser rata-rata kalibrasi.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import gardenGrowth from './garden_growth';
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
    {
      ...init,
      headers: {
        Authorization: `Bearer ${auth}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    },
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
  // Urutan sama dengan produksi: garden.ts punya '/:id' yang menelan
  // '/neglected' dan '/pruning' kalau dipasang lebih dulu.
  app.route('/api/garden', gardenGrowth as never);
  app.route('/api/garden', garden as never);
});

afterEach(() => db.__close());

function seedPlanting(
  userId: string,
  id: string,
  plantId: string | null,
  plantedDate = '2026-01-01',
  status = 'tumbuh',
  customName: string | null = null
) {
  db.prepare(
    `INSERT INTO garden_plantings (id, user_id, plant_id, custom_name, quantity, planted_date, status)
     VALUES (?1, ?2, ?3, ?4, 1, ?5, ?6)`
  ).bind(id, userId, plantId, customName, plantedDate, status).run();
  return id;
}

function seedCare(userId: string, id: string, plantingId: string, action: string, date: string) {
  db.prepare(
    `INSERT INTO garden_care_log (id, user_id, planting_id, action, action_date)
     VALUES (?1, ?2, ?3, ?4, ?5)`
  ).bind(id, userId, plantingId, action, date).run();
}

function seedUnit(userId: string, plantingId: string, unitNo: number) {
  db.prepare(
    `INSERT INTO garden_planting_unit (planting_id, unit_no, user_id, species_key, code)
     VALUES (?1, ?2, ?3, 'tomat', ?4)`
  ).bind(plantingId, unitNo, userId, `Tomat #${unitNo}`).run();
}

describe('pengukuran', () => {
  it('menyimpan lalu membaca kembali satu pengukuran', async () => {
    seedPlanting('user-1', 'p1', 'tomat');

    const post = await req('/api/garden/measurements/p1', {
      method: 'POST',
      body: JSON.stringify({ heightCm: 12.5, leafCount: 8, measuredDate: '2026-03-01' }),
    });
    expect(post.status).toBe(201);

    const body = await (await req('/api/garden/measurements/p1')).json() as {
      riwayat: Array<{ heightCm: number; leafCount: number }>;
    };
    expect(body.riwayat).toHaveLength(1);
    expect(body.riwayat[0]).toMatchObject({ heightCm: 12.5, leafCount: 8 });
  });

  it('menghitung laju tumbuh dari dua titik atau lebih', async () => {
    seedPlanting('user-1', 'p1', 'tomat');
    for (const [tanggal, tinggi] of [['2026-03-01', 10], ['2026-03-15', 24]] as const) {
      await req('/api/garden/measurements/p1', {
        method: 'POST',
        body: JSON.stringify({ heightCm: tinggi, measuredDate: tanggal }),
      });
    }

    const body = await (await req('/api/garden/measurements/p1')).json() as {
      laju: { cmPerPekan: number | null };
    };
    expect(body.laju.cmPerPekan).toBeCloseTo(7, 5);
  });

  it('menolak tinggi nol, negatif, dan di luar batas', async () => {
    seedPlanting('user-1', 'p1', 'tomat');

    for (const nilai of [0, -5, 100000]) {
      const res = await req('/api/garden/measurements/p1', {
        method: 'POST',
        body: JSON.stringify({ heightCm: nilai }),
      });
      expect(res.status).toBe(400);
    }
  });

  it('menolak pengukuran tanpa tinggi maupun jumlah daun', async () => {
    seedPlanting('user-1', 'p1', 'tomat');
    const res = await req('/api/garden/measurements/p1', {
      method: 'POST',
      body: JSON.stringify({ note: 'lupa bawa penggaris' }),
    });
    expect(res.status).toBe(400);
  });

  it('menolak menulis ke tanaman milik pengguna lain', async () => {
    seedPlanting('user-2', 'p2', 'tomat');
    const res = await req('/api/garden/measurements/p2', {
      method: 'POST',
      body: JSON.stringify({ heightCm: 20 }),
    });
    expect(res.status).toBe(404);
  });

  it('menolak membaca tanaman milik pengguna lain', async () => {
    seedPlanting('user-2', 'p2', 'tomat');
    expect((await req('/api/garden/measurements/p2')).status).toBe(404);
  });

  it('menerima nomor pot yang ada dan menolak yang tidak ada', async () => {
    seedPlanting('user-1', 'p1', 'tomat');
    seedUnit('user-1', 'p1', 1);

    const ok = await req('/api/garden/measurements/p1', {
      method: 'POST',
      body: JSON.stringify({ heightCm: 30, unitNo: 1 }),
    });
    expect(ok.status).toBe(201);

    const gagal = await req('/api/garden/measurements/p1', {
      method: 'POST',
      body: JSON.stringify({ heightCm: 30, unitNo: 9 }),
    });
    expect(gagal.status).toBe(404);
  });

  it('DELETE milik sendiri berhasil, milik orang lain 404', async () => {
    seedPlanting('user-1', 'p1', 'tomat');
    const id = (await (await req('/api/garden/measurements/p1', {
      method: 'POST',
      body: JSON.stringify({ heightCm: 15 }),
    })).json() as { id: string }).id;

    expect((await req(`/api/garden/measurements/${id}`, { method: 'DELETE' }, otherToken)).status).toBe(404);
    expect((await req(`/api/garden/measurements/${id}`, { method: 'DELETE' })).status).toBe(200);
    expect((await req(`/api/garden/measurements/${id}`, { method: 'DELETE' })).status).toBe(404);
  });
});

describe('terlantar', () => {
  it('menandai tanaman yang lewat ambang sejak sentuhan terakhir', async () => {
    seedPlanting('user-1', 'p1', 'tomat', '2026-01-01');
    seedCare('user-1', 'c1', 'p1', 'siram', '2026-01-02');

    const body = await (await req('/api/garden/neglected')).json() as {
      ambang: number; terlantar: Array<{ plantingId: string; hari: number }>;
    };
    expect(body.ambang).toBe(21);
    expect(body.terlantar.map((t) => t.plantingId)).toContain('p1');
  });

  it('yang baru disentuh tidak ikut, dan aksi apa pun dihitung sentuhan', async () => {
    const hariIni = new Date().toISOString().slice(0, 10);
    seedPlanting('user-1', 'p1', 'tomat', '2026-01-01');
    seedCare('user-1', 'c1', 'p1', 'panen', hariIni);

    const body = await (await req('/api/garden/neglected')).json() as {
      terlantar: Array<{ plantingId: string }>;
    };
    expect(body.terlantar).toHaveLength(0);
  });

  it('tanaman pengguna lain tidak pernah muncul', async () => {
    seedPlanting('user-2', 'p2', 'tomat', '2026-01-01');
    const body = await (await req('/api/garden/neglected')).json() as {
      terlantar: Array<{ plantingId: string }>;
    };
    expect(body.terlantar).toHaveLength(0);
  });
});

describe('pangkas', () => {
  it('hanya memuat tanaman yang punya aturan pangkas di katalog', async () => {
    seedPlanting('user-1', 'p1', 'tomat', '2026-01-01');
    seedPlanting('user-1', 'p2', 'kangkung', '2026-01-01');

    const body = await (await req('/api/garden/pruning')).json() as {
      jadwal: Array<{ plantingId: string; telat: number }>; jatuhTempo: number;
    };
    const ids = body.jadwal.map((j) => j.plantingId);
    expect(ids).toContain('p1');
    expect(ids).not.toContain('p2');
    expect(body.jatuhTempo).toBeGreaterThan(0);
  });

  it('pangkas terakhir menggeser jadwal berikutnya', async () => {
    const hariIni = new Date().toISOString().slice(0, 10);
    seedPlanting('user-1', 'p1', 'tomat', '2026-01-01');
    seedCare('user-1', 'c1', 'p1', 'pangkas', hariIni);

    const body = await (await req('/api/garden/pruning')).json() as {
      jadwal: Array<{ plantingId: string; telat: number; berikutnya: string }>;
    };
    const j = body.jadwal.find((x) => x.plantingId === 'p1')!;
    expect(j.telat).toBe(0);
    expect(j.berikutnya > hariIni).toBe(true);
  });

  it('tanaman kustom tanpa plant_id dilewati, bukan bikin error', async () => {
    seedPlanting('user-1', 'p1', null, '2026-01-01', 'tumbuh', 'Bunga warisan');
    const res = await req('/api/garden/pruning');
    expect(res.status).toBe(200);
    expect((await res.json() as { jadwal: unknown[] }).jadwal).toHaveLength(0);
  });
});

describe('kalibrasi interval', () => {
  it('diam saat sampelnya kurang', async () => {
    seedPlanting('user-1', 'p1', 'tomat');
    seedCare('user-1', 'c1', 'p1', 'siram', '2026-03-01');
    seedCare('user-1', 'c2', 'p1', 'siram', '2026-03-04');

    const body = await (await req('/api/garden/calibration/interval')).json() as { hasil: unknown[] };
    expect(body.hasil).toHaveLength(0);
  });

  it('melaporkan interval nyata setelah cukup sampel', async () => {
    seedPlanting('user-1', 'p1', 'tomat');
    // Enam siraman berjarak 3 hari = lima jarak, di atas MIN_GAP_SAMPEL.
    const mulai = Date.parse('2026-03-01T00:00:00Z');
    for (let i = 0; i < 6; i++) {
      const t = new Date(mulai + i * 3 * 86_400_000).toISOString().slice(0, 10);
      seedCare('user-1', `c${i}`, 'p1', 'siram', t);
    }

    const body = await (await req('/api/garden/calibration/interval')).json() as {
      hasil: Array<{ plantId: string; action: string; nyata: number; sampel: number }>;
    };
    const baris = body.hasil.find((h) => h.plantId === 'tomat' && h.action === 'siram');
    expect(baris).toBeDefined();
    expect(baris!.nyata).toBe(3);
    expect(baris!.sampel).toBe(5);
  });

  it('log pengguna lain tidak ikut menggeser hasil', async () => {
    seedPlanting('user-2', 'p2', 'tomat');
    const mulai = Date.parse('2026-03-01T00:00:00Z');
    for (let i = 0; i < 6; i++) {
      const t = new Date(mulai + i * 3 * 86_400_000).toISOString().slice(0, 10);
      seedCare('user-2', `c${i}`, 'p2', 'siram', t);
    }

    const body = await (await req('/api/garden/calibration/interval')).json() as { hasil: unknown[] };
    expect(body.hasil).toHaveLength(0);
  });
});
