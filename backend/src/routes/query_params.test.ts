/**
 * Uji masukan yang bentuknya salah — dari URL maupun dari basis data.
 *
 * `?weeks=` yang kosong dan `?weeks=abc` sama-sama menghasilkan NaN. NaN yang
 * masuk ke perhitungan tanggal tidak berhenti di situ: `Date` jadi Invalid,
 * lalu `toISOString()` melempar `RangeError`, dan yang sampai ke pengguna
 * adalah galat 500 — bukan jawaban wajar atas permintaan yang salah ketik.
 *
 * Bentuk kegagalannya sama untuk tiap rute yang menerima angka lewat URL,
 * jadi yang diperiksa di sini adalah rutenya tetap menjawab, bukan angkanya.
 *
 * Bagian terakhir menguji hal yang serupa dari arah sebaliknya: kolom teks
 * yang isinya seharusnya JSON tapi ternyata bukan. Itu bisa masuk lewat impor
 * berkas backup, dan satu baris rusak tidak boleh menjatuhkan seluruh daftar.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import habits from './habits';
import daily from './daily';
import ibadah from './ibadah';
import agent from './agent';
import { signJWT } from '../lib/jwt';
import { createTestDb, seedUser, type FakeD1 } from '../test/d1';

const JWT_SECRET = 'rahasia-untuk-test';

let db: FakeD1;
let app: Hono<never>;
let token: string;

function makeEnv() {
  return {
    DB: db,
    JWT_SECRET,
    AI: { run: async () => { throw new Error('AI tidak dipakai di test ini'); } },
  } as unknown as Record<string, unknown>;
}

beforeEach(async () => {
  db = createTestDb();
  seedUser(db, 'user-1');
  const now = Math.floor(Date.now() / 1000);
  token = await signJWT({ sub: 'user-1', name: 'Penguji', role: 'user', iat: now, exp: now + 3600 }, JWT_SECRET);

  app = new Hono() as Hono<never>;
  app.route('/api/habits', habits as never);
  app.route('/api/daily', daily as never);
  app.route('/api/ibadah', ibadah as never);
  app.route('/api/agent', agent as never);
});

afterEach(() => db.__close());

async function req(path: string): Promise<Response> {
  return app.request(
    `http://test${path}`,
    { headers: { Authorization: `Bearer ${token}` } },
    makeEnv()
  );
}

const ANGKA_RUSAK = ['', 'abc', 'NaN', 'Infinity', '-1', '1e400'];

describe('GET /api/habits/completions', () => {
  it('menjawab wajar untuk nilai weeks apa pun', async () => {
    for (const nilai of ANGKA_RUSAK) {
      const res = await req(`/api/habits/completions?weeks=${nilai}`);
      expect(res.status, `weeks=${nilai}`).toBe(200);
    }
  });

  it('tetap jalan tanpa parameter', async () => {
    expect((await req('/api/habits/completions')).status).toBe(200);
  });
});

describe('GET /api/daily/patterns', () => {
  it('menjawab wajar untuk nilai days apa pun', async () => {
    for (const nilai of ANGKA_RUSAK) {
      const res = await req(`/api/daily/patterns?days=${nilai}`);
      expect(res.status, `days=${nilai}`).toBe(200);
    }
  });
});

describe('GET /api/ibadah/puasa', () => {
  it('menjawab wajar untuk nilai days apa pun', async () => {
    for (const nilai of ANGKA_RUSAK) {
      const res = await req(`/api/ibadah/puasa?days=${nilai}`);
      expect(res.status, `days=${nilai}`).toBe(200);
    }
  });

  it('tidak pernah mengembalikan daftar sepanjang tahun', async () => {
    const res = await req('/api/ibadah/puasa?days=99999');
    const body = await res.json() as { mendatang: Array<{ date: string }> };
    // Batasnya 120 hari; puasa sunnah muncul beberapa kali sepekan, jadi
    // jumlahnya tidak mungkin melebihi rentang harinya.
    expect(body.mendatang.length).toBeLessThanOrEqual(120);
  });
});

describe('GET /api/agent/history', () => {
  it('menjawab wajar untuk nilai limit apa pun', async () => {
    for (const nilai of ANGKA_RUSAK) {
      const res = await req(`/api/agent/history?limit=${nilai}`);
      expect(res.status, `limit=${nilai}`).toBe(200);
    }
  });
});

describe('data tersimpan yang rusak', () => {
  it('satu baris goal_ids rusak tidak menjatuhkan seluruh daftar kebiasaan', async () => {
    db.prepare(
      `INSERT INTO habits (id, user_id, name, goal_ids) VALUES (?1, 'user-1', ?2, ?3)`
    ).bind('h-baik', 'Olahraga', '["g-1"]').run();
    db.prepare(
      `INSERT INTO habits (id, user_id, name, goal_ids) VALUES (?1, 'user-1', ?2, ?3)`
    ).bind('h-rusak', 'Baca buku', 'ini bukan json').run();

    const res = await req('/api/habits');
    expect(res.status).toBe(200);

    const body = await res.json() as Array<{ id: string; goalIds: string[] }>;
    expect(body.map((h) => h.id).sort()).toEqual(['h-baik', 'h-rusak']);

    // Yang rusak tampil dengan daftar kosong, bukan menghilang.
    expect(body.find((h) => h.id === 'h-rusak')?.goalIds).toEqual([]);
    expect(body.find((h) => h.id === 'h-baik')?.goalIds).toEqual(['g-1']);
  });
});
