/**
 * Fixed-date commemorative days — the "what does today mark?" database.
 *
 * Separate from holidays.ts on purpose: a holiday is a day off and moves with
 * a government decree, while an observance is a date that means something and
 * almost never moves. Nothing here is a red date.
 *
 * Only genuinely fixed dates belong here. Anything that follows the lunar,
 * lunisolar, or liturgical calendar (Idul Fitri, Nyepi, Waisak, Paskah) moves
 * every year and lives in holidays.ts, where it is pinned per year.
 *
 * `note` is what makes a date worth tapping — the year, the person, or the
 * event behind it. Entries without a note are still listed, just briefly.
 */

export type ObservanceScope = 'nasional' | 'internasional';

export interface Observance {
  /** MM-DD */
  md: string;
  name: string;
  scope: ObservanceScope;
  note?: string;
}

export const OBSERVANCES: Observance[] = [
  // ---- Januari ----
  { md: '01-01', name: 'Hari Perdamaian Dunia', scope: 'internasional' },
  { md: '01-03', name: 'Hari Departemen Agama', scope: 'nasional', note: 'Kementerian Agama RI berdiri 3 Januari 1946.' },
  { md: '01-05', name: 'Hari Korps Wanita Angkatan Laut', scope: 'nasional' },
  { md: '01-10', name: 'Hari Lingkungan Hidup Indonesia', scope: 'nasional', note: 'Diperingati sejak 1993, bertepatan dengan berdirinya gerakan lingkungan nasional.' },
  { md: '01-10', name: 'Hari Gerakan Satu Juta Pohon', scope: 'nasional' },
  { md: '01-15', name: 'Hari Peristiwa Malari', scope: 'nasional', note: 'Malapetaka 15 Januari 1974, gelombang protes mahasiswa di Jakarta.' },
  { md: '01-25', name: 'Hari Gizi Nasional', scope: 'nasional', note: 'Menandai berdirinya Sekolah Juru Penerang Makanan pada 1951.' },
  { md: '01-27', name: 'Hari Peringatan Holocaust Internasional', scope: 'internasional' },

  // ---- Februari ----
  { md: '02-04', name: 'Hari Kanker Sedunia', scope: 'internasional' },
  { md: '02-09', name: 'Hari Pers Nasional', scope: 'nasional', note: 'Menandai berdirinya PWI pada 9 Februari 1946.' },
  { md: '02-13', name: 'Hari Radio Sedunia', scope: 'internasional' },
  { md: '02-14', name: 'Hari Peristiwa PETA Blitar', scope: 'nasional', note: 'Pemberontakan PETA pimpinan Supriyadi, 14 Februari 1945.' },
  { md: '02-20', name: 'Hari Pekerja Nasional', scope: 'nasional' },
  { md: '02-21', name: 'Hari Peduli Sampah Nasional', scope: 'nasional', note: 'Mengenang longsor TPA Leuwigajah 2005 yang menewaskan ratusan orang.' },
  { md: '02-21', name: 'Hari Bahasa Ibu Internasional', scope: 'internasional' },
  { md: '02-22', name: 'Hari Kepanduan Sedunia', scope: 'internasional' },
  { md: '02-28', name: 'Hari Gizi dan Makanan', scope: 'nasional' },

  // ---- Maret ----
  { md: '03-01', name: 'Hari Peringatan Serangan Umum 1 Maret', scope: 'nasional', note: 'Serangan Umum 1 Maret 1949 di Yogyakarta, bukti TNI masih berdiri.' },
  { md: '03-03', name: 'Hari Satwa Liar Sedunia', scope: 'internasional' },
  { md: '03-06', name: 'Hari Konvensi Ikan Paus', scope: 'internasional' },
  { md: '03-08', name: 'Hari Perempuan Internasional', scope: 'internasional' },
  { md: '03-09', name: 'Hari Musik Nasional', scope: 'nasional', note: 'Tanggal lahir W.R. Supratman, pencipta Indonesia Raya.' },
  { md: '03-11', name: 'Hari Supersemar', scope: 'nasional', note: 'Surat Perintah Sebelas Maret 1966.' },
  { md: '03-18', name: 'Hari Arsitektur Indonesia', scope: 'nasional' },
  { md: '03-20', name: 'Hari Dongeng Sedunia', scope: 'internasional' },
  { md: '03-21', name: 'Hari Hutan Sedunia', scope: 'internasional' },
  { md: '03-21', name: 'Hari Puisi Sedunia', scope: 'internasional' },
  { md: '03-22', name: 'Hari Air Sedunia', scope: 'internasional' },
  { md: '03-23', name: 'Hari Meteorologi Sedunia', scope: 'internasional' },
  { md: '03-24', name: 'Hari Tuberkulosis Sedunia', scope: 'internasional' },
  { md: '03-30', name: 'Hari Film Indonesia', scope: 'nasional', note: 'Syuting hari pertama "Darah dan Doa" (1950), film pertama karya anak bangsa.' },

  // ---- April ----
  { md: '04-01', name: 'Hari Bank Dunia', scope: 'internasional' },
  { md: '04-02', name: 'Hari Peduli Autisme Sedunia', scope: 'internasional' },
  { md: '04-06', name: 'Hari Nelayan Nasional', scope: 'nasional' },
  { md: '04-07', name: 'Hari Kesehatan Sedunia', scope: 'internasional', note: 'Menandai berdirinya WHO pada 1948.' },
  { md: '04-09', name: 'Hari Penerbangan Nasional', scope: 'nasional' },
  { md: '04-16', name: 'Hari Kopi Nasional', scope: 'nasional' },
  { md: '04-19', name: 'Hari Pertahanan Sipil', scope: 'nasional' },
  { md: '04-21', name: 'Hari Kartini', scope: 'nasional', note: 'Kelahiran R.A. Kartini, 21 April 1879, pelopor emansipasi perempuan Indonesia.' },
  { md: '04-22', name: 'Hari Bumi', scope: 'internasional' },
  { md: '04-23', name: 'Hari Buku Sedunia', scope: 'internasional' },
  { md: '04-24', name: 'Hari Angkutan Nasional', scope: 'nasional' },
  { md: '04-25', name: 'Hari Malaria Sedunia', scope: 'internasional' },
  { md: '04-26', name: 'Hari Kekayaan Intelektual Sedunia', scope: 'internasional' },
  { md: '04-28', name: 'Hari Puisi Nasional', scope: 'nasional', note: 'Mengenang wafatnya Chairil Anwar, 28 April 1949.' },

  // ---- Mei ----
  { md: '05-01', name: 'Hari Buruh Internasional', scope: 'internasional' },
  { md: '05-02', name: 'Hari Pendidikan Nasional', scope: 'nasional', note: 'Kelahiran Ki Hadjar Dewantara, pendiri Taman Siswa.' },
  { md: '05-03', name: 'Hari Kebebasan Pers Sedunia', scope: 'internasional' },
  { md: '05-05', name: 'Hari Bidan Internasional', scope: 'internasional' },
  { md: '05-08', name: 'Hari Palang Merah Sedunia', scope: 'internasional' },
  { md: '05-12', name: 'Hari Perawat Internasional', scope: 'internasional' },
  { md: '05-17', name: 'Hari Buku Nasional', scope: 'nasional', note: 'Menandai berdirinya Perpustakaan Nasional RI pada 1980.' },
  { md: '05-20', name: 'Hari Kebangkitan Nasional', scope: 'nasional', note: 'Berdirinya Budi Utomo, 20 Mei 1908.' },
  { md: '05-21', name: 'Hari Peringatan Reformasi', scope: 'nasional', note: 'Presiden Soeharto mengundurkan diri, 21 Mei 1998.' },
  { md: '05-22', name: 'Hari Keanekaragaman Hayati', scope: 'internasional' },
  { md: '05-29', name: 'Hari Lanjut Usia Nasional', scope: 'nasional' },
  { md: '05-31', name: 'Hari Tanpa Tembakau Sedunia', scope: 'internasional' },

  // ---- Juni ----
  { md: '06-01', name: 'Hari Lahir Pancasila', scope: 'nasional', note: 'Pidato Soekarno di sidang BPUPKI, 1 Juni 1945.' },
  { md: '06-03', name: 'Hari Pasar Modal Indonesia', scope: 'nasional' },
  { md: '06-05', name: 'Hari Lingkungan Hidup Sedunia', scope: 'internasional' },
  { md: '06-08', name: 'Hari Laut Sedunia', scope: 'internasional' },
  { md: '06-12', name: 'Hari Menentang Pekerja Anak Sedunia', scope: 'internasional' },
  { md: '06-14', name: 'Hari Donor Darah Sedunia', scope: 'internasional' },
  { md: '06-17', name: 'Hari Dermaga Nasional', scope: 'nasional' },
  { md: '06-20', name: 'Hari Pengungsi Sedunia', scope: 'internasional' },
  { md: '06-21', name: 'Hari Krida Pertanian', scope: 'nasional' },
  { md: '06-22', name: 'Hari Ulang Tahun Kota Jakarta', scope: 'nasional', note: 'Jayakarta diproklamasikan Fatahillah, 22 Juni 1527.' },
  { md: '06-24', name: 'Hari Bidan Nasional', scope: 'nasional' },
  { md: '06-26', name: 'Hari Anti Narkoba Internasional', scope: 'internasional' },
  { md: '06-29', name: 'Hari Keluarga Berencana Nasional', scope: 'nasional' },

  // ---- Juli ----
  { md: '07-01', name: 'Hari Bhayangkara', scope: 'nasional', note: 'Hari lahir Kepolisian Negara RI, 1 Juli 1946.' },
  { md: '07-05', name: 'Hari Bank Indonesia', scope: 'nasional' },
  { md: '07-09', name: 'Hari Satelit Palapa', scope: 'nasional', note: 'Peluncuran Palapa A1 pada 1976, awal telekomunikasi satelit Indonesia.' },
  { md: '07-11', name: 'Hari Populasi Sedunia', scope: 'internasional' },
  { md: '07-12', name: 'Hari Koperasi Indonesia', scope: 'nasional', note: 'Kongres Koperasi pertama di Tasikmalaya, 12 Juli 1947.' },
  { md: '07-17', name: 'Hari Keadilan Internasional', scope: 'internasional' },
  { md: '07-22', name: 'Hari Kejaksaan RI', scope: 'nasional' },
  { md: '07-23', name: 'Hari Anak Nasional', scope: 'nasional', note: 'Ditetapkan lewat Keppres No. 44/1984.' },
  { md: '07-29', name: 'Hari Bhakti TNI Angkatan Udara', scope: 'nasional' },
  { md: '07-30', name: 'Hari Persahabatan Internasional', scope: 'internasional' },

  // ---- Agustus ----
  { md: '08-05', name: 'Hari Dharma Wanita Nasional', scope: 'nasional' },
  { md: '08-08', name: 'Hari Ulang Tahun ASEAN', scope: 'internasional', note: 'Deklarasi Bangkok, 8 Agustus 1967.' },
  { md: '08-09', name: 'Hari Masyarakat Adat Internasional', scope: 'internasional' },
  { md: '08-10', name: 'Hari Veteran Nasional', scope: 'nasional' },
  { md: '08-12', name: 'Hari Remaja Internasional', scope: 'internasional' },
  { md: '08-14', name: 'Hari Pramuka', scope: 'nasional', note: 'Gerakan Pramuka diperkenalkan ke publik, 14 Agustus 1961.' },
  { md: '08-17', name: 'Proklamasi Kemerdekaan RI', scope: 'nasional', note: 'Soekarno–Hatta memproklamasikan kemerdekaan, 17 Agustus 1945.' },
  { md: '08-18', name: 'Hari Konstitusi Republik Indonesia', scope: 'nasional', note: 'UUD 1945 disahkan PPKI, 18 Agustus 1945.' },
  { md: '08-19', name: 'Hari Kemanusiaan Sedunia', scope: 'internasional' },
  { md: '08-21', name: 'Hari Maritim Nasional', scope: 'nasional' },
  { md: '08-24', name: 'Hari Televisi Republik Indonesia', scope: 'nasional', note: 'Siaran perdana TVRI, 24 Agustus 1962.' },

  // ---- September ----
  { md: '09-01', name: 'Hari Polisi Wanita', scope: 'nasional' },
  { md: '09-04', name: 'Hari Pelanggan Nasional', scope: 'nasional' },
  { md: '09-08', name: 'Hari Aksara Internasional', scope: 'internasional' },
  { md: '09-09', name: 'Hari Olahraga Nasional', scope: 'nasional', note: 'PON pertama digelar di Solo, 9 September 1948.' },
  { md: '09-11', name: 'Hari Radio Republik Indonesia', scope: 'nasional', note: 'RRI berdiri 11 September 1945.' },
  { md: '09-16', name: 'Hari Ozon Internasional', scope: 'internasional' },
  { md: '09-17', name: 'Hari Palang Merah Indonesia', scope: 'nasional' },
  { md: '09-21', name: 'Hari Perdamaian Internasional', scope: 'internasional' },
  { md: '09-24', name: 'Hari Tani Nasional', scope: 'nasional', note: 'Undang-Undang Pokok Agraria disahkan, 24 September 1960.' },
  { md: '09-26', name: 'Hari Statistik Nasional', scope: 'nasional' },
  { md: '09-28', name: 'Hari Kereta Api Indonesia', scope: 'nasional' },
  { md: '09-29', name: 'Hari Sarjana Nasional', scope: 'nasional' },
  { md: '09-30', name: 'Hari Peringatan G30S', scope: 'nasional', note: 'Gerakan 30 September 1965.' },

  // ---- Oktober ----
  { md: '10-01', name: 'Hari Kesaktian Pancasila', scope: 'nasional' },
  { md: '10-02', name: 'Hari Batik Nasional', scope: 'nasional', note: 'UNESCO mengakui batik sebagai Warisan Budaya Takbenda, 2 Oktober 2009.' },
  { md: '10-05', name: 'Hari Tentara Nasional Indonesia', scope: 'nasional', note: 'TKR dibentuk 5 Oktober 1945, cikal bakal TNI.' },
  { md: '10-05', name: 'Hari Guru Sedunia', scope: 'internasional' },
  { md: '10-10', name: 'Hari Kesehatan Jiwa Sedunia', scope: 'internasional' },
  { md: '10-14', name: 'Hari Penglihatan Sedunia', scope: 'internasional' },
  { md: '10-15', name: 'Hari Cuci Tangan Pakai Sabun Sedunia', scope: 'internasional' },
  { md: '10-16', name: 'Hari Pangan Sedunia', scope: 'internasional' },
  { md: '10-17', name: 'Hari Pengentasan Kemiskinan Internasional', scope: 'internasional' },
  { md: '10-24', name: 'Hari Perserikatan Bangsa-Bangsa', scope: 'internasional', note: 'Piagam PBB berlaku 24 Oktober 1945.' },
  { md: '10-27', name: 'Hari Listrik Nasional', scope: 'nasional' },
  { md: '10-28', name: 'Hari Sumpah Pemuda', scope: 'nasional', note: 'Kongres Pemuda II, 28 Oktober 1928 — satu nusa, satu bangsa, satu bahasa.' },
  { md: '10-29', name: 'Hari Stroke Sedunia', scope: 'internasional' },
  { md: '10-30', name: 'Hari Keuangan Nasional', scope: 'nasional' },

  // ---- November ----
  { md: '11-10', name: 'Hari Pahlawan', scope: 'nasional', note: 'Pertempuran Surabaya, 10 November 1945.' },
  { md: '11-12', name: 'Hari Kesehatan Nasional', scope: 'nasional' },
  { md: '11-14', name: 'Hari Diabetes Sedunia', scope: 'internasional' },
  { md: '11-16', name: 'Hari Toleransi Internasional', scope: 'internasional' },
  { md: '11-19', name: 'Hari Toilet Sedunia', scope: 'internasional' },
  { md: '11-20', name: 'Hari Anak Sedunia', scope: 'internasional' },
  { md: '11-21', name: 'Hari Pohon Sedunia', scope: 'internasional' },
  { md: '11-25', name: 'Hari Guru Nasional', scope: 'nasional', note: 'PGRI berdiri 25 November 1945.' },
  { md: '11-28', name: 'Hari Menanam Pohon Indonesia', scope: 'nasional' },

  // ---- Desember ----
  { md: '12-01', name: 'Hari AIDS Sedunia', scope: 'internasional' },
  { md: '12-03', name: 'Hari Disabilitas Internasional', scope: 'internasional' },
  { md: '12-04', name: 'Hari Artileri Nasional', scope: 'nasional' },
  { md: '12-05', name: 'Hari Relawan Internasional', scope: 'internasional' },
  { md: '12-09', name: 'Hari Antikorupsi Sedunia', scope: 'internasional' },
  { md: '12-10', name: 'Hari Hak Asasi Manusia Sedunia', scope: 'internasional' },
  { md: '12-12', name: 'Hari Cakupan Kesehatan Semesta', scope: 'internasional' },
  { md: '12-13', name: 'Hari Nusantara', scope: 'nasional', note: 'Deklarasi Djuanda, 13 Desember 1957, dasar konsep negara kepulauan.' },
  { md: '12-15', name: 'Hari Infanteri Nasional', scope: 'nasional' },
  { md: '12-19', name: 'Hari Bela Negara', scope: 'nasional', note: 'Pemerintahan Darurat RI dibentuk di Bukittinggi, 19 Desember 1948.' },
  { md: '12-20', name: 'Hari Solidaritas Kemanusiaan', scope: 'internasional' },
  { md: '12-22', name: 'Hari Ibu', scope: 'nasional', note: 'Kongres Perempuan Indonesia pertama, 22 Desember 1928.' },
  { md: '12-22', name: 'Hari Sosial Nasional', scope: 'nasional' },
];

const BY_MD = new Map<string, Observance[]>();
for (const o of OBSERVANCES) {
  const list = BY_MD.get(o.md);
  if (list) list.push(o);
  else BY_MD.set(o.md, [o]);
}

/** Observances on a date. `iso` is YYYY-MM-DD; the year is ignored. */
export function observancesOn(iso: string): Observance[] {
  return BY_MD.get(iso.slice(5)) ?? [];
}
