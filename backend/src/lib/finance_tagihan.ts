/**
 * Kemunculan tagihan terjadwal, dan proyeksi saldo yang menyusul darinya.
 *
 * Seluruh berkas ini MURNI HITUNG: tidak ada satu pun kueri di sini. Alasannya
 * bukan kerapian, tapi karena inilah bagian yang paling mungkin salah tanpa
 * memunculkan galat. Tagihan bulanan yang meleset sehari, atau kemunculan
 * terakhir yang terlewat di ujung horizon, tetap mengembalikan angka — hanya
 * angkanya salah, dan salahnya baru terasa saat saldo yang diproyeksi aman
 * ternyata minus.
 *
 * Tanggal dihitung lewat `advanceDate` dan `shiftDate` yang sudah ada, bukan
 * aritmetika tanggal baru. `advanceDate` sudah menjepit akhir bulan dengan
 * benar (31 Januari + 1 bulan = 28/29 Februari, bukan 3 Maret) dan terbukti
 * sama di tujuh zona waktu termasuk zona ber-offset setengah jam dan hari
 * peralihan DST — ada ujinya sekarang di validate.test.ts.
 */

import { advanceDate } from './validate';
import { daysBetween } from './daily';

/** Sama dengan kosakata `budget_entries.recurrence`, disengaja. */
export type Ulang = 'daily' | 'weekly' | 'monthly';

export const ULANG_SAH: Ulang[] = ['daily', 'weekly', 'monthly'];

/**
 * Batas jumlah kemunculan yang dihasilkan sekali panggil.
 *
 * Tagihan harian pada horizon setahun sah-sah saja menghasilkan 365 baris.
 * Yang dijaga batas ini bukan itu, melainkan `jatuh_tempo` yang entah bagaimana
 * jadi tanggal tahun 1970: tanpa batas, perulangannya akan berjalan puluhan
 * ribu kali di dalam satu permintaan.
 */
const BATAS_KEMUNCULAN = 500;

const duaAngka = (n: number) => String(n).padStart(2, '0');

/**
 * Tanggal ke-`langkah` bulan setelah `mulai`, kembali ke hari asalnya.
 *
 * Inilah bedanya dengan memanggil `advanceDate` berulang kali. `advanceDate`
 * menghitung dari tanggal SEBELUMNYA, jadi tagihan tanggal 31 yang sudah
 * dijepit ke 28 Februari akan terus dihitung dari 28 dan hanyut ke tanggal 28
 * selamanya. Di sini hari asalnya (`hariAnchor`) yang jadi acuan setiap bulan,
 * jadi urutannya 31 Jan, 28 Feb, 31 Mar, 30 Apr — kembali begitu bulannya
 * cukup panjang.
 *
 * Seluruhnya di UTC, sesuai aturan tanggal di repo ini: `Date` waktu lokal
 * ditambah pembacaan UTC meleset sehari di sebagian zona.
 */
export function bulanKe(mulai: string, langkah: number, hariAnchor: number): string {
  const [y, m] = mulai.split('-').map(Number);
  const indeksBulan = m - 1 + langkah;
  const tahun = y + Math.floor(indeksBulan / 12);
  const bulan = ((indeksBulan % 12) + 12) % 12;

  // Hari 0 dari bulan berikutnya = hari terakhir bulan ini.
  const hariTerakhir = new Date(Date.UTC(tahun, bulan + 1, 0)).getUTCDate();
  return `${tahun}-${duaAngka(bulan + 1)}-${duaAngka(Math.min(hariAnchor, hariTerakhir))}`;
}

/**
 * Semua kemunculan tagihan dari `mulai` sampai `hingga`, inklusif kedua ujung.
 *
 * `mulai` yang sudah lewat TIDAK dilewati: tagihan yang jatuh tempo minggu lalu
 * dan belum dibayar memang masih harus dibayar, dan menyembunyikannya dari
 * proyeksi berarti memproyeksikan saldo yang lebih besar dari kenyataan.
 * Pemanggil yang ingin membedakan telat dari akan datang membandingkannya
 * sendiri dengan hari ini.
 *
 * `hariAnchor` hanya dipakai bulanan, dan defaultnya hari dari `mulai`.
 */
export function kemunculan(
  mulai: string,
  ulang: Ulang | null,
  hingga: string,
  hariAnchor?: number
): string[] {
  if (daysBetween(mulai, hingga) < 0) return [];
  if (!ulang) return [mulai];

  const hasil: string[] = [];

  if (ulang === 'monthly') {
    const anchor = hariAnchor ?? Number(mulai.split('-')[2]);
    for (let langkah = 0; hasil.length < BATAS_KEMUNCULAN; langkah++) {
      const tanggal = bulanKe(mulai, langkah, anchor);
      if (daysBetween(tanggal, hingga) < 0) break;
      hasil.push(tanggal);
    }
    return hasil;
  }

  let kini = mulai;
  while (daysBetween(kini, hingga) >= 0 && hasil.length < BATAS_KEMUNCULAN) {
    hasil.push(kini);
    const lanjut = advanceDate(kini, ulang);
    // Penjaga kemacetan: kalau `advanceDate` sampai mengembalikan tanggal yang
    // tidak maju, perulangannya berhenti alih-alih berputar selamanya.
    if (daysBetween(kini, lanjut) <= 0) break;
    kini = lanjut;
  }

  return hasil;
}

/**
 * Jatuh tempo berikutnya setelah satu periode dibayar.
 *
 * Harus memakai aturan yang sama dengan `kemunculan`, kalau tidak tanggal yang
 * diproyeksikan dan tanggal yang tersimpan akan berbeda — tagihan terlihat
 * jatuh tempo 31 Maret di proyeksi lalu tercatat 28 Maret setelah dibayar. Ada
 * ujinya yang membandingkan keduanya.
 *
 * `null` berarti tidak ada kemunculan berikutnya (tagihan sekali).
 */
export function majuJatuhTempo(
  jatuhTempo: string,
  ulang: Ulang | null,
  hariAnchor?: number | null
): string | null {
  if (!ulang) return null;
  if (ulang === 'monthly') {
    return bulanKe(jatuhTempo, 1, hariAnchor ?? Number(jatuhTempo.split('-')[2]));
  }
  return advanceDate(jatuhTempo, ulang);
}

/**
 * Kemunculan transaksi berulang yang memposting sendiri.
 *
 * SENGAJA memakai `advanceDate` berulang, termasuk hanyutnya di akhir bulan —
 * karena itu yang benar-benar dilakukan `processRecurringBudget` di index.ts.
 * Proyeksi yang "lebih benar" daripada mesinnya akan memperkirakan tanggal yang
 * tidak pernah terjadi, dan proyeksi yang tidak cocok dengan kenyataan lebih
 * buruk daripada proyeksi yang meniru cacatnya. Ada ujinya yang membandingkan
 * keluaran fungsi ini dengan `advanceDate` langsung.
 */
export function kemunculanBerulang(mulai: string, ulang: Ulang | null, hingga: string): string[] {
  if (daysBetween(mulai, hingga) < 0) return [];
  if (!ulang) return [mulai];

  const hasil: string[] = [];
  let kini = mulai;
  while (daysBetween(kini, hingga) >= 0 && hasil.length < BATAS_KEMUNCULAN) {
    hasil.push(kini);
    const lanjut = advanceDate(kini, ulang);
    if (daysBetween(kini, lanjut) <= 0) break;
    kini = lanjut;
  }
  return hasil;
}

export type SumberProyeksi = 'tagihan' | 'berulang' | 'hutang' | 'piutang';

export interface BarisProyeksi {
  tanggal: string;
  label: string;
  /** Bertanda: negatif keluar, positif masuk. */
  jumlah: number;
  sumber: SumberProyeksi;
}

export interface TitikProyeksi {
  tanggal: string;
  saldo: number;
}

export interface Proyeksi {
  saldoAwal: number;
  /** Saldo pada setiap tanggal yang ada pergerakannya, berurutan. */
  titik: TitikProyeksi[];
  /** Tanggal pertama saldo menembus nol; null berarti aman sepanjang horizon. */
  tanggalMinus: string | null;
  /** Saldo pada ujung horizon. */
  saldoAkhir: number;
  totalKeluar: number;
  totalMasuk: number;
  baris: BarisProyeksi[];
}

/**
 * Menjalankan saldo ke depan melewati seluruh pergerakan yang sudah diketahui.
 *
 * Yang dikembalikan bukan hanya angka akhir. `tanggalMinus` itu intinya: saldo
 * akhir yang positif masih bisa menyembunyikan satu minggu minus di
 * tengah-tengah, dan minggu itulah yang sebenarnya jadi masalah — tagihan yang
 * ditolak karena saldo tidak cukup tidak peduli bahwa gaji datang tiga hari
 * kemudian.
 *
 * Barisnya diurutkan per tanggal. Dalam satu tanggal, uang keluar dihitung
 * LEBIH DULU daripada uang masuk: itu urutan yang paling tidak
 * menyenangkan, dan satu-satunya yang tidak akan menjanjikan saldo cukup
 * padahal pendebetan bisa datang sebelum transfernya masuk.
 *
 * Yang jatuh temponya sudah lewat DIJEPIT ke `mulai`, tidak dibuang dan tidak
 * dibiarkan pada tanggal aslinya. Membuangnya akan memproyeksikan saldo lebih
 * besar daripada kenyataan — uangnya masih terutang. Membiarkannya pada
 * tanggal asli membuat `tanggalMinus` menunjuk tanggal di masa lalu, yang tidak
 * bisa ditindaklanjuti. Keduanya salah; yang benar adalah "harus dibayar
 * sekarang".
 */
export function proyeksikanSaldo(
  saldoAwal: number,
  baris: BarisProyeksi[],
  mulai: string,
  hingga: string
): Proyeksi {
  const dipakai = baris
    .filter((b) => daysBetween(b.tanggal, hingga) >= 0)
    .map((b) => (daysBetween(mulai, b.tanggal) < 0 ? { ...b, tanggal: mulai } : b))
    // Tanggal ISO berurut sama secara leksikografis maupun kronologis.
    .sort((a, b) =>
      a.tanggal === b.tanggal
        ? a.jumlah - b.jumlah // keluar dulu, lalu masuk
        : a.tanggal < b.tanggal ? -1 : 1
    );

  const titik: TitikProyeksi[] = [];
  let saldo = saldoAwal;
  let tanggalMinus: string | null = null;
  let totalKeluar = 0;
  let totalMasuk = 0;

  for (const b of dipakai) {
    saldo += b.jumlah;
    if (b.jumlah < 0) totalKeluar += -b.jumlah;
    else totalMasuk += b.jumlah;

    if (saldo < 0 && tanggalMinus === null) tanggalMinus = b.tanggal;

    // Satu titik per tanggal: beberapa pergerakan pada hari yang sama
    // menghasilkan satu saldo penutup, bukan beberapa titik bertumpuk.
    const terakhir = titik[titik.length - 1];
    if (terakhir && terakhir.tanggal === b.tanggal) terakhir.saldo = saldo;
    else titik.push({ tanggal: b.tanggal, saldo });
  }

  return {
    saldoAwal,
    titik,
    tanggalMinus,
    saldoAkhir: saldo,
    totalKeluar,
    totalMasuk,
    baris: dipakai,
  };
}

/** Baris proyeksi dari satu tagihan terjadwal. */
export function barisDariTagihan(
  tagihan: {
    id: string;
    nama: string;
    jumlah_idr: number;
    jatuh_tempo: string;
    ulang: string | null;
    jenis: string;
    hari_anchor?: number | null;
  },
  hingga: string
): BarisProyeksi[] {
  const ulang = ULANG_SAH.includes(tagihan.ulang as Ulang) ? (tagihan.ulang as Ulang) : null;
  const tanda = tagihan.jenis === 'income' ? 1 : -1;
  // Baris lama tanpa anchor jatuh kembali ke hari `jatuh_tempo`-nya sendiri.
  const anchor = tagihan.hari_anchor ?? undefined;

  return kemunculan(tagihan.jatuh_tempo, ulang, hingga, anchor).map((tanggal) => ({
    tanggal,
    label: tagihan.nama,
    jumlah: tanda * Math.abs(tagihan.jumlah_idr),
    sumber: 'tagihan' as const,
  }));
}

/**
 * Baris proyeksi dari transaksi berulang yang memposting sendiri.
 *
 * Ini yang membuat proyeksinya jujur. Autodebet akan benar-benar menggeser
 * saldo, jadi proyeksi yang mengabaikannya akan memperkirakan saldo lebih besar
 * daripada yang akan terjadi — arah yang paling berbahaya untuk salah.
 */
export function barisDariBerulang(
  template: {
    id: string;
    type: string;
    amount_idr: number;
    category: string;
    note: string | null;
    recurrence: string;
    next_recurrence_date: string;
  },
  hingga: string
): BarisProyeksi[] {
  const ulang = ULANG_SAH.includes(template.recurrence as Ulang)
    ? (template.recurrence as Ulang)
    : null;
  const tanda = template.type === 'income' ? 1 : -1;

  return kemunculanBerulang(template.next_recurrence_date, ulang, hingga).map((tanggal) => ({
    tanggal,
    label: template.note || template.category,
    jumlah: tanda * Math.abs(template.amount_idr),
    sumber: 'berulang' as const,
  }));
}

/**
 * Baris proyeksi dari utang dan piutang yang belum lunas.
 *
 * Tandanya dibalik antara keduanya, dan itu justru jenis kesalahan yang paling
 * sering lolos di modul ini: `debts` menyimpan dua hal berlawanan di baris yang
 * bentuknya sama, dibedakan hanya oleh satu kolom. Utang mengurangi, piutang
 * menambah — keduanya diuji terpisah.
 */
export function barisDariHutang(hutang: {
  id: string;
  type: string;
  person_name: string;
  amount_idr: number;
  due_date: string;
}): BarisProyeksi[] {
  const piutang = hutang.type === 'receivable';
  return [
    {
      tanggal: hutang.due_date,
      label: piutang ? `Piutang ${hutang.person_name}` : `Utang ${hutang.person_name}`,
      jumlah: (piutang ? 1 : -1) * Math.abs(hutang.amount_idr),
      sumber: piutang ? 'piutang' : 'hutang',
    },
  ];
}
