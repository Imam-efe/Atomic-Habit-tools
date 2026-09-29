/**
 * Tagihan terjadwal: melihatnya datang, lalu menyatakan sudah dibayar.
 *
 * Rute ini sengaja TIDAK memposting apa pun sendiri. Bedanya dengan transaksi
 * berulang di index.ts bukan soal kenyamanan melainkan soal saldo yang jujur:
 * tagihan yang dianggap lunas padahal belum dibayar membuat saldo turunan
 * (lib/finance_saldo.ts) melaporkan uang yang masih ada di rekening sebagai
 * sudah pergi. Barisnya di `budget_entries` baru lahir saat pengguna menekan
 * "sudah bayar".
 *
 * Karena itulah pembayaran di sini menggeser `bank_accounts.balance` juga:
 * kolom itu berfungsi sebagai checksum terhadap saldo turunan, dan jalur tulis
 * yang melewatkannya akan membuat checksum menyala untuk transaksi yang
 * sebetulnya benar.
 */

import { Hono } from 'hono';
import { requireAuth, type AuthContext } from '../middleware/auth';
import { nanoid } from '../lib/nanoid';
import { validate, isDate, jakartaToday } from '../lib/validate';
import { pastikanKategori, type JenisKategori } from '../lib/finance_kategori';
import { majuJatuhTempo, ULANG_SAH, type Ulang } from '../lib/finance_tagihan';
import { daysBetween } from '../lib/daily';

const tagihan = new Hono<AuthContext>();
tagihan.use('/*', requireAuth);

interface TagihanRow {
  id: string;
  nama: string;
  jumlah_idr: number;
  jatuh_tempo: string;
  ulang: string | null;
  hari_anchor: number | null;
  jenis: string;
  kategori: string;
  bank_account_id: string | null;
  aktif: number;
  catatan: string | null;
  rekening_nama: string | null;
  jumlah_bayar: number;
}

function bacaUlang(nilai: unknown): Ulang | null {
  return typeof nilai === 'string' && ULANG_SAH.includes(nilai as Ulang)
    ? (nilai as Ulang)
    : null;
}

// GET /api/tagihan
tagihan.get('/', async (c) => {
  const user = c.get('user');
  const today = jakartaToday();

  const rows = await c.env.DB.prepare(
    `SELECT t.id, t.nama, t.jumlah_idr, t.jatuh_tempo, t.ulang, t.hari_anchor, t.jenis,
            t.kategori, t.bank_account_id, t.aktif, t.catatan,
            b.name AS rekening_nama,
            (SELECT COUNT(*) FROM finance_tagihan_bayar p WHERE p.tagihan_id = t.id) AS jumlah_bayar
       FROM finance_tagihan t
       -- LEFT JOIN: rekening yang terhapus tidak boleh menghilangkan tagihannya.
       LEFT JOIN bank_accounts b ON b.id = t.bank_account_id AND b.user_id = t.user_id
      WHERE t.user_id = ?1
      ORDER BY t.aktif DESC, t.jatuh_tempo ASC`
  ).bind(user.sub).all<TagihanRow>();

  return c.json({
    tagihan: (rows.results ?? []).map((r) => ({
      id: r.id,
      nama: r.nama,
      jumlah: r.jumlah_idr,
      jatuhTempo: r.jatuh_tempo,
      ulang: r.ulang,
      hariAnchor: r.hari_anchor,
      jenis: r.jenis,
      kategori: r.kategori,
      bankAccountId: r.bank_account_id,
      rekeningNama: r.rekening_nama,
      aktif: r.aktif === 1,
      catatan: r.catatan,
      jumlahBayar: r.jumlah_bayar,
      // Negatif berarti telat. Dihitung di server supaya "hari ini" selalu WIB,
      // bukan zona perangkat yang bisa menggeser hitungannya sehari.
      sisaHari: daysBetween(today, r.jatuh_tempo),
    })),
  });
});

// POST /api/tagihan
tagihan.post('/', async (c) => {
  const user = c.get('user');
  type Body = {
    nama?: string;
    jumlah?: number;
    jatuh_tempo?: string;
    ulang?: string;
    jenis?: string;
    kategori?: string;
    bank_account_id?: string;
    catatan?: string;
  };
  const body = await c.req.json<Body>().catch((): Body => ({}));

  const err = validate(body as Record<string, unknown>, {
    nama: { type: 'string' },
    jumlah: { type: 'number', min: 1 },
  });
  if (err) return c.json({ error: err }, 400);

  if (typeof body.jatuh_tempo !== 'string' || !isDate(body.jatuh_tempo)) {
    return c.json({ error: 'jatuh_tempo harus tanggal YYYY-MM-DD' }, 400);
  }

  const jenis: JenisKategori = body.jenis === 'income' ? 'income' : 'expense';
  const kategori = (body.kategori ?? '').trim() || (jenis === 'income' ? 'Lainnya' : 'Tagihan & Utilitas');

  // Rekeningnya dipastikan milik pengguna ini sebelum disimpan. Tanpa cek ini,
  // tagihan bisa menunjuk rekening orang lain dan pembayarannya kelak menggeser
  // saldo yang bukan haknya.
  if (body.bank_account_id) {
    const punya = await c.env.DB.prepare(
      'SELECT id FROM bank_accounts WHERE id = ?1 AND user_id = ?2'
    ).bind(body.bank_account_id, user.sub).first<{ id: string }>();
    if (!punya) return c.json({ error: 'rekening tidak ditemukan' }, 404);
  }

  await pastikanKategori(c.env.DB, user.sub, jenis, kategori);

  const id = nanoid();
  // Hari asal disimpan saat dibuat, bukan diturunkan belakangan dari
  // `jatuh_tempo` yang mungkin sudah terjepit ke akhir bulan pendek.
  const hariAnchor = Number(body.jatuh_tempo.split('-')[2]);

  await c.env.DB.prepare(
    `INSERT INTO finance_tagihan
       (id, user_id, nama, jumlah_idr, jatuh_tempo, ulang, hari_anchor, jenis, kategori,
        bank_account_id, aktif, catatan)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 1, ?11)`
  ).bind(
    id, user.sub, body.nama!.trim(), Math.round(body.jumlah!), body.jatuh_tempo,
    bacaUlang(body.ulang), hariAnchor, jenis, kategori,
    body.bank_account_id || null, body.catatan?.trim() || null
  ).run();

  return c.json({ id, nama: body.nama!.trim(), jatuhTempo: body.jatuh_tempo, jenis }, 201);
});

// PUT /api/tagihan/:id
tagihan.put('/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  type Body = {
    nama?: string;
    jumlah?: number;
    jatuh_tempo?: string;
    ulang?: string;
    jenis?: string;
    kategori?: string;
    bank_account_id?: string;
    catatan?: string;
    aktif?: boolean;
  };
  const body = await c.req.json<Body>().catch((): Body => ({}));

  const lama = await c.env.DB.prepare(
    'SELECT * FROM finance_tagihan WHERE id = ?1 AND user_id = ?2'
  ).bind(id, user.sub).first<TagihanRow>();
  // 404, bukan 403: tagihan milik orang lain terlihat sama dengan yang tidak ada.
  if (!lama) return c.json({ error: 'tagihan tidak ditemukan' }, 404);

  const jatuhTempo = typeof body.jatuh_tempo === 'string' && isDate(body.jatuh_tempo)
    ? body.jatuh_tempo
    : lama.jatuh_tempo;
  const jenis: JenisKategori = (body.jenis ?? lama.jenis) === 'income' ? 'income' : 'expense';
  const kategori = (body.kategori ?? lama.kategori).trim() || lama.kategori;
  const nama = (body.nama ?? lama.nama).trim() || lama.nama;
  const jumlah = typeof body.jumlah === 'number' && body.jumlah >= 1
    ? Math.round(body.jumlah)
    : lama.jumlah_idr;

  if (body.bank_account_id) {
    const punya = await c.env.DB.prepare(
      'SELECT id FROM bank_accounts WHERE id = ?1 AND user_id = ?2'
    ).bind(body.bank_account_id, user.sub).first<{ id: string }>();
    if (!punya) return c.json({ error: 'rekening tidak ditemukan' }, 404);
  }

  await pastikanKategori(c.env.DB, user.sub, jenis, kategori);

  // Hari asal hanya ikut berubah kalau tanggalnya yang diubah. Menghitungnya
  // ulang dari `jatuh_tempo` yang tidak disentuh akan mengunci tagihan pada
  // tanggal terjepitnya — 31 berubah jadi 28 permanen hanya karena pengguna
  // mengganti nominalnya.
  const hariAnchor = jatuhTempo === lama.jatuh_tempo
    ? lama.hari_anchor
    : Number(jatuhTempo.split('-')[2]);

  const bankAccountId = 'bank_account_id' in body
    ? (body.bank_account_id || null)
    : lama.bank_account_id;

  await c.env.DB.prepare(
    `UPDATE finance_tagihan
        SET nama = ?1, jumlah_idr = ?2, jatuh_tempo = ?3, ulang = ?4, hari_anchor = ?5,
            jenis = ?6, kategori = ?7, bank_account_id = ?8, aktif = ?9, catatan = ?10
      WHERE id = ?11 AND user_id = ?12`
  ).bind(
    nama, jumlah, jatuhTempo,
    'ulang' in body ? bacaUlang(body.ulang) : lama.ulang,
    hariAnchor, jenis, kategori, bankAccountId,
    typeof body.aktif === 'boolean' ? (body.aktif ? 1 : 0) : lama.aktif,
    'catatan' in body ? (body.catatan?.trim() || null) : lama.catatan,
    id, user.sub
  ).run();

  return c.json({ id, nama, jumlah, jatuhTempo, jenis });
});

// DELETE /api/tagihan/:id
tagihan.delete('/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');

  const ada = await c.env.DB.prepare(
    'SELECT id FROM finance_tagihan WHERE id = ?1 AND user_id = ?2'
  ).bind(id, user.sub).first<{ id: string }>();
  if (!ada) return c.json({ error: 'tagihan tidak ditemukan' }, 404);

  // Riwayat bayarnya ikut terhapus lewat ON DELETE CASCADE, tapi baris
  // `budget_entries` yang sudah lahir TIDAK: itu transaksi yang sungguh terjadi,
  // dan menghapusnya akan mengubah saldo yang sudah benar.
  await c.env.DB.prepare('DELETE FROM finance_tagihan WHERE id = ?1 AND user_id = ?2')
    .bind(id, user.sub).run();

  return c.json({ ok: true });
});

// POST /api/tagihan/:id/bayar
tagihan.post('/:id/bayar', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  type Body = { dibayar_pada?: string; jumlah?: number; bank_account_id?: string };
  const body = await c.req.json<Body>().catch((): Body => ({}));

  const t = await c.env.DB.prepare(
    'SELECT * FROM finance_tagihan WHERE id = ?1 AND user_id = ?2'
  ).bind(id, user.sub).first<TagihanRow>();
  if (!t) return c.json({ error: 'tagihan tidak ditemukan' }, 404);

  const periode = t.jatuh_tempo;
  const dibayarPada = typeof body.dibayar_pada === 'string' && isDate(body.dibayar_pada)
    ? body.dibayar_pada
    : jakartaToday();
  // Nominalnya bisa berbeda dari perkiraan — tagihan listrik jarang sama tiap
  // bulan. Yang dicatat di budget_entries adalah yang benar-benar dibayar.
  const jumlah = typeof body.jumlah === 'number' && body.jumlah >= 1
    ? Math.round(body.jumlah)
    : t.jumlah_idr;

  const bankAccountId = body.bank_account_id ?? t.bank_account_id;
  if (bankAccountId) {
    const punya = await c.env.DB.prepare(
      'SELECT id FROM bank_accounts WHERE id = ?1 AND user_id = ?2'
    ).bind(bankAccountId, user.sub).first<{ id: string }>();
    if (!punya) return c.json({ error: 'rekening tidak ditemukan' }, 404);
  }

  const jenis: JenisKategori = t.jenis === 'income' ? 'income' : 'expense';
  await pastikanKategori(c.env.DB, user.sub, jenis, t.kategori);

  const bayarId = nanoid();
  const entryId = nanoid();
  const now = Math.floor(Date.now() / 1000);
  const ulang = bacaUlang(t.ulang);
  const berikutnya = majuJatuhTempo(periode, ulang, t.hari_anchor);

  const pernyataan = [
    // Indeks unik (tagihan_id, periode) yang menjaganya: satu ketukan ganda di
    // ponsel tidak bisa mencatat periode yang sama dua kali. Batch adalah satu
    // transaksi, jadi bentrokan di sini membatalkan seluruh pembayaran —
    // termasuk baris budget_entries dan pergeseran saldonya.
    c.env.DB.prepare(
      `INSERT INTO finance_tagihan_bayar
         (id, tagihan_id, user_id, periode, jumlah_idr, dibayar_pada, budget_entry_id)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`
    ).bind(bayarId, id, user.sub, periode, jumlah, dibayarPada, entryId),

    c.env.DB.prepare(
      `INSERT INTO budget_entries
         (id, user_id, type, amount_idr, category, note, entry_date, bank_account_id, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`
    ).bind(entryId, user.sub, jenis, jumlah, t.kategori, t.nama, dibayarPada, bankAccountId, now),
  ];

  if (bankAccountId) {
    pernyataan.push(
      c.env.DB.prepare(
        'UPDATE bank_accounts SET balance = balance + ?1 WHERE id = ?2 AND user_id = ?3'
      ).bind(jenis === 'income' ? jumlah : -jumlah, bankAccountId, user.sub)
    );
  }

  pernyataan.push(
    berikutnya
      ? c.env.DB.prepare('UPDATE finance_tagihan SET jatuh_tempo = ?1 WHERE id = ?2 AND user_id = ?3')
          .bind(berikutnya, id, user.sub)
      // Tagihan sekali tidak punya kemunculan berikutnya, jadi dinonaktifkan
      // alih-alih dibiarkan menunjuk periode yang sudah dibayar — kalau tidak,
      // ia akan terus tampil jatuh tempo dan tidak bisa dibayar lagi.
      : c.env.DB.prepare('UPDATE finance_tagihan SET aktif = 0 WHERE id = ?1 AND user_id = ?2')
          .bind(id, user.sub)
  );

  try {
    await c.env.DB.batch(pernyataan);
  } catch {
    // Satu-satunya bentrokan yang mungkin di sini adalah periode yang sudah
    // dibayar. 409, bukan 500: ini keadaan yang sah, bukan kerusakan.
    const sudah = await c.env.DB.prepare(
      'SELECT id FROM finance_tagihan_bayar WHERE tagihan_id = ?1 AND periode = ?2'
    ).bind(id, periode).first<{ id: string }>();
    if (sudah) return c.json({ error: 'periode ini sudah dibayar', periode }, 409);
    throw new Error('gagal menyimpan pembayaran tagihan');
  }

  return c.json({
    id: bayarId, tagihanId: id, periode, jumlah,
    dibayarPada, budgetEntryId: entryId, jatuhTempoBerikutnya: berikutnya,
  }, 201);
});

// DELETE /api/tagihan/:id/bayar — membatalkan pembayaran TERAKHIR
tagihan.delete('/:id/bayar', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');

  const t = await c.env.DB.prepare(
    'SELECT * FROM finance_tagihan WHERE id = ?1 AND user_id = ?2'
  ).bind(id, user.sub).first<TagihanRow>();
  if (!t) return c.json({ error: 'tagihan tidak ditemukan' }, 404);

  // Hanya yang terakhir yang bisa dibatalkan. Membatalkan periode di
  // tengah-tengah akan membuat `jatuh_tempo` menunjuk periode yang sudah
  // dibayar, dan pembayaran berikutnya langsung bentrok — aturan yang lebih
  // sempit di sini menghasilkan keadaan yang selalu konsisten.
  const bayar = await c.env.DB.prepare(
    `SELECT id, periode, jumlah_idr, budget_entry_id FROM finance_tagihan_bayar
      WHERE tagihan_id = ?1 AND user_id = ?2
      ORDER BY periode DESC LIMIT 1`
  ).bind(id, user.sub).first<{
    id: string; periode: string; jumlah_idr: number; budget_entry_id: string | null;
  }>();
  if (!bayar) return c.json({ error: 'belum ada pembayaran' }, 404);

  // Baris budget_entries-nya dibaca dulu: rekening dan nominalnya diambil dari
  // situ, bukan dari tagihannya, karena nominal yang dibayar bisa berbeda dari
  // perkiraan dan rekeningnya bisa sudah diganti.
  const entry = bayar.budget_entry_id
    ? await c.env.DB.prepare(
        'SELECT type, amount_idr, bank_account_id FROM budget_entries WHERE id = ?1 AND user_id = ?2'
      ).bind(bayar.budget_entry_id, user.sub).first<{
        type: string; amount_idr: number; bank_account_id: string | null;
      }>()
    : null;

  const pernyataan = [
    c.env.DB.prepare('DELETE FROM finance_tagihan_bayar WHERE id = ?1 AND user_id = ?2')
      .bind(bayar.id, user.sub),
    // Jatuh tempo kembali ke periode yang dibatalkan, dan tagihannya diaktifkan
    // lagi — tagihan sekali dinonaktifkan saat dibayar.
    c.env.DB.prepare(
      'UPDATE finance_tagihan SET jatuh_tempo = ?1, aktif = 1 WHERE id = ?2 AND user_id = ?3'
    ).bind(bayar.periode, id, user.sub),
  ];

  if (entry) {
    pernyataan.push(
      c.env.DB.prepare('DELETE FROM budget_entries WHERE id = ?1 AND user_id = ?2')
        .bind(bayar.budget_entry_id, user.sub)
    );
    if (entry.bank_account_id) {
      // Kebalikan dari saat dibayar, supaya checksum saldo tetap nol.
      pernyataan.push(
        c.env.DB.prepare(
          'UPDATE bank_accounts SET balance = balance + ?1 WHERE id = ?2 AND user_id = ?3'
        ).bind(
          entry.type === 'income' ? -entry.amount_idr : entry.amount_idr,
          entry.bank_account_id, user.sub
        )
      );
    }
  }

  await c.env.DB.batch(pernyataan);

  return c.json({ ok: true, periode: bayar.periode });
});

export default tagihan;
