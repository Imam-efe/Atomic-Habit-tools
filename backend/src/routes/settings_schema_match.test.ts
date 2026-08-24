/**
 * Metadata tabel di settings.ts harus cocok dengan skema sungguhan.
 *
 * Dua rute di berkas itu menyusun SQL dari nama tabel dan nama kolom yang
 * ditulis tangan, lalu membungkus eksekusinya dengan try/catch. Gabungan itu
 * membuat salah ketik tidak pernah terlihat: `/database` melaporkan tabelnya
 * kosong, dan `/database/purge` melaporkan berhasil sambil tidak menghapus
 * apa pun. Persis itu yang terjadi pada `food_facts_cache`, yang didaftarkan
 * dengan kolom umur `created_at` padahal kolomnya bernama `fetched_at`.
 *
 * Karena bentuk kegagalannya diam, satu-satunya penjagaan yang berguna adalah
 * membandingkan daftarnya dengan migrasi yang sama persis dengan produksi.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DATA_TABLES, PURGEABLE } from './settings';
import { createTestDb, type FakeD1 } from '../test/d1';

let db: FakeD1;

/** Nama kolom sebuah tabel menurut skema; kosong bila tabelnya tidak ada. */
async function columnsOf(table: string): Promise<string[]> {
  const rows = await db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
  return (rows.results ?? []).map((r) => r.name);
}

beforeAll(() => { db = createTestDb(); });
afterAll(() => db.__close());

describe('DATA_TABLES', () => {
  it.each(DATA_TABLES.map((t) => [t.table, t] as const))('%s ada di skema', async (_name, entry) => {
    expect(await columnsOf(entry.table)).not.toHaveLength(0);
  });

  it.each(DATA_TABLES.map((t) => [t.table, t] as const))(
    '%s punya user_id sesuai userScoped',
    async (_name, entry) => {
      // Salah di sini berarti hitungannya memakai WHERE user_id pada tabel
      // yang tidak punya kolom itu — dan halaman melaporkannya kosong.
      expect((await columnsOf(entry.table)).includes('user_id')).toBe(entry.userScoped);
    }
  );

  it('tidak mendaftarkan tabel yang sama dua kali', () => {
    const names = DATA_TABLES.map((t) => t.table);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('PURGEABLE', () => {
  it.each(PURGEABLE.map((t) => [t.table, t] as const))('%s ada di skema', async (_name, entry) => {
    expect(await columnsOf(entry.table)).not.toHaveLength(0);
  });

  it.each(PURGEABLE.map((t) => [t.table, t] as const))(
    '%s punya kolom umur yang didaftarkan',
    async (_name, entry) => {
      // Kolom umur yang salah membuat DELETE gagal, dan kegagalannya ditelan
      // try/catch: pengguna menekan "bersihkan" dan tidak terjadi apa-apa.
      expect(await columnsOf(entry.table)).toContain(entry.ageColumn);
    }
  );

  it.each(PURGEABLE.map((t) => [t.table, t] as const))(
    '%s punya user_id sesuai userScoped',
    async (_name, entry) => {
      expect((await columnsOf(entry.table)).includes('user_id')).toBe(entry.userScoped);
    }
  );
});
