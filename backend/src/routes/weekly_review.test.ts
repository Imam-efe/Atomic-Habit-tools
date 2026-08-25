/**
 * Uji Review Mingguan: pekan mana yang dibaca dan pekan mana yang ditulis.
 *
 * Kedua sisi harus memakai tanggal WIB. Kalau salah satunya memakai UTC,
 * selisihnya hanya muncul antara tengah malam dan pukul tujuh pagi — dan
 * hanya pada hari Senin efeknya terlihat: yang dibaca pekan ini, yang
 * tersimpan pekan lalu, dan review yang baru saja ditulis seolah hilang.
 *
 * Waktunya dipalsukan ke jam itu persis, karena di jam lain bug ini tidak
 * pernah terlihat.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import weeklyReview, { getMondayOf } from './weekly_review';
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
  // Masa berlaku panjang: sebagian uji di berkas ini memajukan jam sistem,
  // dan token yang dibuat dengan jam asli akan tampak kedaluwarsa di sana.
  const now = Math.floor(Date.now() / 1000);
  token = await signJWT(
    { sub: 'user-1', name: 'Penguji', role: 'user', iat: now, exp: now + 400 * 86400 },
    JWT_SECRET
  );

  app = new Hono() as Hono<never>;
  app.route('/api/weekly-review', weeklyReview as never);
});

afterEach(() => {
  vi.useRealTimers();
  db.__close();
});

async function req(path: string, init: RequestInit = {}): Promise<Response> {
  return app.request(
    `http://test${path}`,
    { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) } },
    makeEnv()
  );
}

describe('getMondayOf', () => {
  it('mengembalikan Senin dari pekan yang memuat tanggal itu', () => {
    // 26 Agustus 2026 adalah hari Rabu; Seninnya 24 Agustus.
    expect(getMondayOf('2026-08-26')).toBe('2026-08-24');
  });

  it('mengembalikan hari itu sendiri untuk Senin', () => {
    expect(getMondayOf('2026-08-24')).toBe('2026-08-24');
  });

  it('menganggap Minggu sebagai akhir pekan yang sama, bukan awal', () => {
    // 30 Agustus 2026 hari Minggu; Seninnya 24 Agustus, bukan 31.
    expect(getMondayOf('2026-08-30')).toBe('2026-08-24');
  });
});

describe('pekan yang dipakai menyimpan', () => {
  it('sama dengan pekan yang dipakai membaca, pada dini hari WIB', () => {
    // Senin 31 Agustus 2026 pukul 02:00 WIB = Minggu 30 Agustus 19:00 UTC.
    // Menurut UTC hari itu masih Minggu, dan Senin-nya pekan sebelumnya.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-30T19:00:00Z'));

    const wib = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
    const utc = new Date().toISOString().slice(0, 10);

    // Prasyarat uji ini: keduanya memang berbeda pada saat itu.
    expect(wib).not.toBe(utc);
    expect(getMondayOf(wib)).not.toBe(getMondayOf(utc));
  });

  it('menyimpan ke pekan berjalan menurut WIB', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-30T19:00:00Z')); // Senin 31 Agustus 02:00 WIB

    const res = await req('/api/weekly-review', {
      method: 'POST',
      body: JSON.stringify({ habitReflection: 'pekan ini lancar', rating: 4 }),
    });
    expect(res.status).toBe(201);

    const row = await db.prepare('SELECT week_start FROM weekly_reviews WHERE user_id = ?1')
      .bind('user-1').first<{ week_start: string }>();

    expect(row?.week_start).toBe('2026-08-31');
  });

  it('membaca pekan yang sama dengan yang baru disimpan', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-30T19:00:00Z'));

    await req('/api/weekly-review', {
      method: 'POST',
      body: JSON.stringify({ habitReflection: 'catatan uji', rating: 5 }),
    });

    const body = await (await req('/api/weekly-review')).json() as {
      review: { habit_reflection: string | null } | null;
    };

    expect(body.review?.habit_reflection).toBe('catatan uji');
  });

  it('tetap menghormati weekStart yang dikirim pemanggil', async () => {
    await req('/api/weekly-review', {
      method: 'POST',
      body: JSON.stringify({ weekStart: '2026-07-15', habitReflection: 'pekan lampau' }),
    });

    const row = await db.prepare('SELECT week_start FROM weekly_reviews WHERE user_id = ?1')
      .bind('user-1').first<{ week_start: string }>();

    // 15 Juli 2026 hari Rabu — disimpan ke Senin pekannya.
    expect(row?.week_start).toBe('2026-07-13');
  });
});
