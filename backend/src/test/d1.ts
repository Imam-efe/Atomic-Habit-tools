/**
 * D1 tiruan di atas node:sqlite, untuk menguji rute sungguhan.
 *
 * Sampai sekarang hampir seluruh pengujian backend adalah logika murni. Yang
 * tidak pernah teruji justru lapisan yang paling sering salah dan paling sunyi
 * ketika salah: SQL, nama kolom, dan cek kepemilikan di dalam rute. Dua bug
 * nyata yang lolos ke produksi belakangan ini — `garden_plant_price` yang
 * dikunci lewat `plant_key` bukan `plant_id`, dan `habit_stack_items` yang
 * tidak punya `user_id` — keduanya tak terlihat oleh TypeScript dan hanya
 * ketahuan karena SQL-nya dijalankan manual satu per satu.
 *
 * Berkas ini memindahkan pemeriksaan manual itu ke dalam test: skema yang
 * dipakai adalah berkas migrasi yang sama persis dengan yang dijalankan saat
 * deploy, sehingga kolom yang salah ketik gagal di CI, bukan di ponsel
 * pengguna.
 *
 * Yang ditiru hanya permukaan D1 yang benar-benar dipakai kode ini:
 * prepare/bind/first/all/run dan batch. Sengaja tidak lebih.
 */

import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS_DIR = join(import.meta.dirname, '../../migrations');

type Row = Record<string, unknown>;

/**
 * D1 memakai parameter bernomor (`?1`, `?2`) sedangkan node:sqlite memakai
 * `?` polos secara berurutan. Penomoran D1 boleh memakai ulang parameter yang
 * sama di beberapa tempat — dan kode ini memang melakukannya — jadi urutan
 * argumen harus disusun ulang, bukan sekadar tanda tanyanya diganti.
 */
function toPositional(sql: string, values: unknown[]): { sql: string; values: unknown[] } {
  if (!/\?\d/.test(sql)) return { sql, values };

  const ordered: unknown[] = [];
  const rewritten = sql.replace(/\?(\d+)/g, (_m, digits: string) => {
    ordered.push(values[Number(digits) - 1]);
    return '?';
  });
  return { sql: rewritten, values: ordered };
}

/** node:sqlite menolak boolean dan undefined; D1 menerimanya. */
function normalize(values: unknown[]): unknown[] {
  return values.map((v) => {
    if (v === undefined) return null;
    if (typeof v === 'boolean') return v ? 1 : 0;
    return v;
  });
}

class FakeStatement {
  constructor(
    private db: DatabaseSync,
    private sql: string,
    private values: unknown[] = []
  ) {}

  bind(...values: unknown[]): FakeStatement {
    return new FakeStatement(this.db, this.sql, normalize(values));
  }

  private compiled() {
    const { sql, values } = toPositional(this.sql, this.values);
    return { stmt: this.db.prepare(sql), values };
  }

  async first<T = Row>(column?: string): Promise<T | null> {
    const { stmt, values } = this.compiled();
    const row = stmt.get(...(values as never[])) as Row | undefined;
    if (!row) return null;
    return (column ? (row[column] as T) : (row as T));
  }

  async all<T = Row>(): Promise<{ results: T[]; success: true; meta: { changes: number } }> {
    const { stmt, values } = this.compiled();
    const rows = stmt.all(...(values as never[])) as T[];
    return { results: rows, success: true, meta: { changes: 0 } };
  }

  async run(): Promise<{ success: true; meta: { changes: number; last_row_id: number } }> {
    const { stmt, values } = this.compiled();
    const info = stmt.run(...(values as never[]));
    return {
      success: true,
      meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) },
    };
  }
}

export interface FakeD1 {
  prepare(sql: string): FakeStatement;
  batch(statements: FakeStatement[]): Promise<unknown[]>;
  /** Hanya untuk test: menutup koneksi supaya berkas sementara tidak menumpuk. */
  __close(): void;
}

/**
 * Basis data kosong berisi seluruh skema produksi.
 *
 * Migrasi dibaca dari direktori, bukan didaftar manual, supaya migrasi baru
 * ikut terpakai tanpa ada yang perlu ingat memperbarui berkas ini.
 */
export function createTestDb(): FakeD1 {
  const db = new DatabaseSync(':memory:');
  // Kepemilikan lewat foreign key adalah bagian dari yang diuji, jadi
  // penegakannya dinyalakan — SQLite mematikannya secara bawaan.
  db.exec('PRAGMA foreign_keys = ON');

  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    try {
      db.exec(sql);
    } catch (err) {
      throw new Error(`Migrasi ${file} gagal dijalankan: ${String(err)}`);
    }
  }

  return {
    prepare: (sql: string) => new FakeStatement(db, sql),
    batch: async (statements: FakeStatement[]) => {
      // D1 menjalankan batch sebagai satu transaksi implisit. Ditiru di sini
      // supaya uji yang mengandalkan sifat itu — misalnya stok benih yang
      // tidak boleh berkurang kalau catatan semainya gagal disimpan — benar
      // menguji jaminan produksi, bukan kebetulan urutan pernyataan.
      db.exec('BEGIN');
      try {
        const out: unknown[] = [];
        for (const s of statements) out.push(await s.run());
        db.exec('COMMIT');
        return out;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },
    __close: () => db.close(),
  };
}

/** Pengguna uji beserta barisnya di tabel users, supaya foreign key terpenuhi. */
export function seedUser(db: FakeD1, id = 'user-1'): string {
  db.prepare(
    'INSERT INTO users (id, email, name, created_at) VALUES (?1, ?2, ?3, ?4)'
  ).bind(id, `${id}@example.test`, 'Penguji', 0).run();
  return id;
}
