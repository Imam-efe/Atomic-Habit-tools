/**
 * Uji GET /api/settings/database.
 *
 * Endpoint ini menyusun nama tabel ke dalam SQL untuk menghitung semuanya
 * dalam satu UNION ALL, menggantikan enam puluh COUNT(*) terpisah. Tiga hal
 * yang dijaga, dan dua di antaranya hal yang dulu dijamin oleh try/catch per
 * tabel dan sekarang harus dijamin cara lain:
 *
 * 1. Angkanya benar, dan hanya menghitung baris MILIK pengguna yang bertanya.
 *    Satu `?1` melayani puluhan cabang UNION; kalau pengikatannya salah,
 *    halamannya tetap tampil dengan angka milik orang lain.
 * 2. Tabel yang belum ada di database ini tidak menggagalkan seluruh halaman.
 *    Dulu dijamin try/catch per tabel; sekarang oleh penyaringan terhadap
 *    sqlite_master, karena satu nama tabel yang tidak ada akan menjatuhkan
 *    seluruh UNION ALL — bukan satu barisnya.
 * 3. Jumlah kuerinya tetap sedikit. Tanpa penjaga ini, kembalinya pola
 *    satu-kueri-per-tabel tidak akan terlihat oleh uji mana pun.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import settingsRoute, { DATA_TABLES } from './settings';
import { signJWT } from '../lib/jwt';
import { createTestDb, seedUser, type FakeD1 } from '../test/d1';

const JWT_SECRET = 'rahasia-untuk-test';

let db: FakeD1;
let app: Hono<never>;
let token: string;

function env() {
  return { DB: db, JWT_SECRET } as unknown as Record<string, unknown>;
}

function req(path: string) {
  return app.fetch(
    new Request(`http://x${path}`, { headers: { Authorization: `Bearer ${token}` } }),
    env()
  );
}

interface Jawaban {
  tables: Array<{ table: string; label: string; rows: number }>;
  empty: string[];
  photoBytes: number;
}

beforeEach(async () => {
  db = createTestDb();
  seedUser(db, 'user-1');
  seedUser(db, 'user-2');
  const now = Math.floor(Date.now() / 1000);
  token = await signJWT({ sub: 'user-1', name: 'P', role: 'user', iat: now, exp: now + 3600 }, JWT_SECRET);

  app = new Hono() as Hono<never>;
  app.route('/api/settings', settingsRoute as never);
});

afterEach(() => db.__close());

async function catatTransaksi(userId: string, n: number) {
  for (let i = 0; i < n; i++) {
    await db.prepare(
      `INSERT INTO budget_entries (id, user_id, type, amount_idr, category, entry_date, created_at)
       VALUES (?1, ?2, 'expense', 1000, 'Lainnya', '2026-01-01', 0)`
    ).bind(`e-${userId}-${i}`, userId).run();
  }
}

describe('GET /api/settings/database', () => {
  it('menghitung baris per tabel', async () => {
    await catatTransaksi('user-1', 3);

    const r = await (await req('/api/settings/database')).json() as Jawaban;
    const baris = r.tables.find((t) => t.table === 'budget_entries');
    expect(baris?.rows).toBe(3);
  });

  it('hanya menghitung baris milik pengguna yang bertanya', async () => {
    // Satu `?1` melayani puluhan cabang UNION. Kalau pengikatannya salah,
    // halaman tetap tampil — dengan angka milik orang lain.
    await catatTransaksi('user-1', 2);
    await catatTransaksi('user-2', 9);

    const r = await (await req('/api/settings/database')).json() as Jawaban;
    expect(r.tables.find((t) => t.table === 'budget_entries')?.rows).toBe(2);
  });

  it('tabel yang kosong masuk daftar kosong, bukan hilang', async () => {
    const r = await (await req('/api/settings/database')).json() as Jawaban;
    // Tanpa data apa pun, semua tabel user-scoped harus terlaporkan kosong.
    expect(r.tables).toEqual([]);
    expect(r.empty.length).toBeGreaterThan(10);
  });

  it('tidak menggagalkan halaman saat sebuah tabel belum ada', async () => {
    // Dijamin penyaringan terhadap sqlite_master. Satu nama tabel yang tidak
    // ada akan menjatuhkan SELURUH UNION ALL, jadi tabelnya harus disaring
    // sebelum namanya masuk ke SQL.
    await catatTransaksi('user-1', 1);
    await db.prepare('DROP TABLE IF EXISTS zakat_payments').run();

    const res = await req('/api/settings/database');
    expect(res.status).toBe(200);
    const r = await res.json() as Jawaban;
    expect(r.tables.find((t) => t.table === 'budget_entries')?.rows).toBe(1);
    // Yang hilang tetap dilaporkan kosong, tidak menghilang dari halaman.
    const zakat = DATA_TABLES.find((t) => t.table === 'zakat_payments')!;
    expect(r.empty).toContain(zakat.label);
  });

  it('memakai sedikit kueri, bukan satu per tabel', async () => {
    let n = 0;
    const asli = db.prepare.bind(db);
    (db as unknown as { prepare: (s: string) => unknown }).prepare = (sql: string) => {
      n++;
      return asli(sql);
    };

    await req('/api/settings/database');

    // Daftar tabel, hitungan gabungan, ukuran foto — plus pembacaan auth.
    // Dulu angkanya di atas enam puluh. Tanpa batas ini, kembalinya pola
    // satu-kueri-per-tabel tidak akan terlihat oleh uji mana pun.
    expect(n).toBeLessThanOrEqual(6);
    expect(DATA_TABLES.length).toBeGreaterThan(40);
  });
});
