/**
 * Uji rute tagihan terjadwal dan proyeksi saldo.
 *
 * Yang dijaga di sini adalah hal-hal yang tidak memunculkan galat, cuma angka
 * yang salah — dan pada modul uang, angka yang salah berarti keputusan yang
 * salah:
 *
 * 1. Tagihan TIDAK boleh menggeser saldo sebelum dinyatakan dibayar. Ini
 *    seluruh alasan tabelnya ada: saldo yang melaporkan uang sebagai sudah
 *    pergi padahal masih di rekening tidak bisa dipakai memutuskan apa pun.
 * 2. Satu periode hanya bisa dibayar sekali. Ketukan ganda di ponsel — jaringan
 *    lambat, tombol ditekan dua kali — tidak boleh mencatat dua kali.
 * 3. Checksum saldo tetap nol sesudah bayar DAN sesudah batal bayar.
 * 4. Proyeksi harus menyertakan autodebet. Melupakannya memperkirakan saldo
 *    lebih besar daripada kenyataan, arah yang paling berbahaya untuk salah.
 * 5. Arah tanda utang versus piutang di proyeksi.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import tagihanRoute from './finance_tagihan';
import proyeksiRoute from './finance_proyeksi';
import budgetRoute from './budget';
import { signJWT } from '../lib/jwt';
import { createTestDb, seedUser, type FakeD1 } from '../test/d1';
import { saldoSemuaRekening, totalSaldo, semaiSaldoAwal } from '../lib/finance_saldo';
import { petaAlias, kunciAlias } from '../lib/finance_kategori';
import { jakartaToday } from '../lib/validate';
import { shiftDate } from '../lib/daily';

const JWT_SECRET = 'rahasia-untuk-test';

let db: FakeD1;
let app: Hono<never>;
let token: string;
let tokenLain: string;

function env() {
  return { DB: db, JWT_SECRET } as unknown as Record<string, unknown>;
}

async function mint(sub: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return signJWT({ sub, name: 'Penguji', role: 'user', iat: now, exp: now + 3600 }, JWT_SECRET);
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

beforeEach(async () => {
  db = createTestDb();
  seedUser(db, 'user-1');
  seedUser(db, 'user-2');
  token = await mint('user-1');
  tokenLain = await mint('user-2');

  app = new Hono() as Hono<never>;
  app.route('/api/tagihan', tagihanRoute as never);
  app.route('/api/proyeksi', proyeksiRoute as never);
  app.route('/api/budget', budgetRoute as never);
});

afterEach(() => db.__close());

const D = () => db as never;

async function buatRekening(id: string, saldo: number, userId = 'user-1') {
  await db.prepare(
    `INSERT INTO bank_accounts (id, user_id, name, account_type, balance)
     VALUES (?1, ?2, 'BCA', 'Bank', ?3)`
  ).bind(id, userId, saldo).run();
  await semaiSaldoAwal(D(), userId);
}

async function saldo(userId = 'user-1') {
  return saldoSemuaRekening(D(), userId);
}

async function selisihTerbesar(userId = 'user-1') {
  return Math.max(...(await saldo(userId)).map((r) => Math.abs(r.selisih)), 0);
}

interface DibuatTagihan { id: string }

async function buatTagihan(isi: Record<string, unknown>, bearer = token) {
  const res = await req('/api/tagihan', { method: 'POST', body: JSON.stringify(isi) }, bearer);
  return { res, body: await res.json() as DibuatTagihan };
}

describe('POST /api/tagihan', () => {
  it('membuat tagihan tanpa menggeser saldo sama sekali', async () => {
    await buatRekening('rek-1', 1_000_000);
    const sebelum = totalSaldo(await saldo());

    const { res } = await buatTagihan({
      nama: 'Listrik PLN', jumlah: 300_000, jatuh_tempo: '2026-10-05',
      ulang: 'monthly', kategori: 'Tagihan & Utilitas', bank_account_id: 'rek-1',
    });
    expect(res.status).toBe(201);

    // Seluruh alasan tabel ini ada. Tagihan yang sudah menggeser saldo saat
    // dibuat akan melaporkan uang sebagai pergi padahal masih di rekening.
    expect(totalSaldo(await saldo())).toBe(sebelum);
    expect(await selisihTerbesar()).toBe(0);
  });

  it('menyimpan hari asal dari tanggalnya', async () => {
    await buatTagihan({
      nama: 'Cicilan', jumlah: 500_000, jatuh_tempo: '2026-01-31', ulang: 'monthly',
    });
    const row = await db.prepare('SELECT hari_anchor FROM finance_tagihan')
      .first<{ hari_anchor: number }>();
    expect(row!.hari_anchor).toBe(31);
  });

  it('memetakan kategorinya ke id', async () => {
    await buatTagihan({
      nama: 'Iuran RT', jumlah: 50_000, jatuh_tempo: '2026-10-05', kategori: 'Iuran RT',
    });
    const peta = await petaAlias(D(), 'user-1');
    expect(peta.get(kunciAlias('expense', 'Iuran RT'))).toBeTruthy();
  });

  it('menolak tanggal yang bukan tanggal', async () => {
    const { res } = await buatTagihan({ nama: 'X', jumlah: 1000, jatuh_tempo: 'besok' });
    expect(res.status).toBe(400);
  });

  it('menolak rekening milik orang lain, dengan 404', async () => {
    await buatRekening('asing', 5_000_000, 'user-2');
    const { res } = await buatTagihan({
      nama: 'X', jumlah: 1000, jatuh_tempo: '2026-10-05', bank_account_id: 'asing',
    });
    // 404, bukan 403: membedakan keduanya memberi tahu bahwa id itu ada.
    expect(res.status).toBe(404);
  });
});

describe('POST /api/tagihan/:id/bayar', () => {
  it('mencatat transaksinya, menggeser saldo, dan checksum tetap nol', async () => {
    await buatRekening('rek-1', 1_000_000);
    const { body } = await buatTagihan({
      nama: 'Listrik', jumlah: 300_000, jatuh_tempo: '2026-10-05',
      ulang: 'monthly', kategori: 'Tagihan & Utilitas', bank_account_id: 'rek-1',
    });

    const res = await req(`/api/tagihan/${body.id}/bayar`, {
      method: 'POST', body: JSON.stringify({ dibayar_pada: '2026-10-05' }),
    });
    expect(res.status).toBe(201);

    const sesudah = await saldo();
    expect(sesudah[0].saldo).toBe(700_000);
    expect(await selisihTerbesar()).toBe(0);
  });

  it('memajukan jatuh tempo ke periode berikutnya', async () => {
    const { body } = await buatTagihan({
      nama: 'Listrik', jumlah: 300_000, jatuh_tempo: '2026-01-31', ulang: 'monthly',
    });
    await req(`/api/tagihan/${body.id}/bayar`, { method: 'POST', body: '{}' });

    const row = await db.prepare('SELECT jatuh_tempo FROM finance_tagihan WHERE id = ?1')
      .bind(body.id).first<{ jatuh_tempo: string }>();
    expect(row!.jatuh_tempo).toBe('2026-02-28');
  });

  it('tagihan tanggal 31 kembali ke 31, tidak hanyut ke 28', async () => {
    // Dua pembayaran berturut-turut. Kalau hari asalnya tidak tersimpan,
    // Maret akan jadi 28 dan tagihannya pindah tanggal selamanya.
    const { body } = await buatTagihan({
      nama: 'Cicilan', jumlah: 100_000, jatuh_tempo: '2026-01-31', ulang: 'monthly',
    });
    await req(`/api/tagihan/${body.id}/bayar`, { method: 'POST', body: '{}' });
    await req(`/api/tagihan/${body.id}/bayar`, { method: 'POST', body: '{}' });

    const row = await db.prepare('SELECT jatuh_tempo FROM finance_tagihan WHERE id = ?1')
      .bind(body.id).first<{ jatuh_tempo: string }>();
    expect(row!.jatuh_tempo).toBe('2026-03-31');
  });

  it('periode yang sama tidak bisa dibayar dua kali', async () => {
    await buatRekening('rek-1', 1_000_000);
    // Tagihan sekali: jatuh temponya tidak maju, jadi ketukan kedua benar-benar
    // menyasar periode yang sama — persis skenario tombol tertekan dua kali.
    const { body } = await buatTagihan({
      nama: 'STNK', jumlah: 250_000, jatuh_tempo: '2026-10-05', bank_account_id: 'rek-1',
    });

    const satu = await req(`/api/tagihan/${body.id}/bayar`, { method: 'POST', body: '{}' });
    const dua = await req(`/api/tagihan/${body.id}/bayar`, { method: 'POST', body: '{}' });

    expect(satu.status).toBe(201);
    expect(dua.status).toBe(409);

    // Yang terpenting: uangnya keluar SEKALI.
    expect((await saldo())[0].saldo).toBe(750_000);
    const n = await db.prepare('SELECT COUNT(*) AS n FROM budget_entries').first<{ n: number }>();
    expect(n!.n).toBe(1);
  });

  it('nominal yang benar-benar dibayar boleh berbeda dari perkiraan', async () => {
    await buatRekening('rek-1', 1_000_000);
    const { body } = await buatTagihan({
      nama: 'Listrik', jumlah: 300_000, jatuh_tempo: '2026-10-05', bank_account_id: 'rek-1',
    });

    // Tagihan listrik jarang sama tiap bulan; yang dicatat harus yang dibayar.
    await req(`/api/tagihan/${body.id}/bayar`, {
      method: 'POST', body: JSON.stringify({ jumlah: 345_000 }),
    });

    expect((await saldo())[0].saldo).toBe(655_000);
    expect(await selisihTerbesar()).toBe(0);
  });

  it('tagihan masuk menambah saldo, bukan menguranginya', async () => {
    await buatRekening('rek-1', 1_000_000);
    const { body } = await buatTagihan({
      nama: 'Gaji', jumlah: 5_000_000, jatuh_tempo: '2026-10-25',
      jenis: 'income', kategori: 'Gaji', bank_account_id: 'rek-1',
    });
    await req(`/api/tagihan/${body.id}/bayar`, { method: 'POST', body: '{}' });

    expect((await saldo())[0].saldo).toBe(6_000_000);
    expect(await selisihTerbesar()).toBe(0);
  });

  it('tagihan sekali dinonaktifkan setelah dibayar', async () => {
    const { body } = await buatTagihan({ nama: 'STNK', jumlah: 250_000, jatuh_tempo: '2026-10-05' });
    await req(`/api/tagihan/${body.id}/bayar`, { method: 'POST', body: '{}' });

    const row = await db.prepare('SELECT aktif FROM finance_tagihan WHERE id = ?1')
      .bind(body.id).first<{ aktif: number }>();
    expect(row!.aktif).toBe(0);
  });

  it('tanpa rekening, transaksinya tetap tercatat tanpa menyentuh saldo', async () => {
    await buatRekening('rek-1', 1_000_000);
    const { body } = await buatTagihan({ nama: 'Tunai', jumlah: 50_000, jatuh_tempo: '2026-10-05' });
    await req(`/api/tagihan/${body.id}/bayar`, { method: 'POST', body: '{}' });

    expect(totalSaldo(await saldo())).toBe(1_000_000);
    const n = await db.prepare('SELECT COUNT(*) AS n FROM budget_entries').first<{ n: number }>();
    expect(n!.n).toBe(1);
  });

  it('tagihan orang lain tidak bisa dibayar', async () => {
    const { body } = await buatTagihan(
      { nama: 'Punya orang', jumlah: 1000, jatuh_tempo: '2026-10-05' }, tokenLain
    );
    const res = await req(`/api/tagihan/${body.id}/bayar`, { method: 'POST', body: '{}' });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/tagihan/:id/bayar', () => {
  it('mengembalikan saldo dan menghapus transaksinya, checksum tetap nol', async () => {
    await buatRekening('rek-1', 1_000_000);
    const { body } = await buatTagihan({
      nama: 'Listrik', jumlah: 300_000, jatuh_tempo: '2026-10-05',
      ulang: 'monthly', bank_account_id: 'rek-1',
    });
    await req(`/api/tagihan/${body.id}/bayar`, { method: 'POST', body: '{}' });

    const res = await req(`/api/tagihan/${body.id}/bayar`, { method: 'DELETE' });
    expect(res.status).toBe(200);

    expect((await saldo())[0].saldo).toBe(1_000_000);
    expect(await selisihTerbesar()).toBe(0);
    const n = await db.prepare('SELECT COUNT(*) AS n FROM budget_entries').first<{ n: number }>();
    expect(n!.n).toBe(0);
  });

  it('memulangkan jatuh tempo ke periode yang dibatalkan', async () => {
    const { body } = await buatTagihan({
      nama: 'Listrik', jumlah: 300_000, jatuh_tempo: '2026-10-05', ulang: 'monthly',
    });
    await req(`/api/tagihan/${body.id}/bayar`, { method: 'POST', body: '{}' });
    await req(`/api/tagihan/${body.id}/bayar`, { method: 'DELETE' });

    const row = await db.prepare('SELECT jatuh_tempo, aktif FROM finance_tagihan WHERE id = ?1')
      .bind(body.id).first<{ jatuh_tempo: string; aktif: number }>();
    expect(row!.jatuh_tempo).toBe('2026-10-05');
    expect(row!.aktif).toBe(1);
  });

  it('membatalkan nominal yang sebenarnya dibayar, bukan perkiraannya', async () => {
    await buatRekening('rek-1', 1_000_000);
    const { body } = await buatTagihan({
      nama: 'Listrik', jumlah: 300_000, jatuh_tempo: '2026-10-05', bank_account_id: 'rek-1',
    });
    await req(`/api/tagihan/${body.id}/bayar`, {
      method: 'POST', body: JSON.stringify({ jumlah: 345_000 }),
    });
    await req(`/api/tagihan/${body.id}/bayar`, { method: 'DELETE' });

    // Memulangkan perkiraan 300rb alih-alih 345rb yang benar-benar dibayar
    // akan meninggalkan 45rb hilang tanpa jejak, dan checksum-nya yang
    // menangkapnya.
    //
    // Yang dijaga uji ini adalah pemulangan dari PERKIRAAN tagihan. Ia tidak
    // bisa membedakan `budget_entries.amount_idr` dari
    // `finance_tagihan_bayar.jumlah_idr` — keduanya menyimpan nominal yang sama
    // — jadi menukar kedua sumber itu tetap lolos di sini. Itu memang bukan
    // cacat; yang cacat adalah memakai `finance_tagihan.jumlah_idr`.
    expect((await saldo())[0].saldo).toBe(1_000_000);
    expect(await selisihTerbesar()).toBe(0);
  });

  it('menolak saat belum ada pembayaran', async () => {
    const { body } = await buatTagihan({ nama: 'X', jumlah: 1000, jatuh_tempo: '2026-10-05' });
    const res = await req(`/api/tagihan/${body.id}/bayar`, { method: 'DELETE' });
    expect(res.status).toBe(404);
  });
});

describe('PUT /api/tagihan/:id', () => {
  it('mengubah nominal tanpa memindahkan hari asalnya', async () => {
    // Bug yang mudah terjadi: menghitung ulang hari asal dari `jatuh_tempo`
    // yang tidak disentuh akan mengunci tagihan tanggal 31 pada 28 hanya
    // karena pengguna mengganti nominalnya.
    const { body } = await buatTagihan({
      nama: 'Cicilan', jumlah: 100_000, jatuh_tempo: '2026-01-31', ulang: 'monthly',
    });
    await req(`/api/tagihan/${body.id}/bayar`, { method: 'POST', body: '{}' });
    // jatuh_tempo sekarang 2026-02-28
    await req(`/api/tagihan/${body.id}`, {
      method: 'PUT', body: JSON.stringify({ jumlah: 150_000 }),
    });

    const row = await db.prepare('SELECT hari_anchor FROM finance_tagihan WHERE id = ?1')
      .bind(body.id).first<{ hari_anchor: number }>();
    expect(row!.hari_anchor).toBe(31);
  });

  it('memperbarui hari asal saat tanggalnya yang diubah', async () => {
    const { body } = await buatTagihan({
      nama: 'Cicilan', jumlah: 100_000, jatuh_tempo: '2026-01-31', ulang: 'monthly',
    });
    await req(`/api/tagihan/${body.id}`, {
      method: 'PUT', body: JSON.stringify({ jatuh_tempo: '2026-02-10' }),
    });

    const row = await db.prepare('SELECT hari_anchor FROM finance_tagihan WHERE id = ?1')
      .bind(body.id).first<{ hari_anchor: number }>();
    expect(row!.hari_anchor).toBe(10);
  });

  it('tagihan orang lain tidak bisa diubah', async () => {
    const { body } = await buatTagihan({ nama: 'X', jumlah: 1000, jatuh_tempo: '2026-10-05' }, tokenLain);
    const res = await req(`/api/tagihan/${body.id}`, {
      method: 'PUT', body: JSON.stringify({ jumlah: 9_999_999 }),
    });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/tagihan/:id', () => {
  it('tidak menghapus transaksi yang sudah benar-benar terjadi', async () => {
    await buatRekening('rek-1', 1_000_000);
    const { body } = await buatTagihan({
      nama: 'Listrik', jumlah: 300_000, jatuh_tempo: '2026-10-05', bank_account_id: 'rek-1',
    });
    await req(`/api/tagihan/${body.id}/bayar`, { method: 'POST', body: '{}' });

    await req(`/api/tagihan/${body.id}`, { method: 'DELETE' });

    // Pembayarannya sungguh terjadi; menghapusnya akan mengubah saldo yang
    // sudah benar.
    const n = await db.prepare('SELECT COUNT(*) AS n FROM budget_entries').first<{ n: number }>();
    expect(n!.n).toBe(1);
    expect((await saldo())[0].saldo).toBe(700_000);
    expect(await selisihTerbesar()).toBe(0);
  });

  it('tagihan orang lain tidak bisa dihapus', async () => {
    const { body } = await buatTagihan({ nama: 'X', jumlah: 1000, jatuh_tempo: '2026-10-05' }, tokenLain);
    expect((await req(`/api/tagihan/${body.id}`, { method: 'DELETE' })).status).toBe(404);
  });
});

describe('GET /api/tagihan', () => {
  it('menghitung sisa hari, negatif berarti telat', async () => {
    const today = jakartaToday();
    await buatTagihan({ nama: 'Telat', jumlah: 1000, jatuh_tempo: shiftDate(today, -5) });
    await buatTagihan({ nama: 'Nanti', jumlah: 1000, jatuh_tempo: shiftDate(today, 7) });

    const list = await (await req('/api/tagihan')).json() as {
      tagihan: Array<{ nama: string; sisaHari: number }>;
    };
    expect(list.tagihan.find((t) => t.nama === 'Telat')!.sisaHari).toBe(-5);
    expect(list.tagihan.find((t) => t.nama === 'Nanti')!.sisaHari).toBe(7);
  });

  it('tidak membocorkan tagihan pengguna lain', async () => {
    await buatTagihan({ nama: 'Punya orang', jumlah: 1000, jatuh_tempo: '2026-10-05' }, tokenLain);
    const list = await (await req('/api/tagihan')).json() as { tagihan: unknown[] };
    expect(list.tagihan).toEqual([]);
  });
});

interface HasilProyeksi {
  saldoAwal: number;
  saldoAkhir: number;
  tanggalMinus: string | null;
  totalKeluar: number;
  totalMasuk: number;
  baris: Array<{ tanggal: string; label: string; jumlah: number; sumber: string }>;
}

describe('GET /api/proyeksi', () => {
  it('menjalankan saldo melewati tagihan yang akan datang', async () => {
    const today = jakartaToday();
    await buatRekening('rek-1', 1_000_000);
    await buatTagihan({
      nama: 'Listrik', jumlah: 300_000, jatuh_tempo: shiftDate(today, 5), bank_account_id: 'rek-1',
    });

    const p = await (await req('/api/proyeksi?days=30')).json() as HasilProyeksi;
    expect(p.saldoAwal).toBe(1_000_000);
    expect(p.saldoAkhir).toBe(700_000);
    expect(p.totalKeluar).toBe(300_000);
  });

  it('memperingatkan hari minus meski saldo akhirnya positif', async () => {
    const today = jakartaToday();
    await buatRekening('rek-1', 200_000);
    await buatTagihan({ nama: 'Listrik', jumlah: 500_000, jatuh_tempo: shiftDate(today, 5) });
    await buatTagihan({
      nama: 'Gaji', jumlah: 5_000_000, jatuh_tempo: shiftDate(today, 20), jenis: 'income',
    });

    const p = await (await req('/api/proyeksi?days=30')).json() as HasilProyeksi;
    expect(p.tanggalMinus).toBe(shiftDate(today, 5));
    expect(p.saldoAkhir).toBe(4_700_000);
  });

  it('menyertakan autodebet, bukan cuma tagihan manual', async () => {
    // Yang paling mudah terlupakan. Autodebet akan benar-benar menggeser saldo,
    // jadi mengabaikannya memperkirakan saldo lebih besar dari kenyataan.
    const today = jakartaToday();
    await buatRekening('rek-1', 1_000_000);
    await req('/api/budget', {
      method: 'POST',
      body: JSON.stringify({
        type: 'expense', amount: 150_000, category: 'Tagihan & Utilitas',
        note: 'Internet', date: today, recurrence: 'monthly',
      }),
    });

    const p = await (await req('/api/proyeksi?days=40')).json() as HasilProyeksi;
    const dariBerulang = p.baris.filter((b) => b.sumber === 'berulang');
    expect(dariBerulang.length).toBeGreaterThan(0);
    expect(dariBerulang[0].label).toBe('Internet');
  });

  it('utang mengurangi dan piutang menambah', async () => {
    const today = jakartaToday();
    await buatRekening('rek-1', 1_000_000);
    await db.prepare(
      `INSERT INTO debts (id, user_id, type, person_name, amount_idr, due_date, status)
       VALUES ('d1', ?1, 'debt', 'Pak Budi', 400000, ?2, 'unpaid'),
              ('d2', ?1, 'receivable', 'Bu Sri', 100000, ?2, 'unpaid')`
    ).bind('user-1', shiftDate(today, 3)).run();

    const p = await (await req('/api/proyeksi?days=30')).json() as HasilProyeksi;
    expect(p.totalKeluar).toBe(400_000);
    expect(p.totalMasuk).toBe(100_000);
    expect(p.saldoAkhir).toBe(700_000);
  });

  it('tidak menghitung tagihan yang sudah dibayar', async () => {
    const today = jakartaToday();
    await buatRekening('rek-1', 1_000_000);
    const { body } = await buatTagihan({
      nama: 'STNK', jumlah: 250_000, jatuh_tempo: shiftDate(today, 5), bank_account_id: 'rek-1',
    });
    await req(`/api/tagihan/${body.id}/bayar`, { method: 'POST', body: '{}' });

    const p = await (await req('/api/proyeksi?days=30')).json() as HasilProyeksi;
    // Sudah keluar dari saldo awal; menghitungnya lagi akan mengurangi dua kali.
    expect(p.saldoAwal).toBe(750_000);
    expect(p.saldoAkhir).toBe(750_000);
  });

  it('mengabaikan tagihan yang tidak aktif', async () => {
    const today = jakartaToday();
    await buatRekening('rek-1', 1_000_000);
    const { body } = await buatTagihan({
      nama: 'Dimatikan', jumlah: 300_000, jatuh_tempo: shiftDate(today, 5),
    });
    await req(`/api/tagihan/${body.id}`, { method: 'PUT', body: JSON.stringify({ aktif: false }) });

    const p = await (await req('/api/proyeksi?days=30')).json() as HasilProyeksi;
    expect(p.saldoAkhir).toBe(1_000_000);
  });

  it('tidak mencampur tagihan pengguna lain ke dalam proyeksi', async () => {
    const today = jakartaToday();
    await buatRekening('rek-1', 1_000_000);
    await buatTagihan(
      { nama: 'Punya orang', jumlah: 900_000, jatuh_tempo: shiftDate(today, 2) }, tokenLain
    );

    const p = await (await req('/api/proyeksi?days=30')).json() as HasilProyeksi;
    expect(p.saldoAkhir).toBe(1_000_000);
  });

  it('menjepit horizon yang diminta terlalu panjang', async () => {
    await buatRekening('rek-1', 1_000_000);
    const p = await (await req('/api/proyeksi?days=99999')).json() as HasilProyeksi & { hari: number };
    expect(p.hari).toBe(365);
  });
});
