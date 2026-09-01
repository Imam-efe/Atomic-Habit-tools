/**
 * animals.ts — katalog hewan peliharaan & produksi untuk rumah tangga
 * Indonesia.
 *
 * Bundled, bukan tabel D1 yang di-seed. Alasannya sama persis dengan
 * `data/plants.ts` dan `frontend/src/data/holidays.ts`: data referensi yang
 * jarang berubah, ditulis tangan dan ditinjau seperti kode, harus tetap benar
 * tanpa bergantung pada migrasi yang berjalan, dan menyimpannya di sini
 * menghindari seed besar di skrip migrate yang jalan tiap deploy.
 *
 * Gelombang pertama: delapan spesies yang mewakili tiap golongan (mamalia,
 * unggas, ikan tawar, ikan laut, reptil), bukan seluruh ~65 yang direncanakan.
 * Bentuk datanya harus terbukti dulu lewat sampel ini — menulis 65 entri
 * sebelum bentuknya teruji berarti 65 entri yang harus diedit ulang begitu
 * ada kolom yang ternyata salah bentuk.
 */

export type AnimalGroup =
  | 'mamalia' | 'unggas' | 'ikan-tawar' | 'ikan-laut'
  | 'reptil' | 'amfibi' | 'ternak-besar' | 'serangga';

export type Habitat = 'darat' | 'air-tawar' | 'air-payau' | 'air-laut';
export type Peran = 'peliharaan' | 'produksi' | 'keduanya';
export type Kesulitan = 'mudah' | 'sedang' | 'sulit';
export type Sosial = 'sendiri' | 'berpasangan' | 'berkelompok';

export interface TugasKatalog {
  /** Kode stabil, dipakai sebagai kunci di log dan tabel override. */
  kode: string;
  nama: string;
  /** Interval ulang, hari. */
  tiapHari: number;
  /**
   * Jeda dari tanggal masuk sebelum tagihan pertama.
   *
   * Bukan sekadar kenyamanan: anak kucing umur tiga minggu belum boleh
   * divaksin, dan menagihnya di hari ia dicatat adalah saran yang salah
   * secara medis.
   */
  mulaiHari: number;
  /**
   * Menempel ke wadah atau ke ekor.
   *
   * Ini satu-satunya tempat pencegahan "delapan guppy ditagih delapan kali
   * ganti air" perlu ditulis.
   */
  sasaran: 'kandang' | 'hewan';
  /** Instruksi konkret. Bukan "rawat dengan baik". */
  cara: string;
  /** true = kelalaian berujung mati, bukan cuma kurang bagus. */
  penting: boolean;
}

export interface Animal {
  /** Slug stabil — foreign key di ternak_hewan. */
  id: string;
  nama: string;
  latin: string;
  grup: AnimalGroup;
  habitat: Habitat;
  emoji: string;
  peran: Peran;
  /** Harapan hidup, tahun: [terpendek, terpanjang]. */
  umurTahun: [number, number];
  /** Umur dewasa, bulan; null bila tidak relevan. */
  dewasaBulan: number | null;
  /** Rentang suhu ideal; null untuk hewan darat non-terarium. */
  suhuC: [number, number] | null;
  /** Rentang pH air; null untuk hewan darat. */
  phAir: [number, number] | null;
  /** Salinitas, ppt; hanya untuk habitat laut dan payau. */
  salinitasPpt: [number, number] | null;
  ruangMinimal: string;
  /**
   * Kebutuhan ruang per ekor dalam liter; null bila tidak bisa dinyatakan
   * sebagai volume — kucing, kambing, dan ayam umbaran tidak diukur begitu.
   *
   * Dipisah dari `ruangMinimal` yang berupa kalimat. Kalimat berguna dibaca
   * manusia, angka berguna dihitung mesin, dan `cekKepadatan` butuh yang
   * kedua. Menurunkan angkanya dari kalimat lewat penguraian teks adalah cara
   * paling rapuh untuk mendapat sesuatu yang sudah kita ketahui saat
   * menulisnya.
   */
  literPerEkor: number | null;
  pakan: string;
  frekuensiPakan: string;
  sosial: Sosial;
  tugas: TugasKatalog[];
  penyakit: string[];
  kesulitan: Kesulitan;
  /**
   * Status hukum di Indonesia; null berarti bebas dipelihara.
   *
   * Sugar glider, sebagian kura-kura, dan banyak burung kicau masuk daftar
   * dilindungi atau butuh izin penangkaran. Katalog yang diam soal ini
   * mengajak penggunanya melanggar hukum tanpa tahu.
   */
  legal: string | null;
  /**
   * Risiko bagi manusia; null berarti tidak ada yang perlu diperingatkan.
   *
   * Zoonosis nyata: kura-kura brazil pembawa salmonella, dan itu sangat
   * relevan di rumah yang ada anak kecilnya. Kolom ini sejajar dengan
   * `toxic` pada tanaman hias di data/plants.ts — nilainya selalu diisi
   * eksplisit, tidak pernah dibiarkan kosong lalu diartikan "aman".
   */
  bahaya: string | null;
  tips: string;
}

export const ANIMALS: Animal[] = [
  // ────────────────────────── MAMALIA ──────────────────────────
  {
    id: 'kucing-domestik',
    nama: 'Kucing domestik',
    latin: 'Felis catus',
    grup: 'mamalia',
    habitat: 'darat',
    emoji: '🐱',
    peran: 'peliharaan',
    umurTahun: [12, 18],
    dewasaBulan: 12,
    suhuC: null,
    phAir: null,
    salinitasPpt: null,
    ruangMinimal: 'Bebas di dalam rumah; kandang jepit hanya untuk transport.',
    // Bukan diukur per liter: kucing berkeliaran, bukan menempati volume tetap.
    literPerEkor: null,
    pakan: 'Pakan kucing kering atau basah, protein hewani di atas 30%.',
    frekuensiPakan: '2-3 kali sehari untuk dewasa, sekenyangnya untuk anak.',
    sosial: 'sendiri',
    tugas: [
      {
        kode: 'vaksin',
        nama: 'Vaksin tahunan',
        tiapHari: 365,
        mulaiHari: 56,
        sasaran: 'hewan',
        cara: 'Vaksin tricat atau tetracat ke dokter hewan. Seri pertama umur 8-12 minggu, booster 3-4 minggu setelahnya, lalu ulang tiap tahun.',
        penting: true,
      },
      {
        kode: 'cacing',
        nama: 'Obat cacing',
        tiapHari: 90,
        mulaiHari: 42,
        sasaran: 'hewan',
        cara: 'Dosis mengikuti berat badan. Kucing yang keluar rumah lebih sering cacingan daripada yang di dalam terus.',
        penting: true,
      },
      {
        kode: 'kutu',
        nama: 'Obat kutu',
        tiapHari: 30,
        mulaiHari: 56,
        sasaran: 'hewan',
        cara: 'Spot-on di tengkuk, tempat yang tidak terjilat. Kutu membawa cacing pita, jadi keduanya sering datang bersamaan.',
        penting: false,
      },
      {
        kode: 'kuku',
        nama: 'Potong kuku',
        tiapHari: 21,
        mulaiHari: 60,
        sasaran: 'hewan',
        cara: 'Potong ujung bening saja; bagian merah muda di dalamnya berisi pembuluh darah dan saraf.',
        penting: false,
      },
      {
        kode: 'timbang',
        nama: 'Timbang berat',
        tiapHari: 30,
        mulaiHari: 7,
        sasaran: 'hewan',
        cara: 'Turun berat tanpa sebab adalah gejala paling awal ginjal dan tiroid bermasalah, jauh sebelum terlihat sakit.',
        penting: false,
      },
      {
        kode: 'litter',
        nama: 'Ganti pasir kotoran',
        tiapHari: 7,
        mulaiHari: 0,
        sasaran: 'kandang',
        cara: 'Buang gumpalan tiap hari, kuras dan cuci total tiap pekan. Kucing menahan buang air di litter kotor sampai jadi masalah saluran kemih.',
        penting: false,
      },
    ],
    penyakit: ['flu kucing', 'scabies', 'FIV', 'gagal ginjal kronis'],
    kesulitan: 'mudah',
    legal: null,
    bahaya: 'Cakaran bisa menularkan cat scratch disease. Kotorannya membawa toksoplasma — ibu hamil sebaiknya tidak membersihkan litter.',
    tips: 'Sterilisasi menurunkan risiko kanker dan menghentikan kebiasaan menyemprot penanda wilayah.',
  },
  {
    id: 'kelinci',
    nama: 'Kelinci',
    latin: 'Oryctolagus cuniculus',
    grup: 'mamalia',
    habitat: 'darat',
    emoji: '🐰',
    peran: 'peliharaan',
    umurTahun: [8, 12],
    dewasaBulan: 6,
    suhuC: null,
    phAir: null,
    salinitasPpt: null,
    ruangMinimal: 'Kandang minimal 1 x 0,6 m ditambah waktu bebas berlari di luar kandang tiap hari.',
    // Kelinci butuh ruang untuk berlari, bukan sekadar volume kandang — angka
    // liter tidak menangkap kebutuhan itu, jadi tidak dipaksakan.
    literPerEkor: null,
    pakan: 'Rumput/hay timothy sepanjang hari, pelet kelinci secukupnya, sayur segar harian.',
    frekuensiPakan: 'Hay tersedia terus-menerus; pelet dan sayur 1-2 kali sehari.',
    sosial: 'berpasangan',
    tugas: [
      {
        kode: 'vaksin',
        nama: 'Vaksin RHD dan myxomatosis',
        tiapHari: 365,
        mulaiHari: 70,
        sasaran: 'hewan',
        cara: 'Vaksin ke dokter hewan mulai umur 10 minggu, diulang tiap tahun. Wabah RHD menyebar cepat dan sering fatal dalam hitungan jam.',
        penting: true,
      },
      {
        kode: 'kuku',
        nama: 'Potong kuku',
        tiapHari: 28,
        mulaiHari: 60,
        sasaran: 'hewan',
        cara: 'Potong ujung bening saja sedikit demi sedikit. Kuku yang terlalu panjang bikin kaki terpelintir saat kelinci melompat.',
        penting: false,
      },
      {
        kode: 'gigi-cek',
        nama: 'Cek gigi',
        tiapHari: 90,
        mulaiHari: 90,
        sasaran: 'hewan',
        cara: 'Periksa gigi depan dari luar mulut untuk lihat apakah tumbuh terlalu panjang. Gigi kelinci tumbuh terus seumur hidup dan harus terkikis oleh hay kasar.',
        penting: true,
      },
      {
        kode: 'bersih-kandang',
        nama: 'Bersihkan kandang',
        tiapHari: 3,
        mulaiHari: 0,
        sasaran: 'kandang',
        cara: 'Buang sisa hay dan kotoran, ganti alas. Kandang lembap dan kotor memicu sore hocks (luka telapak kaki) dan infeksi saluran napas.',
        penting: false,
      },
    ],
    penyakit: ['RHD', 'myxomatosis', 'sore hocks', 'stasis usus'],
    kesulitan: 'sedang',
    legal: null,
    bahaya: 'Gigitan jarang, tapi cakaran kaki belakang saat meronta bisa melukai cukup dalam.',
    tips: 'Jangan pernah kasih pelet sebagai makanan utama — hay harus jadi porsi terbesar, atau usus kelinci berhenti bergerak (stasis) dan itu darurat.',
  },

  // ────────────────────────── UNGGAS ──────────────────────────
  {
    id: 'ayam-kampung',
    nama: 'Ayam kampung',
    latin: 'Gallus gallus domesticus',
    grup: 'unggas',
    habitat: 'darat',
    emoji: '🐔',
    peran: 'keduanya',
    umurTahun: [5, 8],
    dewasaBulan: 5,
    suhuC: null,
    phAir: null,
    salinitasPpt: null,
    ruangMinimal: 'Kandang umbaran minimal 1 m² per ekor plus akses area terbuka siang hari.',
    // Ayam umbaran diberi ruang gerak, bukan volume tetap seperti akuarium.
    literPerEkor: null,
    pakan: 'Campuran jagung giling, dedak, dan konsentrat; boleh ditambah sisa dapur secukupnya.',
    frekuensiPakan: '2 kali sehari, pagi dan sore.',
    sosial: 'berkelompok',
    tugas: [
      {
        kode: 'vaksin-nd',
        nama: 'Vaksin ND (tetelo)',
        tiapHari: 120,
        mulaiHari: 4,
        sasaran: 'hewan',
        cara: 'Vaksin ND tetes mata/hidung atau suntik lewat mantri ternak, mulai umur 4 hari lalu diulang tiap 3-4 bulan. Tetelo menular cepat dan bisa memusnahkan satu kandang dalam beberapa hari.',
        penting: true,
      },
      {
        kode: 'cacing',
        nama: 'Obat cacing',
        tiapHari: 90,
        mulaiHari: 60,
        sasaran: 'hewan',
        cara: 'Obat cacing unggas dicampur air minum atau pakan sesuai dosis kemasan. Ayam umbaran yang mengais tanah jauh lebih sering cacingan daripada yang dikandang penuh.',
        penting: true,
      },
      {
        kode: 'bersih-kandang',
        nama: 'Bersihkan kandang',
        tiapHari: 7,
        mulaiHari: 0,
        sasaran: 'kandang',
        cara: 'Buang alas litter lama, jemur lantai kandang, ganti dengan sekam kering baru. Litter basah dan menumpuk memicu amonia tinggi yang merusak saluran napas ayam.',
        penting: false,
      },
      {
        kode: 'telur-ambil',
        nama: 'Ambil telur',
        tiapHari: 1,
        mulaiHari: 150,
        sasaran: 'kandang',
        cara: 'Ambil telur dari sarang tiap hari supaya tidak ditumpuk-erami sembarangan atau dipatuk-pecah oleh ayam lain.',
        penting: false,
      },
    ],
    penyakit: ['ND (tetelo)', 'flu burung', 'berak kapur (pullorum)', 'cacingan'],
    kesulitan: 'sedang',
    legal: null,
    bahaya: 'Kotoran dan bulu bisa membawa salmonella serta jamur pemicu alergi pernapasan; cuci tangan setelah kontak dengan kandang.',
    tips: 'Pisahkan ayam baru dari kelompok lama minimal dua minggu sebelum digabung — banyak wabah tetelo berasal dari ayam baru yang belum menunjukkan gejala.',
  },
  {
    id: 'lovebird',
    nama: 'Lovebird',
    latin: 'Agapornis spp.',
    grup: 'unggas',
    habitat: 'darat',
    emoji: '🦜',
    peran: 'peliharaan',
    umurTahun: [10, 15],
    dewasaBulan: 10,
    suhuC: [20, 30],
    phAir: null,
    salinitasPpt: null,
    ruangMinimal: 'Sangkar minimal 40 x 40 x 50 cm untuk sepasang, dengan jarak jeruji maksimal 1,2 cm.',
    literPerEkor: 60,
    pakan: 'Millet/biji-bijian campuran, sayur dan buah segar (jagung muda, kangkung, apel), sotong/grit sebagai sumber kalsium.',
    frekuensiPakan: '1-2 kali sehari, air minum diganti tiap hari.',
    sosial: 'berpasangan',
    tugas: [
      {
        kode: 'bersih-sangkar',
        nama: 'Bersihkan sangkar',
        tiapHari: 3,
        mulaiHari: 0,
        sasaran: 'kandang',
        cara: 'Ganti alas dasar sangkar, cuci tempat pakan dan minum dengan sabun lalu bilas bersih. Sisa pakan basah cepat berjamur di iklim lembap.',
        penting: false,
      },
      {
        kode: 'kuku-paruh',
        nama: 'Cek kuku dan paruh',
        tiapHari: 30,
        mulaiHari: 60,
        sasaran: 'hewan',
        cara: 'Periksa panjang kuku dan paruh; kerik atau kikir tipis kalau sudah terlalu panjang untuk mencengkeram tangkringan dengan nyaman.',
        penting: false,
      },
      {
        kode: 'jemur',
        nama: 'Jemur pagi',
        tiapHari: 1,
        mulaiHari: 14,
        sasaran: 'hewan',
        cara: 'Jemur sangkar di bawah sinar matahari pagi 15-30 menit sebelum jam 9. Sinar matahari langsung membantu pembentukan vitamin D untuk penyerapan kalsium.',
        penting: false,
      },
    ],
    penyakit: ['snot (pilek burung)', 'bulu kusam/mencabut bulu', 'kutu bulu'],
    kesulitan: 'mudah',
    legal: null,
    bahaya: 'Kotoran kering yang menjadi debu bisa memicu psittacosis pada manusia dalam kasus jarang; hindari mengocok alas sangkar kering di ruang tertutup.',
    tips: 'Lovebird gigitannya cukup sakit dan sifatnya teritorial — dua ekor sebaiknya tidak digabung satu sangkar kalau belum saling kenal.',
  },

  // ────────────────────────── IKAN TAWAR ──────────────────────────
  {
    id: 'cupang',
    nama: 'Cupang',
    latin: 'Betta splendens',
    grup: 'ikan-tawar',
    habitat: 'air-tawar',
    emoji: '🐟',
    peran: 'peliharaan',
    umurTahun: [2, 4],
    dewasaBulan: 4,
    suhuC: [24, 28],
    phAir: [6.5, 7.5],
    salinitasPpt: null,
    ruangMinimal: 'Wadah minimal 5 liter dengan penutup — cupang jantan bisa melompat keluar.',
    literPerEkor: 5,
    pakan: 'Pelet cupang atau cacing sutra/beku, protein tinggi.',
    frekuensiPakan: '1-2 kali sehari, secukupnya habis dalam 2 menit.',
    sosial: 'sendiri',
    tugas: [
      {
        kode: 'ganti-air',
        nama: 'Ganti air',
        tiapHari: 3,
        mulaiHari: 0,
        sasaran: 'kandang',
        cara: 'Ganti 30-50% air dengan air yang sudah diendapkan/didiamkan minimal 24 jam agar klorin menguap. Wadah tanpa filter perlu ganti air lebih sering daripada yang berfilter.',
        penting: true,
      },
      {
        kode: 'bersih-wadah',
        nama: 'Bersihkan sisa pakan dan kotoran',
        tiapHari: 1,
        mulaiHari: 0,
        sasaran: 'kandang',
        cara: 'Sifon dasar wadah dengan selang kecil untuk angkat sisa pakan yang membusuk. Sisa pakan yang menumpuk adalah sumber amonia utama di wadah kecil tanpa filter.',
        penting: false,
      },
    ],
    penyakit: ['fin rot (busuk sirip)', 'ich (bintik putih)', 'jamur mulut'],
    kesulitan: 'mudah',
    legal: null,
    bahaya: null,
    tips: 'Cupang jantan tidak boleh disatukan dengan cupang jantan lain dalam satu wadah — akan bertarung sampai luka parah atau mati.',
  },
  {
    id: 'koi',
    nama: 'Koi',
    latin: 'Cyprinus rubrofuscus',
    grup: 'ikan-tawar',
    habitat: 'air-tawar',
    emoji: '🎏',
    peran: 'peliharaan',
    umurTahun: [25, 40],
    dewasaBulan: 24,
    suhuC: [20, 27],
    phAir: [7.0, 8.0],
    salinitasPpt: null,
    ruangMinimal: 'Kolam minimal 1000 liter dengan kedalaman 80 cm ke atas; koi tumbuh besar dan butuh volume banyak.',
    literPerEkor: 1000,
    pakan: 'Pelet koi mengapung, porsi protein disesuaikan musim (lebih tinggi saat suhu hangat).',
    frekuensiPakan: '2-3 kali sehari saat suhu air di atas 15°C; dikurangi drastis saat dingin.',
    sosial: 'berkelompok',
    tugas: [
      {
        kode: 'tes-air',
        nama: 'Tes kualitas air',
        tiapHari: 7,
        mulaiHari: 0,
        sasaran: 'kandang',
        cara: 'Tes amonia, nitrit, dan pH pakai test kit tetes. Kolam besar menyembunyikan pencemaran air lebih lama daripada akuarium kecil sebelum ikan terlihat sakit.',
        penting: true,
      },
      {
        kode: 'ganti-air',
        nama: 'Ganti sebagian air kolam',
        tiapHari: 14,
        mulaiHari: 0,
        sasaran: 'kandang',
        cara: 'Ganti 10-20% volume kolam dengan air baru yang sudah diendapkan. Jangan ganti total — mikroba baik di filter dan dasar kolam butuh waktu membangun ulang siklus nitrogen.',
        penting: false,
      },
      {
        kode: 'bersih-filter',
        nama: 'Bersihkan media filter',
        tiapHari: 30,
        mulaiHari: 0,
        sasaran: 'kandang',
        cara: 'Bilas spons/media filter dengan air kolam yang sudah diambil, bukan air keran — klorin di air keran membunuh bakteri baik yang menjaga air tetap jernih.',
        penting: false,
      },
    ],
    penyakit: ['kutu jangkar (anchor worm)', 'ulcer/borok kulit', 'aeromonas'],
    kesulitan: 'sedang',
    legal: null,
    bahaya: null,
    tips: 'Koi bisa hidup puluhan tahun dan tumbuh sampai 60-90 cm — kolam yang terlalu kecil akan membuat pertumbuhannya kerdil dan rentan sakit.',
  },

  // ────────────────────────── IKAN LAUT ──────────────────────────
  {
    id: 'ikan-badut',
    nama: 'Ikan badut',
    latin: 'Amphiprion ocellaris',
    grup: 'ikan-laut',
    habitat: 'air-laut',
    emoji: '🐠',
    peran: 'peliharaan',
    umurTahun: [6, 10],
    dewasaBulan: 12,
    suhuC: [24, 27],
    phAir: [8.0, 8.4],
    salinitasPpt: [33, 35],
    ruangMinimal: 'Akuarium laut minimal 75 liter, idealnya sudah matang siklus nitrogen minimal 4-6 minggu sebelum ikan masuk.',
    literPerEkor: 75,
    pakan: 'Pelet/flake khusus ikan laut, sesekali udang atau mysis beku.',
    frekuensiPakan: '2 kali sehari, secukupnya habis dalam 2-3 menit.',
    sosial: 'berpasangan',
    tugas: [
      {
        kode: 'ganti-air',
        nama: 'Ganti air laut',
        tiapHari: 14,
        mulaiHari: 0,
        sasaran: 'kandang',
        cara: 'Ganti 10-15% air dengan air laut buatan yang sudah dicampur garam khusus akuarium dan disesuaikan salinitasnya (ukur pakai refraktometer/hidrometer) sebelum dituang.',
        penting: true,
      },
      {
        kode: 'tes-air',
        nama: 'Tes parameter air',
        tiapHari: 7,
        mulaiHari: 0,
        sasaran: 'kandang',
        cara: 'Tes salinitas, pH, amonia, nitrit, dan nitrat dengan test kit khusus laut. Akuarium laut jauh lebih sensitif terhadap fluktuasi dibanding air tawar — perubahan kecil bisa fatal.',
        penting: true,
      },
    ],
    penyakit: ['ich laut (white spot)', 'brooklynella', 'infeksi bakteri sirip'],
    kesulitan: 'sulit',
    legal: null,
    bahaya: null,
    tips: 'Butuh anemon simbiosis untuk berperilaku alami, tapi anemon bukan syarat wajib untuk bertahan hidup — jangan dipaksakan kalau belum siap merawat anemon juga.',
  },

  // ────────────────────────── REPTIL ──────────────────────────
  {
    id: 'kura-kura-brazil',
    nama: 'Kura-kura brazil',
    latin: 'Trachemys scripta elegans',
    grup: 'reptil',
    habitat: 'air-tawar',
    emoji: '🐢',
    peran: 'peliharaan',
    umurTahun: [20, 30],
    dewasaBulan: 60,
    suhuC: [24, 28],
    phAir: [6.5, 7.5],
    salinitasPpt: null,
    ruangMinimal: 'Akuarium/paludarium minimal 150 liter untuk satu ekor dewasa, dengan area darat (basking) kering yang cukup luas untuk berjemur sepenuhnya.',
    literPerEkor: 150,
    pakan: 'Pelet kura-kura komersial, dilengkapi ikan kecil, udang, dan sayur seperti kangkung.',
    frekuensiPakan: 'Setiap hari untuk anakan, 3-4 kali seminggu untuk dewasa.',
    sosial: 'sendiri',
    tugas: [
      {
        kode: 'uvb',
        nama: 'Ganti lampu UVB',
        tiapHari: 180,
        mulaiHari: 0,
        sasaran: 'kandang',
        cara: 'Ganti tabung/lampu UVB tiap 6 bulan meski lampunya masih menyala terang. Output UVB meluruh jauh sebelum lampu itu benar-benar mati, jadi "masih menyala" bukan tanda ia masih memancarkan UVB yang cukup — kura-kura yang berjemur di bawah lampu habis UVB tetap berisiko penyakit tulang metabolik.',
        penting: true,
      },
      {
        kode: 'ganti-air',
        nama: 'Ganti air akuarium',
        tiapHari: 7,
        mulaiHari: 0,
        sasaran: 'kandang',
        cara: 'Ganti 25-50% air, sifon kotoran dasar, dan bersihkan filter. Kura-kura buang air besar langsung di air dan mengotorinya jauh lebih cepat daripada ikan seukurannya.',
        penting: true,
      },
      {
        kode: 'jemur',
        nama: 'Basking / jemur',
        tiapHari: 1,
        mulaiHari: 0,
        sasaran: 'hewan',
        cara: 'Pastikan area basking mencapai suhu 32-35°C dengan lampu pijar/basking terpisah dari lampu UVB, menyala penuh tiap siang hari.',
        penting: true,
      },
    ],
    penyakit: ['penyakit tulang metabolik (MBD)', 'infeksi mata/telinga', 'shell rot'],
    kesulitan: 'sedang',
    legal: 'Trachemys scripta elegans adalah spesies asing invasif — pelepasan ke perairan alami dilarang, dan sejumlah daerah membatasi perdagangannya. Periksa aturan daerah setempat sebelum memelihara atau menambah populasi.',
    bahaya: 'Pembawa salmonella pada kulit dan cangkangnya, ditularkan lewat kontak lalu tangan ke mulut. Selalu cuci tangan setelah memegang kura-kura atau membersihkan wadahnya, dan hindari kontak untuk anak balita.',
    tips: 'Tumbuh jauh lebih besar dari ukuran anakan yang biasa dijual (bisa sampai 30 cm) — ini alasan utama kura-kura ini sering "dilepas" ke sungai/danau, yang justru menjadi sumber masalah invasif di atas.',
  },
];

/** Peta id ke hewan, supaya pencarian per id tidak menyapu seluruh larik. */
export const ANIMAL_BY_ID: Map<string, Animal> = new Map(ANIMALS.map((a) => [a.id, a]));
