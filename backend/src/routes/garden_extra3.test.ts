/**
 * Uji rute peta matahari dan benih simpanan: SQL sungguhan terhadap skema
 * produksi, kepemilikan antar pengguna, dan bentuk respons yang dipakai layar.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import gardenExtra3 from './garden_extra3';
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
  app.route('/api/garden', gardenExtra3 as never);
});

afterEach(() => db.__close());

function seedBed(userId: string, id: string, name = 'Bedengan A') {
  db.prepare(
    `INSERT INTO garden_beds (id, user_id, name, width_cm, length_cm) VALUES (?1, ?2, ?3, 100, 200)`
  ).bind(id, userId, name).run();
  return id;
}

function seedPlanting(userId: string, id: string, plantId: string | null, location: string | null) {
  db.prepare(
    `INSERT INTO garden_plantings (id, user_id, plant_id, custom_name, quantity, planted_date, status, location)
     VALUES (?1, ?2, ?3, ?4, 1, '2026-01-01', 'tumbuh', ?5)`
  ).bind(id, userId, plantId, plantId ? null : 'Tanaman kustom', location).run();
  return id;
}

// ───────────────────────── PETA MATAHARI ─────────────────────────

describe('peta matahari', () => {
  it('menyimpan lalu mengembalikan profil satu lokasi', async () => {
    const res = await req('/api/garden/sun-map', {
      method: 'PUT',
      body: JSON.stringify({ lokasiId: 'loc:Teras', lokasiLabel: 'Teras', jamLangsung: 2.5, orientation: 'timur' }),
    });
    expect(res.status).toBe(200);

    const body = await (await req('/api/garden/sun-map')).json() as {
      profil: Array<{ lokasiId: string; jamLangsung: number; orientation: string | null }>;
    };
    expect(body.profil).toHaveLength(1);
    expect(body.profil[0].jamLangsung).toBe(2.5);
    expect(body.profil[0].orientation).toBe('timur');
  });

  it('menyimpan ulang lokasi yang sama menimpa, bukan menambah baris', async () => {
    for (const jam of [3, 7]) {
      await req('/api/garden/sun-map', {
        method: 'PUT',
        body: JSON.stringify({ lokasiId: 'loc:Teras', lokasiLabel: 'Teras', jamLangsung: jam }),
      });
    }
    const body = await (await req('/api/garden/sun-map')).json() as { profil: Array<{ jamLangsung: number }> };
    expect(body.profil).toHaveLength(1);
    expect(body.profil[0].jamLangsung).toBe(7);
  });

  it('menolak jamLangsung yang bukan angka', async () => {
    const res = await req('/api/garden/sun-map', {
      method: 'PUT',
      body: JSON.stringify({ lokasiId: 'loc:Teras', jamLangsung: 'banyak' }),
    });
    expect(res.status).toBe(400);
  });

  it('menjepit jam di luar akal ke rentang yang sah', async () => {
    await req('/api/garden/sun-map', {
      method: 'PUT',
      body: JSON.stringify({ lokasiId: 'loc:Teras', jamLangsung: 99 }),
    });
    const body = await (await req('/api/garden/sun-map')).json() as { profil: Array<{ jamLangsung: number }> };
    expect(body.profil[0].jamLangsung).toBe(14);
  });

  it('orientasi tak dikenal disimpan null, bukan mentah', async () => {
    await req('/api/garden/sun-map', {
      method: 'PUT',
      body: JSON.stringify({ lokasiId: 'loc:Teras', jamLangsung: 5, orientation: "'; DROP TABLE x;--" }),
    });
    const row = await db.prepare('SELECT orientation FROM garden_sun_profile').first<{ orientation: string | null }>();
    expect(row?.orientation).toBeNull();
  });

  it('menolak profil untuk bedengan milik pengguna lain', async () => {
    seedBed('user-2', 'bed-lain');
    const res = await req('/api/garden/sun-map', {
      method: 'PUT',
      body: JSON.stringify({ lokasiId: 'bed-lain', jamLangsung: 6 }),
    });
    expect(res.status).toBe(404);
    expect(await db.prepare('SELECT user_id FROM garden_sun_profile').first()).toBeFalsy();
  });

  it('menerima profil untuk bedengan sendiri', async () => {
    seedBed('user-1', 'bed-1');
    const res = await req('/api/garden/sun-map', {
      method: 'PUT',
      body: JSON.stringify({ lokasiId: 'bed-1', lokasiLabel: 'Bedengan A', jamLangsung: 8 }),
    });
    expect(res.status).toBe(200);
  });

  it('menandai tanaman matahari penuh yang ditaruh di tempat teduh', async () => {
    seedPlanting('user-1', 'p1', 'tomat', 'Teras');
    await req('/api/garden/sun-map', {
      method: 'PUT',
      body: JSON.stringify({ lokasiId: 'loc:Teras', lokasiLabel: 'Teras', jamLangsung: 2 }),
    });

    const body = await (await req('/api/garden/sun-map')).json() as {
      peringatan: Array<{ plantingId: string; kecocokan: string; message: string }>;
    };
    expect(body.peringatan).toHaveLength(1);
    expect(body.peringatan[0].plantingId).toBe('p1');
    expect(body.peringatan[0].kecocokan).toBe('kurang');
    expect(body.peringatan[0].message).toContain('Teras');
  });

  it('mendaftar lokasi terpakai yang belum pernah diukur', async () => {
    // Tanpa daftar ini pengguna harus mengingat sendiri sudut mana yang
    // belum sempat diamati.
    seedPlanting('user-1', 'p1', 'tomat', 'Teras');
    const body = await (await req('/api/garden/sun-map')).json() as {
      belumDiukur: Array<{ lokasiId: string; lokasiLabel: string }>;
      peringatan: unknown[];
    };
    expect(body.belumDiukur).toEqual([{ lokasiId: 'loc:Teras', lokasiLabel: 'Teras' }]);
    // Belum diukur bukan berarti salah tempat.
    expect(body.peringatan).toHaveLength(0);
  });

  it('lokasi yang sudah diukur hilang dari daftar belum-diukur', async () => {
    seedPlanting('user-1', 'p1', 'tomat', 'Teras');
    await req('/api/garden/sun-map', {
      method: 'PUT',
      body: JSON.stringify({ lokasiId: 'loc:Teras', jamLangsung: 8 }),
    });
    const body = await (await req('/api/garden/sun-map')).json() as { belumDiukur: unknown[] };
    expect(body.belumDiukur).toEqual([]);
  });

  it('tidak membawa profil atau tanaman pengguna lain', async () => {
    seedPlanting('user-2', 'p-lain', 'tomat', 'Teras');
    db.prepare(
      `INSERT INTO garden_sun_profile (user_id, lokasi_id, lokasi_label, hours_direct) VALUES ('user-2','loc:Teras','Teras',1)`
    ).run();

    const body = await (await req('/api/garden/sun-map')).json() as {
      profil: unknown[]; belumDiukur: unknown[]; peringatan: unknown[];
    };
    expect(body.profil).toEqual([]);
    expect(body.belumDiukur).toEqual([]);
    expect(body.peringatan).toEqual([]);
  });

  it('DELETE hanya menghapus profil sendiri', async () => {
    await req('/api/garden/sun-map', { method: 'PUT', body: JSON.stringify({ lokasiId: 'loc:Teras', jamLangsung: 5 }) });

    await req('/api/garden/sun-map/loc:Teras', { method: 'DELETE' }, otherToken);
    expect(await db.prepare('SELECT lokasi_id FROM garden_sun_profile').first()).toBeTruthy();

    await req('/api/garden/sun-map/loc:Teras', { method: 'DELETE' }, token);
    expect(await db.prepare('SELECT lokasi_id FROM garden_sun_profile').first()).toBeFalsy();
  });
});

describe('sun-map/fit', () => {
  it('menyebut lokasi mana yang memenuhi kebutuhan tanaman', async () => {
    seedBed('user-1', 'bed-1');
    await req('/api/garden/sun-map', {
      method: 'PUT', body: JSON.stringify({ lokasiId: 'bed-1', lokasiLabel: 'Bedengan A', jamLangsung: 8 }),
    });
    await req('/api/garden/sun-map', {
      method: 'PUT', body: JSON.stringify({ lokasiId: 'loc:Teras', lokasiLabel: 'Teras', jamLangsung: 2 }),
    });

    const body = await (await req('/api/garden/sun-map/fit?plantId=tomat')).json() as {
      cocok: Array<{ lokasiId: string }>; adaProfil: boolean;
    };
    expect(body.cocok.map((p) => p.lokasiId)).toEqual(['bed-1']);
    expect(body.adaProfil).toBe(true);
  });

  it('membedakan "belum ada profil" dari "tidak ada yang cocok"', async () => {
    // Dua keadaan yang berbeda, dan layar harus bisa mengatakannya dengan
    // benar: yang satu berarti "ukur dulu", yang lain "memang tidak ada tempat".
    const kosong = await (await req('/api/garden/sun-map/fit?plantId=tomat')).json() as {
      cocok: unknown[]; adaProfil: boolean;
    };
    expect(kosong.cocok).toEqual([]);
    expect(kosong.adaProfil).toBe(false);

    await req('/api/garden/sun-map', { method: 'PUT', body: JSON.stringify({ lokasiId: 'loc:Teras', jamLangsung: 1 }) });
    const adaTapiTidakCocok = await (await req('/api/garden/sun-map/fit?plantId=tomat')).json() as {
      cocok: unknown[]; adaProfil: boolean;
    };
    expect(adaTapiTidakCocok.cocok).toEqual([]);
    expect(adaTapiTidakCocok.adaProfil).toBe(true);
  });

  it('menolak tanaman di luar katalog', async () => {
    expect((await req('/api/garden/sun-map/fit?plantId=tidak-ada')).status).toBe(404);
    expect((await req('/api/garden/sun-map/fit')).status).toBe(404);
  });
});

// ───────────────────────── BENIH SIMPANAN ─────────────────────────

describe('benih simpanan sendiri', () => {
  it('benih dari tanaman asal beli jadi generasi pertama', async () => {
    seedPlanting('user-1', 'p1', 'tomat', null);
    const res = await req('/api/garden/saved-seeds', {
      method: 'POST',
      body: JSON.stringify({ plantingId: 'p1', harvestedDate: '2026-02-01', quantity: 30 }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { generation: number; generationLabel: string };
    expect(body.generation).toBe(1);
    expect(body.generationLabel).toBe('F1');
  });

  it('menolak tanaman milik pengguna lain', async () => {
    seedPlanting('user-2', 'p-lain', 'tomat', null);
    const res = await req('/api/garden/saved-seeds', {
      method: 'POST', body: JSON.stringify({ plantingId: 'p-lain' }),
    });
    expect(res.status).toBe(404);
    expect(await db.prepare('SELECT id FROM garden_saved_seed').first()).toBeFalsy();
  });

  it('menolak tanpa plantingId', async () => {
    expect((await req('/api/garden/saved-seeds', { method: 'POST', body: JSON.stringify({}) })).status).toBe(400);
  });

  /**
   * Rantai silsilah lengkap: benih F1 → disemai → jadi tanaman → benih
   * disimpan lagi dari tanaman itu → harus jadi F2.
   */
  async function rantaiSampaiF2() {
    seedPlanting('user-1', 'induk', 'tomat', null);
    const f1 = await (await req('/api/garden/saved-seeds', {
      method: 'POST', body: JSON.stringify({ plantingId: 'induk' }),
    })).json() as { id: string };

    seedPlanting('user-1', 'anak', 'tomat', null);
    db.prepare(
      `INSERT INTO garden_sowings (id, user_id, plant_id, name, sown_date, seed_count, planting_id)
       VALUES ('sow-1', 'user-1', 'tomat', 'Tomat', '2026-03-01', 10, 'anak')`
    ).run();
    await req(`/api/garden/saved-seeds/${f1.id}/sow`, {
      method: 'POST', body: JSON.stringify({ sowingId: 'sow-1' }),
    });
    return f1;
  }

  it('benih dari keturunannya naik satu generasi', async () => {
    await rantaiSampaiF2();
    const f2 = await (await req('/api/garden/saved-seeds', {
      method: 'POST', body: JSON.stringify({ plantingId: 'anak' }),
    })).json() as { generation: number; generationLabel: string };
    expect(f2.generation).toBe(2);
    expect(f2.generationLabel).toBe('F2');
  });

  it('menautkan semai ke benih hanya kalau keduanya milik sendiri', async () => {
    seedPlanting('user-1', 'p1', 'tomat', null);
    const seed = await (await req('/api/garden/saved-seeds', {
      method: 'POST', body: JSON.stringify({ plantingId: 'p1' }),
    })).json() as { id: string };

    db.prepare(
      `INSERT INTO garden_sowings (id, user_id, plant_id, name, sown_date, seed_count)
       VALUES ('sow-lain', 'user-2', 'tomat', 'Tomat', '2026-03-01', 10)`
    ).run();

    const res = await req(`/api/garden/saved-seeds/${seed.id}/sow`, {
      method: 'POST', body: JSON.stringify({ sowingId: 'sow-lain' }),
    });
    expect(res.status).toBe(404);
    expect(await db.prepare('SELECT sowing_id FROM garden_sowing_seed_source').first()).toBeFalsy();
  });

  it('meringkas galur dengan rata-rata panen per generasi', async () => {
    await rantaiSampaiF2();
    // Tanaman F1 (anak) menghasilkan 5 kg.
    db.prepare(
      `INSERT INTO garden_care_log (id, user_id, planting_id, action, action_date, amount, unit)
       VALUES ('log-1', 'user-1', 'anak', 'panen', '2026-06-01', 5, 'kg')`
    ).run();

    const body = await (await req('/api/garden/saved-seeds')).json() as {
      seeds: Array<{ generationLabel: string; name: string }>;
      galur: Array<{ label: string; generasiTertinggi: number; perGenerasi: Array<{ generation: number; rataPanen: number }> }>;
    };

    expect(body.seeds[0].name).toBe('Tomat');
    const tomat = body.galur.find((g) => g.label === 'Tomat')!;
    expect(tomat.generasiTertinggi).toBe(1);
    expect(tomat.perGenerasi).toEqual([{ generation: 1, jumlahDinilai: 1, rataPanen: 5, unit: 'kg' }]);
  });

  it('DELETE hanya menghapus benih sendiri', async () => {
    seedPlanting('user-1', 'p1', 'tomat', null);
    const seed = await (await req('/api/garden/saved-seeds', {
      method: 'POST', body: JSON.stringify({ plantingId: 'p1' }),
    })).json() as { id: string };

    await req(`/api/garden/saved-seeds/${seed.id}`, { method: 'DELETE' }, otherToken);
    expect(await db.prepare('SELECT id FROM garden_saved_seed').first()).toBeTruthy();

    await req(`/api/garden/saved-seeds/${seed.id}`, { method: 'DELETE' }, token);
    expect(await db.prepare('SELECT id FROM garden_saved_seed').first()).toBeFalsy();
  });

  it('menghapus tanaman induk tidak ikut melenyapkan benihnya', async () => {
    // Toplesnya masih ada isinya walau catatan penanamannya dibersihkan.
    seedPlanting('user-1', 'p1', 'tomat', null);
    await req('/api/garden/saved-seeds', { method: 'POST', body: JSON.stringify({ plantingId: 'p1' }) });

    db.prepare('DELETE FROM garden_plantings WHERE id = ?1').bind('p1').run();

    const body = await (await req('/api/garden/saved-seeds')).json() as {
      seeds: Array<{ sourcePlantingId: string | null; name: string }>;
    };
    expect(body.seeds).toHaveLength(1);
    expect(body.seeds[0].sourcePlantingId).toBeNull();
    expect(body.seeds[0].name).toBe('Tomat');
  });
});
