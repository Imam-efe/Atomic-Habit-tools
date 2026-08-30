/**
 * Uji rute pencapaian: badge kebun baru (#10) tidak boleh menghitung data
 * pengguna lain, dan query-nya harus benar-benar jalan di skema produksi.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import achievements from './achievements';
import { Hono } from 'hono';
import { signJWT } from '../lib/jwt';
import { createTestDb, seedUser, type FakeD1 } from '../test/d1';

const JWT_SECRET = 'rahasia-untuk-test';

let db: FakeD1;
let app: Hono<never>;
let token: string;

function makeEnv() {
  return { DB: db, JWT_SECRET } as unknown as Record<string, unknown>;
}

async function mint(sub: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return signJWT({ sub, name: 'Penguji', role: 'user', iat: now, exp: now + 3600 }, JWT_SECRET);
}

function req(path: string) {
  return app.request(`http://test${path}`, { headers: { Authorization: `Bearer ${token}` } }, makeEnv());
}

beforeEach(async () => {
  db = createTestDb();
  seedUser(db, 'user-1');
  seedUser(db, 'user-2');
  token = await mint('user-1');
  app = new Hono() as Hono<never>;
  app.route('/api/achievements', achievements as never);
});

afterEach(() => db.__close());

describe('badge kebun', () => {
  it('menghitung panen, tanaman, kompos terpakai, dan bedengan milik pengguna sendiri', async () => {
    db.prepare(`INSERT INTO garden_plantings (id, user_id, plant_id, quantity, planted_date, status) VALUES ('p-1', 'user-1', 'bayam', 1, '2026-01-01', 'panen')`).run();
    db.prepare(`INSERT INTO garden_care_log (id, user_id, planting_id, action, action_date) VALUES ('log-1', 'user-1', 'p-1', 'panen', '2026-01-10')`).run();
    db.prepare(`INSERT INTO garden_compost_batches (id, user_id, name, started_date, status) VALUES ('c-1', 'user-1', 'Batch A', '2026-01-01', 'terpakai')`).run();
    db.prepare(`INSERT INTO garden_compost_batches (id, user_id, name, started_date, status) VALUES ('c-2', 'user-1', 'Batch B', '2026-01-01', 'proses')`).run();
    db.prepare(`INSERT INTO garden_beds (id, user_id, name, width_cm, length_cm) VALUES ('bed-1', 'user-1', 'Bedengan A', 100, 200)`).run();

    // data milik user-2 tidak boleh ikut terhitung
    db.prepare(`INSERT INTO garden_plantings (id, user_id, plant_id, quantity, planted_date, status) VALUES ('p-2', 'user-2', 'bayam', 1, '2026-01-01', 'panen')`).run();
    db.prepare(`INSERT INTO garden_beds (id, user_id, name, width_cm, length_cm) VALUES ('bed-2', 'user-2', 'Bedengan B', 100, 200)`).run();

    const res = await req('/api/achievements');
    expect(res.status).toBe(200);
    const body = await res.json() as { badges: Array<{ id: string; currentValue: number; earned: boolean }> };

    const byId = new Map(body.badges.map((b) => [b.id, b]));
    expect(byId.get('garden-harvest-10')?.currentValue).toBe(1);
    expect(byId.get('garden-planting-25')?.currentValue).toBe(1);
    expect(byId.get('garden-compost-5')?.currentValue).toBe(1); // hanya yang 'terpakai'
    expect(byId.get('garden-bed-1')?.currentValue).toBe(1);
    expect(byId.get('garden-bed-1')?.earned).toBe(true);
  });

  it('badge kebun tidak error saat belum ada data sama sekali', async () => {
    const res = await req('/api/achievements');
    expect(res.status).toBe(200);
    const body = await res.json() as { badges: Array<{ id: string; currentValue: number }> };
    const byId = new Map(body.badges.map((b) => [b.id, b]));
    expect(byId.get('garden-harvest-10')?.currentValue).toBe(0);
  });
});
