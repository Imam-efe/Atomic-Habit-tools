/**
 * Kategori keuangan berid, di atas teks kategori yang sudah ada.
 *
 * Transaksi tetap menyimpan nama kategorinya sebagai teks — tujuh jalur tulis
 * yang ada sekarang tidak perlu berubah serempak, dan tidak ada satu pun baris
 * lama yang dipindahkan. Yang dipetakan ke id adalah teksnya, lewat tabel
 * alias (lihat migrasi 0043). Akibatnya dua sifat yang jadi alasan seluruh
 * berkas ini ada:
 *
 *   * Mengganti nama kategori membawa seluruh riwayatnya. Alias menyimpan teks
 *     historis, `finance_category.nama` menyimpan yang berlaku sekarang.
 *   * Dua teks yang sebetulnya sama — termasuk salah ketik — bisa diarahkan ke
 *     satu id tanpa menyentuh satu pun baris transaksi.
 *
 * Kategori bawaan disemai per pengguna saat pertama dipakai, bukan sebagai
 * baris global. Pengguna yang mengganti nama atau menghapus salah satunya
 * tidak boleh mendapatkannya kembali diam-diam, jadi penjaga penyemaian adalah
 * tabel alias, bukan ada-tidaknya nama itu: alias yang sudah ada berarti
 * "bawaan ini pernah disemai untuk pengguna ini", apa pun namanya sekarang.
 */

import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import { nanoid } from './nanoid';

export type JenisKategori = 'income' | 'expense';

export const JENIS_KATEGORI: JenisKategori[] = ['expense', 'income'];

interface Bawaan {
  nama: string;
  emoji: string;
  anak?: Array<{ nama: string; emoji: string }>;
}

/**
 * Daftar bawaan.
 *
 * Nama indukanya SENGAJA sama persis dengan EXPENSE_CATEGORIES dan
 * INCOME_CATEGORIES di routes/budget.ts. Kalau menyimpang, transaksi lama akan
 * memetakan ke kategori hasil backfill (tanpa emoji, tanpa urutan) sementara
 * formulirnya menawarkan kategori bawaan yang berbeda — dua kolom untuk hal
 * yang sama. Ada uji yang menjaga kesamaan itu.
 */
export const KATEGORI_BAWAAN: Record<JenisKategori, Bawaan[]> = {
  expense: [
    {
      nama: 'Makanan & Minuman', emoji: '🍚', anak: [
        { nama: 'Warung & Makan Luar', emoji: '🍜' },
        { nama: 'Belanja Dapur', emoji: '🥬' },
        { nama: 'Kopi & Jajan', emoji: '☕' },
      ],
    },
    {
      nama: 'Transportasi & Bensin', emoji: '⛽', anak: [
        { nama: 'Bensin', emoji: '⛽' },
        { nama: 'Ojek & Taksi Online', emoji: '🛺' },
        { nama: 'Servis & Onderdil', emoji: '🔧' },
        { nama: 'Parkir & Tol', emoji: '🅿️' },
      ],
    },
    {
      nama: 'Kebutuhan Rumah Tangga', emoji: '🏠', anak: [
        { nama: 'Sabun & Kebersihan', emoji: '🧼' },
        { nama: 'Perbaikan Rumah', emoji: '🔨' },
        { nama: 'Gaji ART', emoji: '🧹' },
      ],
    },
    { nama: 'Belanja Bulanan', emoji: '🛍️' },
    {
      nama: 'Tagihan & Utilitas', emoji: '🧾', anak: [
        { nama: 'Listrik', emoji: '⚡' },
        { nama: 'Air PDAM', emoji: '🚰' },
        { nama: 'Internet & Pulsa', emoji: '📶' },
        { nama: 'Gas LPG', emoji: '🔥' },
      ],
    },
    {
      nama: 'Pendidikan & Anak', emoji: '🎒', anak: [
        { nama: 'SPP & Sekolah', emoji: '🏫' },
        { nama: 'Buku & Alat Tulis', emoji: '📚' },
        { nama: 'Les & Kursus', emoji: '✏️' },
      ],
    },
    {
      nama: 'Kesehatan & Obat', emoji: '💊', anak: [
        { nama: 'Dokter & Klinik', emoji: '🩺' },
        { nama: 'Obat & Apotek', emoji: '💉' },
        { nama: 'BPJS & Asuransi', emoji: '🛡️' },
      ],
    },
    {
      nama: 'Hiburan & Rekreasi', emoji: '🎬', anak: [
        { nama: 'Langganan Digital', emoji: '📺' },
        { nama: 'Jalan-jalan', emoji: '✈️' },
      ],
    },
    { nama: 'Cicilan & Utang', emoji: '💳' },
    { nama: 'Investasi & Tabungan', emoji: '📈' },
    { nama: 'Lainnya', emoji: '📦' },
  ],
  income: [
    {
      nama: 'Gaji', emoji: '💼', anak: [
        { nama: 'Gaji Pokok', emoji: '💵' },
        { nama: 'Bonus & THR', emoji: '🎁' },
      ],
    },
    { nama: 'Freelance', emoji: '🧑‍💻' },
    {
      nama: 'Investasi', emoji: '📈', anak: [
        { nama: 'Dividen & Bunga', emoji: '🏦' },
        { nama: 'Jual Aset', emoji: '💱' },
      ],
    },
    { nama: 'Bisnis', emoji: '🏪' },
    { nama: 'Lainnya', emoji: '📦' },
  ],
};

/**
 * Id turunan untuk baris hasil penyemaian dan backfill.
 *
 * Rumusnya harus sama persis dengan yang ada di migrasi 0043, karena migrasi
 * itu membuat baris untuk teks lama dan penyemaian ini harus mengenali baris
 * yang sama — bukan melahirkan kembarnya. Ada uji yang membandingkan keluaran
 * fungsi ini dengan `lower(hex(...))` milik SQLite.
 *
 * Idnya opaque: ia diturunkan dari nama HANYA saat lahir. Kategori yang diganti
 * namanya tetap memakai id lamanya — justru itu yang membuat riwayat ikut. Maka
 * kategori buatan pengguna memakai nanoid, bukan rumus ini: nama yang pernah
 * dipakai lalu ditinggalkan bisa dipakai lagi, dan id turunan akan bentrok.
 */
export function idKategori(userId: string, jenis: JenisKategori, nama: string): string {
  const hex = Array.from(new TextEncoder().encode(nama))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `fc_${userId}_${jenis}_${hex}`;
}

export interface KategoriBaris {
  id: string;
  nama: string;
  indukId: string | null;
  jenis: JenisKategori;
  emoji: string | null;
  urutan: number;
  bawaan: boolean;
}

interface KategoriRow {
  id: string;
  nama: string;
  induk_id: string | null;
  jenis: string;
  emoji: string | null;
  urutan: number;
  bawaan: number;
}

function keBaris(r: KategoriRow): KategoriBaris {
  return {
    id: r.id,
    nama: r.nama,
    indukId: r.induk_id,
    jenis: r.jenis as JenisKategori,
    emoji: r.emoji,
    urutan: r.urutan,
    bawaan: r.bawaan === 1,
  };
}

/** D1 membatasi ukuran satu batch; penyemaian pertama menghasilkan ratusan pernyataan. */
const UKURAN_BATCH = 40;

/**
 * Menyemai kategori bawaan untuk satu pengguna. Aman dipanggil berulang.
 *
 * Tidak melakukan apa pun pada panggilan kedua dan seterusnya: seluruh
 * keputusan diambil dari satu kali baca tabel alias, dan kalau semua bawaan
 * sudah punya alias maka tidak ada satu pun pernyataan tulis yang dikirim.
 *
 * SYARAT UNTUK RUTE HAPUS KATEGORI, kalau nanti ada: aliasnya harus dialihkan
 * ke kategori lain SEBELUM barisnya dihapus. `ON DELETE CASCADE` akan ikut
 * menghapus aliasnya, dan alias itulah satu-satunya catatan bahwa bawaan ini
 * pernah disemai — hilangnya alias membuat kategori yang sengaja dihapus
 * pengguna muncul kembali pada penyemaian berikutnya. Mengalihkan alias juga
 * yang menjaga riwayat transaksinya tidak kehilangan kategori.
 */
export async function semaiKategori(db: D1Database, userId: string): Promise<void> {
  // Penjaganya bukan sekadar "aliasnya ada", tapi "aliasnya menunjuk baris yang
  // memang hasil penyemaian" (bawaan = 1).
  //
  // Bedanya penting. Migrasi 0043 juga membuat alias — untuk teks kategori yang
  // sudah ada — dan barisnya lahir tanpa emoji, tanpa urutan, tanpa induk
  // (bawaan = 0). Kalau ada-tidaknya alias saja yang diperiksa, baris itu
  // dianggap sudah disemai dan tidak pernah dilengkapi: pengguna lama akan
  // melihat kategorinya tanpa emoji, tanpa subkategori, dan terurut di paling
  // belakang, selamanya.
  const aliasAda = await db.prepare(
    `SELECT a.jenis, a.teks FROM finance_category_alias a
       JOIN finance_category c ON c.id = a.category_id
      WHERE a.user_id = ?1 AND c.bawaan = 1`
  ).bind(userId).all<{ jenis: string; teks: string }>();
  const sudah = new Set((aliasAda.results ?? []).map((r) => `${r.jenis}\u0000${r.teks}`));

  const pernyataan: D1PreparedStatement[] = [];

  const tambah = (
    jenis: JenisKategori,
    nama: string,
    emoji: string,
    urutan: number,
    namaInduk: string | null
  ) => {
    if (sudah.has(`${jenis}\u0000${nama}`)) return;

    const id = idKategori(userId, jenis, nama);
    // Induknya dicari lewat nama, bukan dirumuskan: induk yang lahir dari
    // backfill teks lama bisa saja sudah punya id acak.
    const cariInduk = namaInduk
      ? `(SELECT p.id FROM finance_category p
           WHERE p.user_id = ?1 AND p.jenis = ?2 AND p.nama = ?3)`
      : 'NULL';

    pernyataan.push(
      db.prepare(
        `INSERT OR IGNORE INTO finance_category (id, user_id, nama, jenis, emoji, urutan, induk_id, bawaan)
         SELECT ?4, ?1, ?5, ?2, ?6, ?7, ${cariInduk}, 1`
      ).bind(userId, jenis, namaInduk ?? '', id, nama, emoji, urutan),

      // Baris yang sudah ada dari backfill teks lama tidak punya emoji, urutan,
      // maupun induk. Dilengkapi di tempat — bukan diduplikasi — supaya
      // transaksi lama dan formulir baru menunjuk kategori yang sama.
      db.prepare(
        `UPDATE finance_category
            SET emoji = ?6, urutan = ?7, bawaan = 1, induk_id = ${cariInduk}
          WHERE user_id = ?1 AND jenis = ?2 AND nama = ?5 AND bawaan = 0`
      ).bind(userId, jenis, namaInduk ?? '', id, nama, emoji, urutan),

      db.prepare(
        `INSERT OR IGNORE INTO finance_category_alias (user_id, jenis, teks, category_id)
         SELECT ?1, ?2, ?3, c.id FROM finance_category c
          WHERE c.user_id = ?1 AND c.jenis = ?2 AND c.nama = ?3`
      ).bind(userId, jenis, nama)
    );
  };

  for (const jenis of JENIS_KATEGORI) {
    KATEGORI_BAWAAN[jenis].forEach((induk, i) => {
      // Induk lebih dulu, di batch yang sama atau sebelumnya: anak mencari
      // induknya lewat subkueri, jadi barisnya harus sudah ada.
      tambah(jenis, induk.nama, induk.emoji, i * 100, null);
    });
    KATEGORI_BAWAAN[jenis].forEach((induk, i) => {
      (induk.anak ?? []).forEach((anak, j) => {
        // Urutan anak menempel di belakang induknya (induk 0, anaknya 1..n;
        // induk berikutnya 100), jadi satu ORDER BY urutan sudah menghasilkan
        // induk-lalu-anaknya tanpa penyusunan ulang di sisi pembaca.
        tambah(jenis, anak.nama, anak.emoji, i * 100 + j + 1, induk.nama);
      });
    });
  }

  for (let i = 0; i < pernyataan.length; i += UKURAN_BATCH) {
    await db.batch(pernyataan.slice(i, i + UKURAN_BATCH));
  }
}

/**
 * Seluruh kategori satu pengguna, induk lalu anaknya, dalam urutan tampil.
 *
 * Murni baca: tidak menyemai apa pun. Rute yang butuh daftar lengkap memanggil
 * `semaiKategori` lebih dulu.
 */
export async function daftarKategori(
  db: D1Database,
  userId: string,
  jenis?: JenisKategori
): Promise<KategoriBaris[]> {
  const sql = `SELECT id, nama, induk_id, jenis, emoji, urutan, bawaan
                 FROM finance_category
                WHERE user_id = ?1 ${jenis ? 'AND jenis = ?2' : ''}
                ORDER BY jenis, urutan, nama`;
  const stmt = jenis
    ? db.prepare(sql).bind(userId, jenis)
    : db.prepare(sql).bind(userId);
  const rows = await stmt.all<KategoriRow>();
  return (rows.results ?? []).map(keBaris);
}

/**
 * Id kategori untuk satu teks, dibuatkan bila teksnya belum dikenal.
 *
 * Dipanggil jalur tulis. Teks yang tidak ada di daftar bawaan — hasil OCR
 * struk, tebakan AI, atau ketikan pengguna — tetap mendapat kategorinya
 * sendiri apa adanya, bukan dilempar ke 'Lainnya': menebak kolomnya berarti
 * memindahkan uang ke tempat yang belum tentu benar, dan pengguna tidak akan
 * pernah tahu itu terjadi. Menggabungkannya belakangan cukup satu baris alias.
 */
export async function pastikanKategori(
  db: D1Database,
  userId: string,
  jenis: JenisKategori,
  teksMentah: string
): Promise<string | null> {
  const teks = teksMentah.trim();
  if (!teks) return null;

  const ada = await db.prepare(
    'SELECT category_id FROM finance_category_alias WHERE user_id = ?1 AND jenis = ?2 AND teks = ?3'
  ).bind(userId, jenis, teks).first<{ category_id: string }>();
  if (ada) return ada.category_id;

  // Nama yang sama mungkin sudah ada tanpa alias (misalnya dibuat pengguna
  // sebelum teks ini pertama kali dipakai). Dipakai ulang, bukan digandakan.
  const senama = await db.prepare(
    'SELECT id FROM finance_category WHERE user_id = ?1 AND jenis = ?2 AND nama = ?3'
  ).bind(userId, jenis, teks).first<{ id: string }>();

  const id = senama?.id ?? nanoid();
  const pernyataan: D1PreparedStatement[] = [];
  if (!senama) {
    pernyataan.push(
      db.prepare(
        `INSERT INTO finance_category (id, user_id, nama, jenis, urutan, bawaan)
         VALUES (?1, ?2, ?3, ?4, 900, 0)`
      ).bind(id, userId, teks, jenis)
    );
  }
  pernyataan.push(
    db.prepare(
      `INSERT OR IGNORE INTO finance_category_alias (user_id, jenis, teks, category_id)
       VALUES (?1, ?2, ?3, ?4)`
    ).bind(userId, jenis, teks, id)
  );
  await db.batch(pernyataan);

  return id;
}

/**
 * Peta teks -> id untuk satu pengguna, sekali baca.
 *
 * Laporan mengelompokkan ratusan baris transaksi; menyelesaikan teksnya satu
 * per satu berarti satu kueri per baris.
 */
export async function petaAlias(
  db: D1Database,
  userId: string
): Promise<Map<string, string>> {
  const rows = await db.prepare(
    'SELECT jenis, teks, category_id FROM finance_category_alias WHERE user_id = ?1'
  ).bind(userId).all<{ jenis: string; teks: string; category_id: string }>();

  const peta = new Map<string, string>();
  for (const r of rows.results ?? []) peta.set(kunciAlias(r.jenis, r.teks), r.category_id);
  return peta;
}

/** Kunci peta alias. Jenis ikut dibawa karena 'Lainnya' ada di kedua jenis. */
export function kunciAlias(jenis: string, teks: string): string {
  return `${jenis}\u0000${teks.trim()}`;
}
