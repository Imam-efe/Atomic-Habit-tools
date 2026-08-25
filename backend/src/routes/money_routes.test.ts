/**
 * Uji rute uang: utang, piutang, kekayaan bersih, dan zakat.
 *
 * Semuanya berangkat dari satu tabel yang menyimpan dua hal berlawanan.
 * `debts` memuat utang (`type = 'debt'`, kita berutang) dan piutang
 * (`type = 'receivable'`, orang berutang ke kita) dalam baris yang sama
 * bentuknya, dibedakan hanya oleh satu kolom. Setiap kueri yang lupa
 * membaca kolom itu tetap jalan, tetap mengembalikan angka, dan angkanya
 * salah arah — tidak ada error yang muncul, hanya laporan yang keliru.
 *
 * Karena itu yang diuji di sini terutama TANDA: piutang menambah kekayaan,
 * bukan menguranginya; menerima pelunasan piutang menaikkan saldo, bukan
 * menurunkannya.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import debtsRoute from './debts';
import netWorthRoute from './net_worth';
import financeReport from './finance_report';
import ibadah from './ibadah';
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

async function mint(sub: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return signJWT({ sub, name: 'Penguji', role: 'user', iat: now, exp: now + 3600 }, JWT_SECRET);
}

async function req(path: string, init: RequestInit = {}): Promise<Response> {
  return app.request(
    `http://test${path}`,
    { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) } },
    makeEnv()
  );
}

/** Panggil lalu baca badannya sebagai bentuk yang diharapkan. */
async function json<T>(path: string, init: RequestInit = {}): Promise<T> {
  return (await req(path, init)).json() as Promise<T>;
}

beforeEach(async () => {
  db = createTestDb();
  seedUser(db, 'user-1');
  token = await mint('user-1');

  app = new Hono() as Hono<never>;
  app.route('/api/debts', debtsRoute as never);
  app.route('/api/net-worth', netWorthRoute as never);
  app.route('/api/finance-report', financeReport as never);
  app.route('/api/ibadah', ibadah as never);
});

afterEach(() => db.__close());

function seedBank(id: string, balance: number) {
  db.prepare(
    `INSERT INTO bank_accounts (id, user_id, name, account_type, balance)
     VALUES (?1, 'user-1', 'Rekening', 'Bank', ?2)`
  ).bind(id, balance).run();
  return id;
}

function seedDebt(
  id: string,
  type: 'debt' | 'receivable',
  amount: number,
  over: { due_date?: string | null; note?: string | null; status?: string } = {}
) {
  db.prepare(
    `INSERT INTO debts (id, user_id, type, person_name, amount_idr, due_date, note, status)
     VALUES (?1, 'user-1', ?2, 'Budi', ?3, ?4, ?5, ?6)`
  ).bind(
    id, type, amount,
    over.due_date ?? '2026-12-31',
    over.note ?? 'catatan asli',
    over.status ?? 'unpaid'
  ).run();
  return id;
}

async function saldo(id: string): Promise<number> {
  const row = await db.prepare('SELECT balance FROM bank_accounts WHERE id = ?1').bind(id)
    .first<{ balance: number }>();
  return row?.balance ?? -1;
}

describe('kekayaan bersih', () => {
  it('tidak menghitung piutang sebagai kewajiban', async () => {
    // Meminjamkan uang tidak membuat seseorang berutang. Kalau piutang ikut
    // dijumlahkan sebagai kewajiban, meminjamkan 5 juta menurunkan kekayaan
    // bersih 5 juta — dan layar Laporan Keuangan akan menampilkan angka lain
    // untuk orang yang sama.
    seedBank('bank-1', 10_000_000);
    seedDebt('d-1', 'receivable', 5_000_000);

    const res = await req('/api/net-worth');
    const body = await res.json() as { current: { assets: number; liabilities: number; net_worth: number } };

    expect(body.current.liabilities).toBe(0);
    expect(body.current.net_worth).toBe(15_000_000);
  });

  it('menghitung utang sebagai kewajiban', async () => {
    seedBank('bank-1', 10_000_000);
    seedDebt('d-1', 'debt', 4_000_000);

    const res = await req('/api/net-worth');
    const body = await res.json() as { current: { liabilities: number; net_worth: number } };

    expect(body.current.liabilities).toBe(4_000_000);
    expect(body.current.net_worth).toBe(6_000_000);
  });

  it('sepakat dengan Laporan Keuangan untuk data yang sama', async () => {
    // Dua layar yang menghitung hal yang sama dari tabel yang sama tidak
    // boleh berselisih; kalau berselisih, salah satunya pasti salah dan
    // pengguna tidak punya cara menebak yang mana.
    seedBank('bank-1', 10_000_000);
    seedDebt('d-1', 'receivable', 5_000_000);
    seedDebt('d-2', 'debt', 3_000_000);

    const [nw, fr] = await Promise.all([
      json<{ current: { net_worth: number } }>('/api/net-worth'),
      json<{ balance_sheet: { net_worth: number } }>('/api/finance-report'),
    ]);

    expect(nw.current.net_worth).toBe(fr.balance_sheet.net_worth);
  });

  it('mengabaikan utang yang sudah lunas', async () => {
    seedBank('bank-1', 1_000_000);
    seedDebt('d-1', 'debt', 900_000, { status: 'paid' });

    const res = await req('/api/net-worth');
    const body = await res.json() as { current: { liabilities: number } };
    expect(body.current.liabilities).toBe(0);
  });
});

describe('pembayaran utang dan piutang', () => {
  it('membayar utang mengurangi saldo dan tercatat sebagai pengeluaran', async () => {
    seedBank('bank-1', 10_000_000);
    seedDebt('d-1', 'debt', 2_000_000);

    const res = await req('/api/debts/d-1/payments', {
      method: 'POST',
      body: JSON.stringify({
        amount: 2_000_000, payment_date: '2026-08-25',
        status: 'paid', bank_account_id: 'bank-1',
      }),
    });
    expect(res.status).toBe(201);

    expect(await saldo('bank-1')).toBe(8_000_000);
    const entry = await db.prepare('SELECT type, category FROM budget_entries WHERE user_id = ?1')
      .bind('user-1').first<{ type: string; category: string }>();
    expect(entry?.type).toBe('expense');
  });

  it('menerima pelunasan piutang menambah saldo dan tercatat sebagai pemasukan', async () => {
    // Uang yang kembali dari orang yang kita pinjami adalah uang masuk.
    // Mencatatnya sebagai pengeluaran memotong saldo dua kali: sekali saat
    // meminjamkan, sekali lagi saat menerima kembali.
    seedBank('bank-1', 1_000_000);
    seedDebt('d-1', 'receivable', 5_000_000);

    const res = await req('/api/debts/d-1/payments', {
      method: 'POST',
      body: JSON.stringify({
        amount: 5_000_000, payment_date: '2026-08-25',
        status: 'paid', bank_account_id: 'bank-1',
      }),
    });
    expect(res.status).toBe(201);

    expect(await saldo('bank-1')).toBe(6_000_000);
    const entry = await db.prepare('SELECT type FROM budget_entries WHERE user_id = ?1')
      .bind('user-1').first<{ type: string }>();
    expect(entry?.type).toBe('income');
  });

  it('menerima piutang tidak dihalangi saldo yang kecil', async () => {
    // Saldo cuma cukup untuk mengeluarkan uang, bukan untuk menerimanya.
    seedBank('bank-1', 0);
    seedDebt('d-1', 'receivable', 5_000_000);

    const res = await req('/api/debts/d-1/payments', {
      method: 'POST',
      body: JSON.stringify({
        amount: 5_000_000, payment_date: '2026-08-25',
        status: 'paid', bank_account_id: 'bank-1',
      }),
    });
    expect(res.status).toBe(201);
    expect(await saldo('bank-1')).toBe(5_000_000);
  });

  it('menolak membayar utang melebihi saldo', async () => {
    seedBank('bank-1', 100_000);
    seedDebt('d-1', 'debt', 5_000_000);

    const res = await req('/api/debts/d-1/payments', {
      method: 'POST',
      body: JSON.stringify({
        amount: 5_000_000, payment_date: '2026-08-25',
        status: 'paid', bank_account_id: 'bank-1',
      }),
    });
    expect(res.status).toBe(400);
    expect(await saldo('bank-1')).toBe(100_000);
  });

  it('membatalkan pembayaran mengembalikan saldo ke keadaan semula', async () => {
    seedBank('bank-1', 10_000_000);
    seedDebt('d-1', 'debt', 2_000_000);

    const dibuat = await json<{ id: string }>('/api/debts/d-1/payments', {
      method: 'POST',
      body: JSON.stringify({
        amount: 2_000_000, payment_date: '2026-08-25',
        status: 'paid', bank_account_id: 'bank-1',
      }),
    });

    await req(`/api/debts/d-1/payments/${dibuat.id}`, { method: 'DELETE' });
    expect(await saldo('bank-1')).toBe(10_000_000);
  });

  it('membatalkan pelunasan piutang menarik kembali uang yang masuk', async () => {
    seedBank('bank-1', 1_000_000);
    seedDebt('d-1', 'receivable', 5_000_000);

    const dibuat = await json<{ id: string }>('/api/debts/d-1/payments', {
      method: 'POST',
      body: JSON.stringify({
        amount: 5_000_000, payment_date: '2026-08-25',
        status: 'paid', bank_account_id: 'bank-1',
      }),
    });

    await req(`/api/debts/d-1/payments/${dibuat.id}`, { method: 'DELETE' });
    expect(await saldo('bank-1')).toBe(1_000_000);
  });
});

describe('memperbarui catatan utang', () => {
  it('menandai lunas tanpa menghapus tanggal jatuh tempo dan catatan', async () => {
    // Layar Pelunasan Utang mengirim hanya status, nama, dan jumlah. Kalau
    // rute ini memaksakan nilai bawaan untuk kolom yang tidak dikirim,
    // melunasi utang ikut menghapus tanggal dan catatannya.
    seedDebt('d-1', 'debt', 2_000_000, { due_date: '2026-10-01', note: 'pinjaman motor' });

    const res = await req('/api/debts/d-1', {
      method: 'PUT',
      body: JSON.stringify({ status: 'paid', person_name: 'Budi', amount: 2_000_000 }),
    });
    expect(res.status).toBe(200);

    const row = await db.prepare('SELECT status, due_date, note, type FROM debts WHERE id = ?1')
      .bind('d-1').first<{ status: string; due_date: string; note: string; type: string }>();

    expect(row?.status).toBe('paid');
    expect(row?.due_date).toBe('2026-10-01');
    expect(row?.note).toBe('pinjaman motor');
  });

  it('tidak mengubah piutang jadi utang saat kolomnya tidak dikirim', async () => {
    seedDebt('d-1', 'receivable', 3_000_000);

    await req('/api/debts/d-1', {
      method: 'PUT',
      body: JSON.stringify({ status: 'paid', person_name: 'Budi', amount: 3_000_000 }),
    });

    const row = await db.prepare('SELECT type FROM debts WHERE id = ?1').bind('d-1')
      .first<{ type: string }>();
    expect(row?.type).toBe('receivable');
  });

  it('tetap bisa mengubah kolom yang memang dikirim', async () => {
    seedDebt('d-1', 'debt', 2_000_000, { note: 'lama' });

    await req('/api/debts/d-1', {
      method: 'PUT',
      body: JSON.stringify({ person_name: 'Budi', amount: 2_500_000, note: 'baru', due_date: '2027-01-01' }),
    });

    const row = await db.prepare('SELECT amount_idr, note, due_date FROM debts WHERE id = ?1')
      .bind('d-1').first<{ amount_idr: number; note: string; due_date: string }>();

    expect(row?.amount_idr).toBe(2_500_000);
    expect(row?.note).toBe('baru');
    expect(row?.due_date).toBe('2027-01-01');
  });

  it('bisa mengosongkan catatan dengan mengirim null', async () => {
    seedDebt('d-1', 'debt', 2_000_000, { note: 'lama' });

    await req('/api/debts/d-1', {
      method: 'PUT',
      body: JSON.stringify({ person_name: 'Budi', amount: 2_000_000, note: null }),
    });

    const row = await db.prepare('SELECT note FROM debts WHERE id = ?1').bind('d-1')
      .first<{ note: string | null }>();
    expect(row?.note).toBeNull();
  });
});

describe('zakat', () => {
  const hariIni = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);

  async function aturHarga(harga: number) {
    await req('/api/ibadah/zakat', {
      method: 'PUT',
      body: JSON.stringify({ hargaPerGram: harga }),
    });
  }

  it('menghitung harta bersih dari kas ditambah piutang', async () => {
    // Piutang adalah harta yang diharapkan kembali, jadi ia masuk hitungan
    // zakat — bukan dikurangkan darinya.
    seedBank('bank-1', 100_000_000);
    seedDebt('d-1', 'receivable', 20_000_000);
    await aturHarga(1_000_000); // nisab emas = 85 juta

    const body = await req('/api/ibadah/zakat').then((r) => r.json() as Promise<{
      maal: { hartaBersih: number; wajib: boolean; zakat: number };
    }>);

    expect(body.maal.hartaBersih).toBe(120_000_000);
    expect(body.maal.wajib).toBe(true);
    expect(body.maal.zakat).toBe(Math.ceil(120_000_000 * 0.025));
  });

  it('hanya mengurangkan utang yang jatuh tempo dalam satu haul', async () => {
    // Kalau seluruh sisa KPR dua puluh tahun dikurangkan, hampir tidak ada
    // orang berumah yang pernah wajib zakat — dan itu bukan yang dimaksud.
    const tahunDepan = new Date(Date.parse(`${hariIni}T00:00:00Z`) + 800 * 86400000)
      .toISOString().slice(0, 10);

    seedBank('bank-1', 100_000_000);
    seedDebt('kpr', 'debt', 500_000_000, { due_date: tahunDepan });
    await aturHarga(1_000_000);

    const body = await req('/api/ibadah/zakat').then((r) => r.json() as Promise<{
      maal: { hartaBersih: number; wajib: boolean };
    }>);

    expect(body.maal.hartaBersih).toBe(100_000_000);
    expect(body.maal.wajib).toBe(true);
  });

  it('mengurangkan utang yang jatuh tempo sebentar lagi', async () => {
    const bulanDepan = new Date(Date.parse(`${hariIni}T00:00:00Z`) + 30 * 86400000)
      .toISOString().slice(0, 10);

    seedBank('bank-1', 100_000_000);
    seedDebt('d-1', 'debt', 30_000_000, { due_date: bulanDepan });
    await aturHarga(1_000_000);

    const body = await req('/api/ibadah/zakat').then((r) => r.json() as Promise<{
      maal: { hartaBersih: number };
    }>);

    expect(body.maal.hartaBersih).toBe(70_000_000);
  });

  it('mengurangkan utang tanpa tanggal jatuh tempo', async () => {
    // Utang tanpa tanggal adalah utang yang bisa ditagih kapan saja.
    seedBank('bank-1', 100_000_000);
    seedDebt('d-1', 'debt', 10_000_000, { due_date: null });
    await aturHarga(1_000_000);

    const body = await req('/api/ibadah/zakat').then((r) => r.json() as Promise<{
      maal: { hartaBersih: number };
    }>);

    expect(body.maal.hartaBersih).toBe(90_000_000);
  });

  it('mengabaikan utang yang sudah lunas', async () => {
    seedBank('bank-1', 100_000_000);
    seedDebt('d-1', 'debt', 10_000_000, { status: 'paid' });
    await aturHarga(1_000_000);

    const body = await req('/api/ibadah/zakat').then((r) => r.json() as Promise<{
      maal: { hartaBersih: number };
    }>);

    expect(body.maal.hartaBersih).toBe(100_000_000);
  });

  it('menyebut sumber tiap angka', async () => {
    seedBank('bank-1', 1_000_000);
    const body = await req('/api/ibadah/zakat').then((r) => r.json() as Promise<{
      sumber: { kas: string; piutang: string; utang: string; penghasilan: string };
    }>);

    for (const nilai of Object.values(body.sumber)) {
      expect(typeof nilai).toBe('string');
      expect(nilai.length).toBeGreaterThan(0);
    }
  });

  it('mengatakan apa adanya saat harga logam belum diisi', async () => {
    seedBank('bank-1', 100_000_000);
    const body = await req('/api/ibadah/zakat').then((r) => r.json() as Promise<{
      perluHargaLogam: boolean; maal: { wajib: boolean };
    }>);

    expect(body.perluHargaLogam).toBe(true);
    expect(body.maal.wajib).toBe(false);
  });
});

describe('catatan puasa', () => {
  it('menolak jenis puasa yang bukan jenis puasa', async () => {
    // `LABEL_PUASA[kind]` menemukan juga kunci bawaan Object seperti
    // 'constructor', dan nilainya lolos pemeriksaan "ada isinya".
    const res = await req('/api/ibadah/puasa', {
      method: 'POST',
      body: JSON.stringify({ date: '2026-08-24', kind: 'constructor' }),
    });
    expect(res.status).toBe(200);

    const row = await db.prepare('SELECT kind FROM fasting_log WHERE user_id = ?1')
      .bind('user-1').first<{ kind: string }>();
    expect(row?.kind).not.toBe('constructor');
  });

  it('menyimpan jenis puasa yang benar apa adanya', async () => {
    await req('/api/ibadah/puasa', {
      method: 'POST',
      body: JSON.stringify({ date: '2026-08-24', kind: 'senin-kamis' }),
    });

    const row = await db.prepare('SELECT kind FROM fasting_log WHERE user_id = ?1')
      .bind('user-1').first<{ kind: string }>();
    expect(row?.kind).toBe('senin-kamis');
  });
});
