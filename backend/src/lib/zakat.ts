/**
 * Zakat maal dan zakat penghasilan.
 *
 * Aplikasi ini sudah menyimpan semua bahannya: `net_worth_snapshots` mencatat
 * aset dan kewajiban tiap bulan, `budget_entries` mencatat pemasukan. Yang
 * belum ada hanyalah tiga aturan yang mengubah angka itu jadi jawaban —
 * nisab, haul, dan kadar.
 *
 * Yang tidak dilakukan berkas ini, dan itu disengaja:
 *
 *   Tidak berfatwa. Ada perbedaan pendapat yang nyata soal nisab zakat
 *   penghasilan (emas 85 gram vs perak 595 gram), soal apakah utang
 *   konsumtif mengurangi harta zakat, dan soal haul untuk penghasilan
 *   bulanan. Pilihan bawaan di sini adalah yang paling umum dipakai lembaga
 *   amil di Indonesia, dan semuanya bisa diubah pengguna — bukan disembunyikan
 *   sebagai kebenaran tunggal.
 *
 *   Tidak menebak harga emas. Harganya berubah tiap hari dan tidak ada sumber
 *   yang bisa dipanggil tanpa kunci API. Pengguna memasukkannya sendiri, dan
 *   tanggal terakhir diperbarui ikut ditampilkan supaya angka basi terlihat
 *   sebagai angka basi.
 */

/** Nisab emas: 85 gram emas murni. Dipakai lembaga amil di Indonesia. */
export const NISAB_GRAM_EMAS = 85;

/** Nisab perak: 595 gram. Lebih rendah, dipakai sebagian pendapat. */
export const NISAB_GRAM_PERAK = 595;

/** Kadar zakat maal dan penghasilan: 2,5%. */
export const KADAR_ZAKAT = 0.025;

/**
 * Panjang satu haul dalam hari.
 *
 * Satu tahun Hijriah, bukan Masehi: 354 hari. Memakai 365 menggeser jatuh
 * tempo sebelas hari tiap tahun, dan setelah beberapa tahun zakatnya
 * tertunaikan di bulan yang berbeda dari yang dimaksud.
 */
export const HAUL_HARI = 354;

export type JenisNisab = 'emas' | 'perak';

export interface HartaZakat {
  /** Kas, tabungan, dan setara kas. */
  kas: number;
  /** Nilai emas, perak, dan logam mulia yang disimpan. */
  logamMulia: number;
  /** Nilai investasi dan piutang yang diharapkan kembali. */
  investasi: number;
  /**
   * Utang jatuh tempo yang mengurangi harta.
   *
   * Yang dikurangkan hanya yang jatuh tempo dalam haul ini, bukan seluruh
   * sisa KPR dua puluh tahun — kalau seluruhnya dikurangkan, hampir tidak ada
   * orang berumah yang pernah wajib zakat, dan itu bukan yang dimaksud.
   */
  utangJatuhTempo: number;
}

export interface HasilZakatMaal {
  /** Harta bersih yang dihitung. */
  hartaBersih: number;
  /** Nilai nisab dalam rupiah pada harga logam yang dipakai. */
  nisabRupiah: number;
  wajib: boolean;
  /** Nol kalau belum mencapai nisab. */
  zakat: number;
  /** Berapa rupiah lagi sampai mencapai nisab; nol kalau sudah wajib. */
  kurang: number;
}

/** Jumlahkan harta lalu kurangi utang jatuh tempo. Tidak pernah negatif. */
export function hartaBersih(h: HartaZakat): number {
  const kotor = Math.max(0, h.kas) + Math.max(0, h.logamMulia) + Math.max(0, h.investasi);
  return Math.max(0, kotor - Math.max(0, h.utangJatuhTempo));
}

/** Nisab dalam rupiah dari harga per gram yang dimasukkan pengguna. */
export function nisabRupiah(hargaPerGram: number, jenis: JenisNisab): number {
  const gram = jenis === 'perak' ? NISAB_GRAM_PERAK : NISAB_GRAM_EMAS;
  return Math.max(0, hargaPerGram) * gram;
}

/**
 * Zakat maal atas harta yang sudah mengendap satu haul.
 *
 * Pembulatan ke rupiah penuh dilakukan ke ATAS. Membulatkan ke bawah berarti
 * membayar kurang dari yang terhitung, dan selisih beberapa ratus rupiah
 * tidak sebanding dengan keraguan itu.
 */
export function hitungZakatMaal(
  harta: HartaZakat,
  hargaPerGram: number,
  jenis: JenisNisab = 'emas'
): HasilZakatMaal {
  const bersih = hartaBersih(harta);
  const nisab = nisabRupiah(hargaPerGram, jenis);
  const wajib = nisab > 0 && bersih >= nisab;

  return {
    hartaBersih: bersih,
    nisabRupiah: nisab,
    wajib,
    zakat: wajib ? Math.ceil(bersih * KADAR_ZAKAT) : 0,
    kurang: wajib || nisab === 0 ? 0 : Math.ceil(nisab - bersih),
  };
}

export interface HasilZakatPenghasilan {
  /** Penghasilan yang dihitung, setelah pengurang kalau dipakai. */
  dasar: number;
  /** Nisab bulanan: nisab tahunan dibagi dua belas. */
  nisabBulanan: number;
  wajib: boolean;
  zakat: number;
}

/**
 * Zakat penghasilan bulanan.
 *
 * Dua pendapat yang beredar dan keduanya dipakai luas: dihitung dari
 * penghasilan KOTOR, atau dari penghasilan setelah dikurangi kebutuhan pokok.
 * Pilihannya diserahkan ke pengguna lewat `pengurang`; nol berarti kotor.
 *
 * Nisabnya dibandingkan per bulan — nisab setahun dibagi dua belas — karena
 * itulah cara lembaga amil di Indonesia menghitung zakat gaji bulanan.
 */
export function hitungZakatPenghasilan(
  penghasilanBulanan: number,
  hargaPerGram: number,
  pengurang = 0,
  jenis: JenisNisab = 'emas'
): HasilZakatPenghasilan {
  const dasar = Math.max(0, penghasilanBulanan - Math.max(0, pengurang));
  const nisabBulan = nisabRupiah(hargaPerGram, jenis) / 12;
  const wajib = nisabBulan > 0 && dasar >= nisabBulan;

  return {
    dasar,
    nisabBulanan: Math.ceil(nisabBulan),
    wajib,
    zakat: wajib ? Math.ceil(dasar * KADAR_ZAKAT) : 0,
  };
}

export interface StatusHaul {
  /** Tanggal harta pertama kali mencapai nisab, YYYY-MM-DD. */
  mulai: string;
  /** Tanggal haul genap. */
  jatuhTempo: string;
  /** Sisa hari; negatif berarti sudah lewat. */
  sisaHari: number;
  jatuhTempoHariIni: boolean;
  sudahLewat: boolean;
}

function geser(iso: string, hari: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + hari * 86400000).toISOString().slice(0, 10);
}

function selisih(dari: string, ke: string): number {
  const a = Date.parse(`${dari}T00:00:00Z`);
  const b = Date.parse(`${ke}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86400000);
}

/**
 * Kapan haul genap, dihitung dari tanggal harta mencapai nisab.
 *
 * Haul dihitung dari saat harta MENCAPAI nisab, bukan dari awal tahun atau
 * dari kapan pengguna mulai memakai aplikasi. Karena itu tanggal mulainya
 * disimpan sekali dan tidak dihitung ulang tiap bulan.
 */
export function statusHaul(mulai: string, hariIni: string): StatusHaul {
  const jatuhTempo = geser(mulai, HAUL_HARI);
  const sisaHari = selisih(hariIni, jatuhTempo);

  return {
    mulai,
    jatuhTempo,
    sisaHari,
    jatuhTempoHariIni: sisaHari === 0,
    sudahLewat: sisaHari < 0,
  };
}
