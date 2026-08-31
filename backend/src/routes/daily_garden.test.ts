/**
 * Uji kebun di dalam ringkasan harian.
 *
 * Sebelum ini, kebun adalah satu-satunya modul dengan tugas harian yang tidak
 * pernah muncul di Pagi Ini maupun Tutup Hari.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import daily, { getGardenToday } from './daily';
import { Hono } from 'hono';
import { signJWT } from '../lib/jwt';
import { createTestDb, seedUser, type FakeD1 } from '../test/d1';

const JWT_SECRET = 'rahasia-untuk-test';
let db: FakeD1;
let app: Hono<never>;
let token: string;

async function mint(sub: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return signJWT({ sub, name: 'Penguji', role: 'user', iat: now, exp: now + 3600 }, JWT_SECRET);
}

function req(path: string) {
  return app.request(
    `http://test${path}`,
    { headers: { Authorization: `Bearer ${token}` } },
    { DB: db, JWT_SECRET } as never
  );
}

beforeEach(async () => {
  db = createTestDb();
  seedUser(db, 'user-1');
  token = await mint('user-1');
  app = new Hono() as Hono<never>;
  app.route('/api/daily', daily as never);
});

afterEach(() => db.__close());

/** Ditanam jauh di masa lalu supaya siram dan pupuknya pasti sudah jatuh tempo. */
function seedPlanting(id: string, plantId: string | null, plantedDate = '2026-01-01', status = 'tumbuh') {
  db.prepare(
    `INSERT INTO garden_plantings (id, user_id, plant_id, custom_name, quantity, planted_date, status)
     VALUES (?1, 'user-1', ?2, ?3, 1, ?4, ?5)`
  ).bind(id, plantId, plantId ? null : 'Tanaman kustom', plantedDate, status).run();
}

function seedCare(id: string, plantingId: string, action: string, date: string) {
  db.prepare(
    `INSERT INTO garden_care_log (id, user_id, planting_id, action, action_date)
     VALUES (?1, 'user-1', ?2, ?3, ?4)`
  ).bind(id, plantingId, action, date).run();
}

describe('getGardenToday', () => {
  it('kebun kosong menghasilkan nol, bukan melempar', async () => {
    const g = await getGardenToday(db as never, 'user-1', '2026-08-31');
    expect(g).toMatchObject({ perluSiram: 0, perluPupuk: 0, siapPanen: 0, terlantar: 0 });
    expect(g.contoh).toEqual([]);
  });

  it('menghitung tanaman yang telat siram', async () => {
    seedPlanting('p1', 'kangkung');
    seedCare('c1', 'p1', 'siram', '2026-01-02');

    const g = await getGardenToday(db as never, 'user-1', '2026-08-31');
    expect(g.perluSiram).toBeGreaterThan(0);
    expect(g.contoh.length).toBeGreaterThan(0);
  });

  it('tanaman selesai dan gagal tidak ikut dihitung', async () => {
    seedPlanting('p1', 'kangkung', '2026-01-01', 'selesai');
    seedPlanting('p2', 'kangkung', '2026-01-01', 'gagal');

    const g = await getGardenToday(db as never, 'user-1', '2026-08-31');
    expect(g.perluSiram).toBe(0);
    expect(g.terlantar).toBe(0);
  });

  it('contoh dibatasi tiga nama supaya teksnya tidak meluber', async () => {
    for (let i = 1; i <= 6; i++) {
      seedPlanting(`p${i}`, 'kangkung');
      seedCare(`c${i}`, `p${i}`, 'siram', '2026-01-02');
    }

    const g = await getGardenToday(db as never, 'user-1', '2026-08-31');
    expect(g.contoh).toHaveLength(3);
  });

  it('tanaman yang lama tidak disentuh dihitung terlantar', async () => {
    seedPlanting('p1', 'kangkung', '2026-01-01');
    seedCare('c1', 'p1', 'siram', '2026-01-05');

    const g = await getGardenToday(db as never, 'user-1', '2026-08-31');
    expect(g.terlantar).toBe(1);
  });

  it('yang baru dipanen tidak dianggap terlantar meski jarang disiram', async () => {
    // Sentuhan terakhir dihitung dari aksi APA PUN, bukan hanya siram.
    seedPlanting('p1', 'kangkung', '2026-01-01');
    seedCare('c1', 'p1', 'siram', '2026-01-05');
    seedCare('c2', 'p1', 'panen', '2026-08-30');

    const g = await getGardenToday(db as never, 'user-1', '2026-08-31');
    expect(g.terlantar).toBe(0);
  });
});

describe('kebun di endpoint harian', () => {
  it('/brief membawa kunci kebun', async () => {
    seedPlanting('p1', 'kangkung');
    const body = await (await req('/api/daily/brief')).json() as { kebun?: { perluSiram: number } };
    expect(body.kebun).toBeDefined();
    expect(typeof body.kebun!.perluSiram).toBe('number');
  });

  it('/shutdown membawa kunci kebun', async () => {
    seedPlanting('p1', 'kangkung');
    const body = await (await req('/api/daily/shutdown')).json() as { kebun?: { perluSiram: number } };
    expect(body.kebun).toBeDefined();
  });
});
