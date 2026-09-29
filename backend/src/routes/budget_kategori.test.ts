/**
 * Uji rute kategori berid, dan pemetaan yang dilakukan jalur tulis.
 *
 * Yang dijaga di sini adalah kelengkapan pemetaannya. Ada lima jalur berbeda
 * yang menulis ke `budget_entries` — formulir, editnya, shortcut iOS, alat AI,
 * dan pembayaran hutang — dan satu saja yang lupa memetakan kategorinya sudah
 * cukup untuk membuat laporan berbasis id kehilangan sebagian pengeluaran,
 * tanpa galat apa pun. Tiap jalur diuji sendiri, bukan diwakili satu.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import budgetRoute from './budget';
import debtsRoute from './debts';
import shortcutRoute from './shortcut';
import { signJWT } from '../lib/jwt';
import { createTestDb, seedUser, type FakeD1 } from '../test/d1';
import { daftarKategori, petaAlias, kunciAlias } from '../lib/finance_kategori';
import { EXPENSE_CATEGORIES } from './budget';
import { TOOL_BY_NAME, type ToolContext } from '../lib/agent_tools';

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

interface Pohon {
  expense: Array<{ id: string; nama: string; emoji: string | null; bawaan: boolean; anak: Array<{ id: string; nama: string }> }>;
  income: Array<{ id: string; nama: string; emoji: string | null; bawaan: boolean; anak: Array<{ id: string; nama: string }> }>;
}

beforeEach(async () => {
  db = createTestDb();
  seedUser(db, 'user-1');
  seedUser(db, 'user-2');
  token = await mint('user-1');
  tokenLain = await mint('user-2');

  app = new Hono() as Hono<never>;
  app.route('/api/budget', budgetRoute as never);
  app.route('/api/debts', debtsRoute as never);
  app.route('/api/shortcut', shortcutRoute as never);
});

afterEach(() => db.__close());

const D = () => db as never;

async function idUntuk(jenis: 'income' | 'expense', teks: string): Promise<string | undefined> {
  return (await petaAlias(D(), 'user-1')).get(kunciAlias(jenis, teks));
}

describe('GET /api/budget/categories', () => {
  it('menyemai kategori bawaan pada panggilan pertama', async () => {
    expect(await daftarKategori(D(), 'user-1')).toEqual([]);

    const pohon = await (await req('/api/budget/categories')).json() as Pohon;

    expect(pohon.expense.map((k) => k.nama)).toEqual(EXPENSE_CATEGORIES);
    expect(pohon.income.length).toBeGreaterThan(0);
  });

  it('membawa subkategori bersarang di bawah induknya', async () => {
    const pohon = await (await req('/api/budget/categories')).json() as Pohon;

    const tagihan = pohon.expense.find((k) => k.nama === 'Tagihan & Utilitas')!;
    expect(tagihan.anak.map((a) => a.nama)).toContain('Listrik');
    expect(tagihan.emoji).toBe('🧾');

    // Subkategori tidak boleh ikut muncul sebagai kategori tingkat atas.
    expect(pohon.expense.map((k) => k.nama)).not.toContain('Listrik');
  });

  it('panggilan kedua tidak mengubah apa pun', async () => {
    const pertama = await (await req('/api/budget/categories')).json() as Pohon;
    const kedua = await (await req('/api/budget/categories')).json() as Pohon;
    expect(kedua).toEqual(pertama);
  });

  it('tidak membocorkan kategori pengguna lain', async () => {
    await req('/api/budget/categories');
    // Kategori milik orang lain dibuat lewat jalur pengguna itu sendiri,
    // lalu diminta sebagai pengguna pertama.
    await req('/api/budget', {
      method: 'POST',
      body: JSON.stringify({ type: 'expense', amount: 1000, category: 'Rahasia Orang Lain' }),
    }, tokenLain);

    const pohon = await (await req('/api/budget/categories')).json() as Pohon;
    expect(pohon.expense.map((k) => k.nama)).not.toContain('Rahasia Orang Lain');
  });

  it('menampilkan subkategori yang induknya sudah hilang sebagai tingkat atas', async () => {
    const pohon = await (await req('/api/budget/categories')).json() as Pohon;
    const listrik = pohon.expense.find((k) => k.nama === 'Tagihan & Utilitas')!
      .anak.find((a) => a.nama === 'Listrik')!;

    await db.prepare('UPDATE finance_category SET induk_id = NULL WHERE id = ?1')
      .bind(listrik.id).run();

    // Bukan hilang dari daftar: transaksinya masih menunjuk ke situ, dan
    // kategori yang tidak bisa dipilih lagi berarti uangnya tak terlacak.
    const sesudah = await (await req('/api/budget/categories')).json() as Pohon;
    expect(sesudah.expense.map((k) => k.nama)).toContain('Listrik');
  });
});

describe('pemetaan oleh jalur tulis', () => {
  it('POST /api/budget memetakan kategori bawaan', async () => {
    const res = await req('/api/budget', {
      method: 'POST',
      body: JSON.stringify({ type: 'expense', amount: 50_000, category: 'Makanan & Minuman' }),
    });
    expect(res.status).toBe(201);
    expect(await idUntuk('expense', 'Makanan & Minuman')).toBeTruthy();
  });

  it('POST /api/budget memberi kategori sendiri untuk teks yang belum dikenal', async () => {
    await req('/api/budget', {
      method: 'POST',
      body: JSON.stringify({ type: 'expense', amount: 25_000, category: 'Iuran RT' }),
    });

    const iuran = (await daftarKategori(D(), 'user-1', 'expense')).find((k) => k.nama === 'Iuran RT');
    expect(iuran).toBeTruthy();
    expect(await idUntuk('expense', 'Iuran RT')).toBe(iuran!.id);
  });

  it('dua transaksi berkategori sama tidak melahirkan dua kategori', async () => {
    for (const amount of [10_000, 20_000]) {
      await req('/api/budget', {
        method: 'POST',
        body: JSON.stringify({ type: 'expense', amount, category: 'Iuran RT' }),
      });
    }
    expect((await daftarKategori(D(), 'user-1', 'expense')).filter((k) => k.nama === 'Iuran RT'))
      .toHaveLength(1);
  });

  it('memisahkan teks yang sama pada pemasukan dan pengeluaran', async () => {
    await req('/api/budget', {
      method: 'POST', body: JSON.stringify({ type: 'expense', amount: 1000, category: 'Lainnya' }),
    });
    await req('/api/budget', {
      method: 'POST', body: JSON.stringify({ type: 'income', amount: 1000, category: 'Lainnya' }),
    });

    const keluar = await idUntuk('expense', 'Lainnya');
    const masuk = await idUntuk('income', 'Lainnya');
    expect(keluar).toBeTruthy();
    expect(masuk).toBeTruthy();
    expect(keluar).not.toBe(masuk);
  });

  it('PUT /api/budget/:id memetakan kategori barunya', async () => {
    const dibuat = await (await req('/api/budget', {
      method: 'POST',
      body: JSON.stringify({ type: 'expense', amount: 30_000, category: 'Makanan & Minuman' }),
    })).json() as { id: string };

    await req(`/api/budget/${dibuat.id}`, {
      method: 'PUT',
      body: JSON.stringify({ type: 'expense', amount: 30_000, category: 'Servis Motor Pak Budi' }),
    });

    expect(await idUntuk('expense', 'Servis Motor Pak Budi')).toBeTruthy();
  });

  it('PUT yang mengubah jenis memetakan kategorinya pada jenis yang baru', async () => {
    const dibuat = await (await req('/api/budget', {
      method: 'POST',
      body: JSON.stringify({ type: 'expense', amount: 30_000, category: 'Hadiah' }),
    })).json() as { id: string };

    await req(`/api/budget/${dibuat.id}`, {
      method: 'PUT',
      body: JSON.stringify({ type: 'income', amount: 30_000, category: 'Hadiah' }),
    });

    // Dua baris kategori bernama sama, satu per jenis — itu yang benar, karena
    // 'Hadiah' sebagai pemasukan dan sebagai pengeluaran bukan hal yang sama.
    expect(await idUntuk('income', 'Hadiah')).toBeTruthy();
    expect(await idUntuk('expense', 'Hadiah')).toBeTruthy();
  });

  it('pembayaran hutang memetakan kategorinya', async () => {
    await db.prepare(
      `INSERT INTO bank_accounts (id, user_id, name, account_type, balance)
       VALUES ('rek-1', ?1, 'BCA', 'Bank', 5000000)`
    ).bind('user-1').run();
    const hutang = await (await req('/api/debts', {
      method: 'POST',
      body: JSON.stringify({ type: 'debt', person_name: 'Pak Budi', amount: 500_000, due_date: '2026-10-01' }),
    })).json() as { id: string };

    await req(`/api/debts/${hutang.id}/payments`, {
      method: 'POST',
      body: JSON.stringify({ amount: 100_000, payment_date: '2026-09-20', status: 'paid', bank_account_id: 'rek-1' }),
    });

    // Cicilan adalah pengeluaran paling rutin di aplikasi ini; kalau jalur
    // inilah yang lupa memetakan, justru yang terbesar yang hilang.
    expect(await idUntuk('expense', 'Cicilan & Utang')).toBeTruthy();
  });

  it('shortcut iOS memetakan kategori yang dikirimnya', async () => {
    await db.prepare(
      `INSERT INTO shortcut_tokens (token, user_id, created_at) VALUES ('tok-1', ?1, 0)`
    ).bind('user-1').run();

    const res = await app.fetch(
      new Request('http://x/api/shortcut/budget', {
        method: 'POST',
        headers: { Authorization: 'Bearer tok-1', 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'expense', amount: 15_000, category: 'Parkir Pasar' }),
      }),
      env()
    );
    expect(res.status).toBe(200);
    expect(await idUntuk('expense', 'Parkir Pasar')).toBeTruthy();
  });

  it('shortcut iOS memetakan kategori bawaannya sendiri saat tidak dikirim', async () => {
    await db.prepare(
      `INSERT INTO shortcut_tokens (token, user_id, created_at) VALUES ('tok-1', ?1, 0)`
    ).bind('user-1').run();

    await app.fetch(
      new Request('http://x/api/shortcut/budget', {
        method: 'POST',
        headers: { Authorization: 'Bearer tok-1', 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: 9_000 }),
      }),
      env()
    );
    // Rutenya memilih sendiri 'Lainnya' untuk pengeluaran tanpa kategori;
    // yang dipilih sendiri pun harus ikut terpetakan.
    expect(await idUntuk('expense', 'Lainnya')).toBeTruthy();
  });

  it('alat AI uang.catat memetakan kategori yang dikarangnya', async () => {
    const alat = TOOL_BY_NAME.get('uang.catat')!;
    const ctx = { db: db as never, userId: 'user-1', today: '2026-09-20' } as unknown as ToolContext;

    await alat.run(ctx, { jenis: 'expense', jumlah: 40_000, kategori: 'Kopi Senja' });

    // Model bisa mengarang nama kategori; yang dikarang tetap dapat barisnya
    // sendiri, bukan dilempar ke 'Lainnya' tanpa pengguna pernah tahu.
    const id = await idUntuk('expense', 'Kopi Senja');
    expect(id).toBeTruthy();
    expect((await daftarKategori(D(), 'user-1', 'expense')).find((k) => k.id === id)!.nama)
      .toBe('Kopi Senja');
  });

  it('setiap alias yang dibuat jalur tulis menunjuk kategori yang ada', async () => {
    await req('/api/budget', {
      method: 'POST', body: JSON.stringify({ type: 'expense', amount: 1000, category: 'Apa Saja' }),
    });
    const yatim = await db.prepare(
      `SELECT COUNT(*) AS n FROM finance_category_alias a
        WHERE NOT EXISTS (SELECT 1 FROM finance_category c WHERE c.id = a.category_id)`
    ).first<{ n: number }>();
    expect(yatim!.n).toBe(0);
  });
});

describe('GET /api/budget/limits', () => {
  interface Limit { category: string; limit: number; spent: number; remaining: number }

  it('memakai daftar bawaan selama kategori belum disemai', async () => {
    const hasil = await (await req('/api/budget/limits?month=2026-09')).json() as Limit[];
    expect(hasil.map((l) => l.category)).toEqual(EXPENSE_CATEGORIES);
  });

  it('memunculkan kategori buatan pengguna sendiri', async () => {
    await req('/api/budget/categories');
    await req('/api/budget', {
      method: 'POST', body: JSON.stringify({ type: 'expense', amount: 75_000, category: 'Iuran RT' }),
    });

    const hasil = await (await req('/api/budget/limits?month=2026-09')).json() as Limit[];
    // Sebelum ini sumbunya daftar tetap, jadi pengeluaran yang jatuh ke
    // kategori sendiri hilang dari layar limit tanpa jejak apa pun.
    expect(hasil.map((l) => l.category)).toContain('Iuran RT');
  });

  it('tidak memunculkan subkategori, supaya layarnya tidak kebanjiran', async () => {
    await req('/api/budget/categories');
    const hasil = await (await req('/api/budget/limits?month=2026-09')).json() as Limit[];
    expect(hasil.map((l) => l.category)).not.toContain('Listrik');
    expect(hasil.map((l) => l.category)).toContain('Tagihan & Utilitas');
  });

  it('tetap menjumlahkan pengeluaran pada kategorinya', async () => {
    await req('/api/budget/categories');
    await req('/api/budget/limits', {
      method: 'POST',
      body: JSON.stringify({ category: 'Makanan & Minuman', limit: 1_000_000, month: '2026-09' }),
    });
    await req('/api/budget', {
      method: 'POST',
      body: JSON.stringify({ type: 'expense', amount: 300_000, category: 'Makanan & Minuman', date: '2026-09-10' }),
    });

    const baris = (await (await req('/api/budget/limits?month=2026-09')).json() as Limit[])
      .find((l) => l.category === 'Makanan & Minuman')!;
    expect(baris.limit).toBe(1_000_000);
    expect(baris.spent).toBe(300_000);
    expect(baris.remaining).toBe(700_000);
  });

  it('tidak memunculkan kategori pengguna lain', async () => {
    await req('/api/budget/categories');
    await req('/api/budget', {
      method: 'POST', body: JSON.stringify({ type: 'expense', amount: 1000, category: 'Punya Orang Lain' }),
    }, tokenLain);

    const hasil = await (await req('/api/budget/limits?month=2026-09')).json() as Limit[];
    expect(hasil.map((l) => l.category)).not.toContain('Punya Orang Lain');
  });
});
