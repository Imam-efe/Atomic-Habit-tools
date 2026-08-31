/**
 * Pranata Mangsa — kalender musim Jawa, dua belas mangsa.
 *
 * Disusun jauh sebelum ditetapkan resmi pada 1855 dan masih dipakai pekebun di
 * Jawa Tengah dan DIY sampai sekarang. Penelitian curah hujan modern menemukan
 * pembagiannya memang sejalan dengan pola hujan nyata, jadi ini bukan hiasan
 * budaya: ia panduan waktu tanam yang bisa diuji.
 *
 * Data referensi, ditulis tangan dan ditinjau seperti kode — sama seperti
 * data/plants.ts dan frontend/src/data/holidays.ts. Tidak di-seed ke D1:
 * tanggalnya tidak pernah berubah, dan menyimpannya di sini membuatnya tetap
 * benar tanpa bergantung pada migrasi yang berjalan.
 *
 * Ia melengkapi garden_season.ts, tidak menggantikannya. garden_season.ts
 * membagi setahun jadi dua (hujan/kemarau) untuk mencocokkan kolom `season`
 * katalog; mangsa membaginya jadi dua belas dan memberi tahu apa yang
 * dikerjakan pada tiap potongan.
 */

export type MusimMangsa = 'ketiga' | 'labuh' | 'rendheng' | 'mareng';

export interface Mangsa {
  urutan: number;
  nama: string;
  /** MM-DD, inklusif. */
  mulai: string;
  /** MM-DD, inklusif. */
  selesai: string;
  hari: number;
  musim: MusimMangsa;
  pertanda: string;
  saran: string;
}

export const MANGSA: Mangsa[] = [
  {
    urutan: 1, nama: 'Kasa', mulai: '06-22', selesai: '08-01', hari: 41, musim: 'ketiga',
    pertanda: 'Daun-daun berguguran, tanah mulai retak, udara malam terasa dingin.',
    saran: 'Musim kemarau dimulai. Waktunya membakar sisa panen jadi abu, memperbaiki bedengan, dan menanam palawija yang tahan kering. Jangan mulai tanaman berdaun lebar yang butuh air terus-menerus.',
  },
  {
    urutan: 2, nama: 'Karo', mulai: '08-02', selesai: '08-24', hari: 23, musim: 'ketiga',
    pertanda: 'Tanah makin keras dan pecah-pecah, pohon randu mulai berbuah.',
    saran: 'Puncak kering pertama. Utamakan mulsa tebal dan siram pagi buta. Cocok mengolah tanah dan menabur dolomit — hasilnya sempat meresap sebelum hujan datang.',
  },
  {
    urutan: 3, nama: 'Katelu', mulai: '08-25', selesai: '09-17', hari: 24, musim: 'ketiga',
    pertanda: 'Rebung bermunculan, daun randu tumbuh kembali.',
    saran: 'Kemarau masih penuh. Waktu terbaik memanen umbi dan rimpang — jahe, kunyit, dan bawang menyimpan jauh lebih baik kalau dipanen dalam keadaan kering.',
  },
  {
    urutan: 4, nama: 'Kapat', mulai: '09-18', selesai: '10-12', hari: 25, musim: 'labuh',
    pertanda: 'Sumur menyusut, kapuk mulai merekah, burung membuat sarang.',
    saran: 'Peralihan menuju hujan. Siapkan persemaian sekarang supaya bibit siap pindah tepat saat hujan pertama. Perbaiki saluran air sebelum ia dibutuhkan.',
  },
  {
    urutan: 5, nama: 'Kalima', mulai: '10-13', selesai: '11-08', hari: 27, musim: 'labuh',
    pertanda: 'Hujan pertama turun, mangga berbunga, ulat bermunculan.',
    saran: 'Hujan mulai. Saat menanam paling baik sepanjang tahun untuk kebanyakan sayuran. Awasi ulat dan siput yang ikut bangun bersama hujan.',
  },
  {
    urutan: 6, nama: 'Kanem', mulai: '11-09', selesai: '12-21', hari: 43, musim: 'labuh',
    pertanda: 'Buah-buahan mulai matang, hujan makin sering, banyak petir.',
    saran: 'Puncak musim tanam. Beri pupuk susulan sekarang mumpung tanah lembap. Panen buah musiman. Pasang ajir sebelum angin kencang datang.',
  },
  {
    urutan: 7, nama: 'Kapitu', mulai: '12-22', selesai: '02-02', hari: 43, musim: 'rendheng',
    pertanda: 'Hujan paling deras, sungai meluap, banyak penyakit tanaman.',
    saran: 'Puncak hujan sekaligus puncak risiko. Perbaiki drainase, jangan biarkan air menggenang di pot. Jamur dan busuk akar paling sering menyerang sekarang — kurangi kerapatan tanam dan buang daun bawah yang menempel tanah.',
  },
  {
    urutan: 8, nama: 'Kawolu', mulai: '02-03', selesai: '02-28', hari: 26, musim: 'rendheng',
    pertanda: 'Hujan masih sering, padi mulai berisi, banyak ulat dan tikus.',
    saran: 'Hujan mulai mereda tapi hama memuncak. Periksa tanaman tiap hari; ini mangsa yang menuntut pengamatan, bukan penanaman baru.',
  },
  {
    urutan: 9, nama: 'Kasanga', mulai: '03-01', selesai: '03-25', hari: 25, musim: 'rendheng',
    pertanda: 'Padi menguning, jangkrik bersuara, hujan mulai jarang.',
    saran: 'Akhir musim hujan. Waktunya memanen dan mulai menyimpan benih dari tanaman terbaik. Jangan mulai tanaman berumur panjang yang bergantung pada hujan.',
  },
  {
    urutan: 10, nama: 'Kasadasa', mulai: '03-26', selesai: '04-18', hari: 24, musim: 'mareng',
    pertanda: 'Panen raya, udara mulai kering, burung kembali bersarang.',
    saran: 'Peralihan menuju kemarau. Panen besar dan pengeringan benih. Mulai siapkan mulsa dan tampungan air hujan selagi masih ada yang bisa ditampung.',
  },
  {
    urutan: 11, nama: 'Dhesta', mulai: '04-19', selesai: '05-11', hari: 23, musim: 'mareng',
    pertanda: 'Hujan tinggal sesekali, embun tebal di pagi hari.',
    saran: 'Kemarau mendekat. Tanam yang berumur pendek saja — kangkung, bayam, sawi — supaya sempat dipanen sebelum air jadi mahal.',
  },
  {
    urutan: 12, nama: 'Sadha', mulai: '05-12', selesai: '06-21', hari: 41, musim: 'mareng',
    pertanda: 'Air mulai surut, udara dingin di malam hari, kabut pagi.',
    saran: 'Ambang kemarau. Benahi bedengan, tambah kompos, dan rapikan naungan. Yang ditanam sekarang harus yang tahan kering atau yang sanggup disiram rutin.',
  },
];

/** Ubah 'MM-DD' jadi angka yang bisa dibandingkan: 622 untuk 22 Juni. */
function kunci(mmdd: string): number {
  return Number(mmdd.slice(0, 2)) * 100 + Number(mmdd.slice(3, 5));
}

/**
 * Mangsa yang berlaku pada satu tanggal.
 *
 * Perbandingan dilakukan pada MM-DD, bukan pada objek Date, supaya mangsa yang
 * melewati pergantian tahun (Kapitu, 22 Des – 2 Feb) tidak perlu diperlakukan
 * khusus di setiap pemanggil.
 */
export function mangsaPada(tanggal: string): Mangsa {
  const k = kunci(tanggal.slice(5, 10));

  for (const m of MANGSA) {
    const a = kunci(m.mulai);
    const b = kunci(m.selesai);
    // Mangsa yang membungkus akhir tahun punya mulai > selesai.
    const cocok = a <= b ? k >= a && k <= b : k >= a || k <= b;
    if (cocok) return m;
  }

  // Hanya tercapai pada 29 Februari: Kawolu berakhir 28 Februari, dan tabelnya
  // sengaja disimpan sebagai 365 hari supaya jumlahnya bisa diuji. Hari kabisat
  // itu milik Kawolu — mangsa yang memang sedang berjalan saat itu.
  return MANGSA[7];
}

/** Mangsa sesudah `m`, memutar kembali ke Kasa sesudah Sadha. */
export function mangsaBerikutnya(m: Mangsa): Mangsa {
  return MANGSA[m.urutan % MANGSA.length];
}

/**
 * Petakan empat musim mangsa ke dua musim yang dipakai kolom `season` katalog.
 *
 * Labuh (menjelang hujan) dihitung hujan dan mareng (menjelang kemarau)
 * dihitung kemarau: pada kedua peralihan itu, yang menentukan pilihan tanaman
 * adalah ke mana cuaca sedang menuju, bukan dari mana ia datang.
 */
export function musimMangsaKe(musim: MusimMangsa): 'hujan' | 'kemarau' {
  return musim === 'rendheng' || musim === 'labuh' ? 'hujan' : 'kemarau';
}
