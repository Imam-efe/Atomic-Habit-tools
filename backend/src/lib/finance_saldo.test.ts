/**
 * Uji saldo turunan.
 *
 * Yang paling penting di sini bukan rumusnya, melainkan JANJI penyemaian:
 * sesudah disemai, saldo hasil hitungan harus sama persis dengan angka yang
 * selama ini dilihat pengguna. Kalau janji itu meleset, pengguna membuka
 * aplikasi dan menemukan saldonya berubah tanpa ada transaksi apa pun — cara
 * tercepat kehilangan kepercayaan pada modul uang.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, seedUser, type FakeD1 } from '../test/d1';
import { semaiSaldoAwal, saldoSemuaRekening, totalSaldo } from './finance_saldo';
import { nanoid } from './nanoid';

let db: FakeD1;

beforeEach(() => {
  db = createTestDb();
  seedUser(db, 'user-1');
  seedUser(db, 'user-2');
});

afterEach(() => db.__close());

async function buatRekening(userId: string, saldo: number, nama = 'BCA'): Promise<string> {
  const id = nanoid();
  await db.prepare(
    `INSERT INTO bank_accounts (id, user_id, name, account_type, balance)
     VALUES (?1, ?2, ?3, 'Bank', ?4)`
  ).bind(id, userId, nama, saldo).run();
  return id;
}

/** Catat transaksi APA ADANYA — tanpa menyentuh bank_accounts.balance. */
async function catat(opts: {
  userId: string; rekeningId: string | null; tipe: 'income' | 'expense'; jumlah: number;
}): Promise<string> {
  const id = nanoid();
  await db.prepare(
    `INSERT INTO budget_entries (id, user_id, type, amount_idr, category, entry_date, bank_account_id)
     VALUES (?1, ?2, ?3, ?4, 'Lainnya', '2026-01-01', ?5)`
  ).bind(id, opts.userId, opts.tipe, opts.jumlah, opts.rekeningId).run();
  return id;
}

async function saldoSatu(userId: string, rekeningId: string) {
  const semua = await saldoSemuaRekening(db as never, userId);
  return semua.find((r) => r.bankAccountId === rekeningId)!;
}

describe('penyemaian saldo awal', () => {
  it('membuat saldo hitungan sama persis dengan angka yang sudah dilihat pengguna', async () => {
    // Keadaan seperti di produksi: kolom balance sudah disesuaikan tangan
    // mengikuti transaksi yang ada.
    const rek = await buatRekening('user-1', 1_500_000);
    await catat({ userId: 'user-1', rekeningId: rek, tipe: 'income', jumlah: 2_000_000 });
    await catat({ userId: 'user-1', rekeningId: rek, tipe: 'expense', jumlah: 500_000 });

    await semaiSaldoAwal(db as never, 'user-1');

    const s = await saldoSatu('user-1', rek);
    expect(s.saldo).toBe(1_500_000);
    expect(s.selisih).toBe(0);
    // Titik awalnya diturunkan mundur: 1.500.000 - (2.000.000 - 500.000) = 0
    expect(s.saldoAwal).toBe(0);
  });

  it('menurunkan titik awal bukan-nol saat transaksi lama tidak lengkap tercatat', async () => {
    // Kasus nyata: saldo bank benar, tapi riwayat di aplikasi baru sebagian.
    const rek = await buatRekening('user-1', 5_000_000);
    await catat({ userId: 'user-1', rekeningId: rek, tipe: 'expense', jumlah: 200_000 });

    await semaiSaldoAwal(db as never, 'user-1');

    const s = await saldoSatu('user-1', rek);
    expect(s.saldoAwal).toBe(5_200_000);
    expect(s.saldo).toBe(5_000_000);
    expect(s.selisih).toBe(0);
  });

  it('tidak menimpa titik awal yang sudah ada saat disemai ulang', async () => {
    const rek = await buatRekening('user-1', 1_000_000);
    await semaiSaldoAwal(db as never, 'user-1');
    const awal = (await saldoSatu('user-1', rek)).saldoAwal;

    // Transaksi baru masuk, lalu penyemaian dijalankan lagi — misalnya karena
    // dipanggil di tiap permintaan. Titik awalnya tidak boleh bergeser, kalau
    // tidak saldo akan melompat tiap kali ada transaksi baru.
    await catat({ userId: 'user-1', rekeningId: rek, tipe: 'expense', jumlah: 300_000 });
    await semaiSaldoAwal(db as never, 'user-1');

    const s = await saldoSatu('user-1', rek);
    expect(s.saldoAwal).toBe(awal);
    expect(s.saldo).toBe(700_000);
  });

  it('menyemai rekening yang baru dibuat tanpa mengganggu yang lama', async () => {
    const lama = await buatRekening('user-1', 1_000_000, 'BCA');
    await semaiSaldoAwal(db as never, 'user-1');
    await catat({ userId: 'user-1', rekeningId: lama, tipe: 'expense', jumlah: 400_000 });

    const baru = await buatRekening('user-1', 250_000, 'Dompet');
    await semaiSaldoAwal(db as never, 'user-1');

    expect((await saldoSatu('user-1', lama)).saldo).toBe(600_000);
    expect((await saldoSatu('user-1', baru)).saldo).toBe(250_000);
  });
});

describe('perhitungan saldo', () => {
  it('rekening tanpa transaksi bernilai saldo awalnya', async () => {
    const rek = await buatRekening('user-1', 750_000);
    await semaiSaldoAwal(db as never, 'user-1');
    expect((await saldoSatu('user-1', rek)).saldo).toBe(750_000);
  });

  it('transaksi tanpa rekening tidak menggeser saldo mana pun', async () => {
    const rek = await buatRekening('user-1', 1_000_000);
    await semaiSaldoAwal(db as never, 'user-1');
    // Pengeluaran tunai yang tidak dikaitkan ke rekening.
    await catat({ userId: 'user-1', rekeningId: null, tipe: 'expense', jumlah: 999_000 });
    expect((await saldoSatu('user-1', rek)).saldo).toBe(1_000_000);
  });

  it('saldo boleh negatif', async () => {
    const rek = await buatRekening('user-1', 100_000);
    await semaiSaldoAwal(db as never, 'user-1');
    await catat({ userId: 'user-1', rekeningId: rek, tipe: 'expense', jumlah: 300_000 });
    expect((await saldoSatu('user-1', rek)).saldo).toBe(-200_000);
  });

  it('transaksi pengguna lain tidak ikut terhitung', async () => {
    const rek = await buatRekening('user-1', 1_000_000);
    await semaiSaldoAwal(db as never, 'user-1');
    // Baris milik user-2 yang menunjuk rekening user-1 tidak boleh berpengaruh:
    // tanpa penyaringan user_id, satu baris asing bisa menggeser saldo orang lain.
    await catat({ userId: 'user-2', rekeningId: rek, tipe: 'expense', jumlah: 900_000 });
    expect((await saldoSatu('user-1', rek)).saldo).toBe(1_000_000);
  });

  it('hanya mengembalikan rekening milik pengguna yang bertanya', async () => {
    await buatRekening('user-1', 1_000_000);
    await buatRekening('user-2', 2_000_000);
    await semaiSaldoAwal(db as never, 'user-1');
    await semaiSaldoAwal(db as never, 'user-2');

    const milikSatu = await saldoSemuaRekening(db as never, 'user-1');
    expect(milikSatu).toHaveLength(1);
    expect(totalSaldo(milikSatu)).toBe(1_000_000);
  });

  it('terurut saldo terbesar dulu', async () => {
    await buatRekening('user-1', 100_000, 'Kecil');
    await buatRekening('user-1', 900_000, 'Besar');
    await buatRekening('user-1', 500_000, 'Sedang');
    await semaiSaldoAwal(db as never, 'user-1');

    const urut = (await saldoSemuaRekening(db as never, 'user-1')).map((r) => r.nama);
    expect(urut).toEqual(['Besar', 'Sedang', 'Kecil']);
  });

  it('rekening yang belum disemai tetap terbaca, tidak hilang', async () => {
    // Saldo awalnya nol, jadi angkanya belum tentu benar — tapi menghilangkan
    // rekeningnya dari daftar jauh lebih buruk daripada menampilkan nol.
    const rek = await buatRekening('user-1', 1_000_000);
    await catat({ userId: 'user-1', rekeningId: rek, tipe: 'income', jumlah: 50_000 });
    const s = await saldoSatu('user-1', rek);
    expect(s.saldoAwal).toBe(0);
    expect(s.saldo).toBe(50_000);
    expect(s.selisih).toBe(950_000);
  });
});

describe('selisih terhadap kolom lama', () => {
  it('nol selama tiap mutasi saldo berpasangan dengan baris transaksi', async () => {
    const rek = await buatRekening('user-1', 1_000_000);
    await semaiSaldoAwal(db as never, 'user-1');

    // Tiru jalur tulis yang benar: catat transaksi DAN sesuaikan kolom lama.
    await catat({ userId: 'user-1', rekeningId: rek, tipe: 'expense', jumlah: 250_000 });
    await db.prepare('UPDATE bank_accounts SET balance = balance - ?1 WHERE id = ?2')
      .bind(250_000, rek).run();

    expect((await saldoSatu('user-1', rek)).selisih).toBe(0);
  });

  it('memperlihatkan jalur tulis yang menggeser kolom lama tanpa mencatat transaksi', async () => {
    // Inilah cacat yang tidak bisa dilihat sebelum ada berkas ini: saldo
    // bergeser tanpa jejak transaksi, dan tidak ada yang bisa membuktikannya.
    const rek = await buatRekening('user-1', 1_000_000);
    await semaiSaldoAwal(db as never, 'user-1');

    await db.prepare('UPDATE bank_accounts SET balance = balance - ?1 WHERE id = ?2')
      .bind(250_000, rek).run();

    const s = await saldoSatu('user-1', rek);
    expect(s.saldo).toBe(1_000_000);
    expect(s.selisih).toBe(-250_000);
  });
});
