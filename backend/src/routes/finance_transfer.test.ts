/**
 * Uji rute transfer antar rekening.
 *
 * Yang dijaga di sini ada tiga, dan ketiganya jenis kesalahan yang tidak
 * memunculkan galat apa pun — hanya angka yang salah:
 *
 * 1. Total seluruh rekening TIDAK boleh berubah. Uang berpindah tempat; kalau
 *    totalnya ikut bergerak, transfer diam-diam berubah jadi pemasukan atau
 *    pengeluaran.
 * 2. Transfer tidak boleh muncul sebagai mutasi transaksi, kalau tidak setiap
 *    laporan pengeluaran membengkak oleh uang yang cuma pindah dompet.
 * 3. Checksum saldo harus tetap nol. Rute ini menggeser kolom lama di dua
 *    rekening sekaligus; melewatkan salah satunya membuat checksum menyala
 *    untuk transaksi yang sebetulnya benar.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import transferRoute from './finance_transfer';
import bankAccountsRoute from './bank_accounts';
import { signJWT } from '../lib/jwt';
import { createTestDb, seedUser, type FakeD1 } from '../test/d1';
import { saldoSemuaRekening, totalSaldo, semaiSaldoAwal } from '../lib/finance_saldo';

const JWT_SECRET = 'rahasia-untuk-test';

let db: FakeD1;
let app: Hono<never>;
let token: string;
let tokenLain: string;

function env() {
  return { DB: db, JWT_SECRET } as unknown as Record<string, unknown>;
}

async function mint(sub: string): Promise<string> {
  return signJWT({ sub, exp: Math.floor(Date.now() / 1000) + 3600 }, JWT_SECRET);
}

beforeEach(async () => {
  db = createTestDb();
  seedUser(db, 'user-1');
  seedUser(db, 'user-2');
  token = await mint('user-1');
  tokenLain = await mint('user-2');

  app = new Hono() as Hono<never>;
  app.route('/api/transfer', transferRoute as never);
  app.route('/api/bank-accounts', bankAccountsRoute as never);
});

afterEach(() => db.__close());

async function buatRekening(id: string, nama: string, saldo: number, userId = 'user-1') {
  await db.prepare(
    `INSERT INTO bank_accounts (id, user_id, name, account_type, balance)
     VALUES (?1, ?2, ?3, 'Bank', ?4)`
  ).bind(id, userId, nama, saldo).run();
  await semaiSaldoAwal(db as never, userId);
  return id;
}

function req(path: string, init: RequestInit = {}, bearer = token) {
  return app.fetch(
    new Request(`http://x${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    }),
    env()
  );
}

async function saldo(userId = 'user-1') {
  return saldoSemuaRekening(db as never, userId);
}

async function selisihTerbesar(userId = 'user-1') {
  return Math.max(...(await saldo(userId)).map((r) => Math.abs(r.selisih)), 0);
}

describe('POST /api/transfer', () => {
  it('memindahkan saldo tanpa mengubah total, dan checksum tetap nol', async () => {
    await buatRekening('a', 'BCA', 1_000_000);
    await buatRekening('b', 'Dompet', 200_000);
    const totalAwal = totalSaldo(await saldo());

    const res = await req('/api/transfer', {
      method: 'POST',
      body: JSON.stringify({ dari_rekening_id: 'a', ke_rekening_id: 'b', jumlah: 300_000 }),
    });
    expect(res.status).toBe(201);

    const sesudah = await saldo();
    expect(sesudah.find((r) => r.bankAccountId === 'a')!.saldo).toBe(700_000);
    expect(sesudah.find((r) => r.bankAccountId === 'b')!.saldo).toBe(500_000);
    expect(totalSaldo(sesudah)).toBe(totalAwal);
    expect(await selisihTerbesar()).toBe(0);
  });

  it('tidak terhitung sebagai mutasi transaksi', async () => {
    await buatRekening('a', 'BCA', 1_000_000);
    await buatRekening('b', 'Dompet', 0);

    await req('/api/transfer', {
      method: 'POST',
      body: JSON.stringify({ dari_rekening_id: 'a', ke_rekening_id: 'b', jumlah: 400_000 }),
    });

    const a = (await saldo()).find((r) => r.bankAccountId === 'a')!;
    expect(a.mutasi).toBe(0);
    expect(a.transfer).toBe(-400_000);
  });

  it('menolak rekening asal dan tujuan yang sama', async () => {
    await buatRekening('a', 'BCA', 1_000_000);
    const res = await req('/api/transfer', {
      method: 'POST',
      body: JSON.stringify({ dari_rekening_id: 'a', ke_rekening_id: 'a', jumlah: 100_000 }),
    });
    expect(res.status).toBe(400);
    expect((await saldo())[0].saldo).toBe(1_000_000);
  });

  it('menolak jumlah nol atau negatif', async () => {
    await buatRekening('a', 'BCA', 1_000_000);
    await buatRekening('b', 'Dompet', 0);
    for (const jumlah of [0, -50_000]) {
      const res = await req('/api/transfer', {
        method: 'POST',
        body: JSON.stringify({ dari_rekening_id: 'a', ke_rekening_id: 'b', jumlah }),
      });
      expect(res.status).toBe(400);
    }
    expect(totalSaldo(await saldo())).toBe(1_000_000);
  });

  it('rekening milik orang lain terlihat sama dengan yang tidak ada', async () => {
    await buatRekening('a', 'BCA', 1_000_000);
    await buatRekening('asing', 'Punya orang', 5_000_000, 'user-2');

    const res = await req('/api/transfer', {
      method: 'POST',
      body: JSON.stringify({ dari_rekening_id: 'a', ke_rekening_id: 'asing', jumlah: 100_000 }),
    });

    // 404, bukan 403: membedakan keduanya memberi tahu penyerang bahwa id itu ada.
    expect(res.status).toBe(404);
    expect(totalSaldo(await saldo('user-2'))).toBe(5_000_000);
  });

  it('memakai tanggal hari ini bila tidak diberikan, dan menolak format aneh', async () => {
    await buatRekening('a', 'BCA', 1_000_000);
    await buatRekening('b', 'Dompet', 0);

    await req('/api/transfer', {
      method: 'POST',
      body: JSON.stringify({ dari_rekening_id: 'a', ke_rekening_id: 'b', jumlah: 1_000, tanggal: 'kemarin' }),
    });

    const list = await (await req('/api/transfer')).json() as { transfer: Array<{ tanggal: string }> };
    expect(list.transfer[0].tanggal).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('GET /api/transfer', () => {
  it('membawa nama kedua rekening supaya daftar bisa dibaca', async () => {
    await buatRekening('a', 'BCA', 1_000_000);
    await buatRekening('b', 'Dompet', 0);
    await req('/api/transfer', {
      method: 'POST',
      body: JSON.stringify({ dari_rekening_id: 'a', ke_rekening_id: 'b', jumlah: 250_000, catatan: 'tarik tunai' }),
    });

    const list = await (await req('/api/transfer')).json() as {
      transfer: Array<{ dariNama: string; keNama: string; jumlah: number; catatan: string }>;
    };
    expect(list.transfer).toHaveLength(1);
    expect(list.transfer[0].dariNama).toBe('BCA');
    expect(list.transfer[0].keNama).toBe('Dompet');
    expect(list.transfer[0].catatan).toBe('tarik tunai');
  });

  it('tidak membocorkan transfer pengguna lain', async () => {
    await buatRekening('a', 'BCA', 1_000_000, 'user-2');
    await buatRekening('b', 'Dompet', 0, 'user-2');
    await req('/api/transfer', {
      method: 'POST',
      body: JSON.stringify({ dari_rekening_id: 'a', ke_rekening_id: 'b', jumlah: 100_000 }),
    }, tokenLain);

    const list = await (await req('/api/transfer')).json() as { transfer: unknown[] };
    expect(list.transfer).toEqual([]);
  });
});

describe('DELETE /api/transfer/:id', () => {
  it('mengembalikan saldo kedua rekening dan menjaga checksum tetap nol', async () => {
    await buatRekening('a', 'BCA', 1_000_000);
    await buatRekening('b', 'Dompet', 200_000);

    const dibuat = await (await req('/api/transfer', {
      method: 'POST',
      body: JSON.stringify({ dari_rekening_id: 'a', ke_rekening_id: 'b', jumlah: 300_000 }),
    })).json() as { id: string };

    const res = await req(`/api/transfer/${dibuat.id}`, { method: 'DELETE' });
    expect(res.status).toBe(200);

    const sesudah = await saldo();
    expect(sesudah.find((r) => r.bankAccountId === 'a')!.saldo).toBe(1_000_000);
    expect(sesudah.find((r) => r.bankAccountId === 'b')!.saldo).toBe(200_000);
    expect(await selisihTerbesar()).toBe(0);
  });

  it('transfer milik orang lain tidak bisa dihapus dan tidak mengubah saldonya', async () => {
    await buatRekening('a', 'BCA', 1_000_000, 'user-2');
    await buatRekening('b', 'Dompet', 0, 'user-2');
    const dibuat = await (await req('/api/transfer', {
      method: 'POST',
      body: JSON.stringify({ dari_rekening_id: 'a', ke_rekening_id: 'b', jumlah: 100_000 }),
    }, tokenLain)).json() as { id: string };

    const res = await req(`/api/transfer/${dibuat.id}`, { method: 'DELETE' });
    expect(res.status).toBe(404);

    const milikDua = await saldo('user-2');
    expect(milikDua.find((r) => r.bankAccountId === 'a')!.saldo).toBe(900_000);
  });
});
