/**
 * Puasa sunnah: hari mana yang jatuh kapan.
 *
 * Dua yang paling rutin dijalani dan paling mudah terlewat justru karena
 * rutin: Senin-Kamis, dan Ayyamul Bidh pada 13, 14, 15 tiap bulan Hijriah.
 * Yang pertama gampang diingat; yang kedua tidak, karena tanggal Hijriah
 * tidak terlihat di kalender ponsel dan bergeser sebelas hari tiap tahun
 * terhadap kalender Masehi.
 *
 * Konversi Hijriahnya memakai algoritma tabular yang sama dengan kalender di
 * frontend, supaya satu tanggal tidak pernah tampil berbeda di dua layar.
 * Tabular berarti aritmetika, bukan rukyat: bisa meleset satu hari dari
 * penetapan pemerintah, dan itu disebutkan ke pengguna alih-alih disamarkan.
 */

export type JenisPuasa =
  | 'senin-kamis'
  | 'ayyamul-bidh'
  | 'daud'
  | 'arafah'
  | 'asyura'
  | 'syawal'
  | 'lainnya';

export const LABEL_PUASA: Record<JenisPuasa, string> = {
  'senin-kamis': 'Senin–Kamis',
  'ayyamul-bidh': 'Ayyamul Bidh',
  daud: 'Puasa Daud',
  arafah: 'Arafah',
  asyura: 'Asyura',
  syawal: 'Syawal',
  lainnya: 'Puasa sunnah',
};

const JENIS_DIKENAL = new Set<string>(Object.keys(LABEL_PUASA));

/**
 * Benar hanya untuk jenis puasa yang memang ada.
 *
 * Memakai `LABEL_PUASA[kind]` sebagai pemeriksaan tidak cukup: pencarian
 * properti juga menemukan kunci bawaan Object seperti `constructor` dan
 * `toString`, dan nilainya lolos uji "ada isinya". Akibatnya string sembarang
 * bisa tersimpan sebagai jenis puasa, lalu tampil tanpa label di layar.
 */
export function jenisPuasaDikenal(kind: unknown): kind is JenisPuasa {
  return typeof kind === 'string' && JENIS_DIKENAL.has(kind);
}

export interface HijriDate {
  day: number;
  month: number;
  year: number;
  monthName: string;
}

const HIJRI_MONTHS = [
  'Muharram', 'Safar', 'Rabiul Awal', 'Rabiul Akhir', 'Jumadil Awal', 'Jumadil Akhir',
  'Rajab', 'Syaban', 'Ramadhan', 'Syawal', 'Zulkaidah', 'Zulhijah',
];

function julianDay(year: number, month: number, day: number): number {
  let y = year;
  let m = month;
  if (m <= 2) {
    y -= 1;
    m += 12;
  }
  const a = Math.floor(y / 100);
  const b = 2 - a + Math.floor(a / 4);
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + day + b - 1524;
}

/** Tanggal Hijriah tabular dari tanggal Masehi YYYY-MM-DD. */
export function toHijri(iso: string): HijriDate {
  const [y, m, d] = iso.split('-').map(Number);
  const jd = julianDay(y, m, d);

  const days = jd - 1948440 + 10632;
  const n = Math.floor((days - 1) / 10631);
  const rem1 = days - 10631 * n + 354;
  const j =
    Math.floor((10985 - rem1) / 5316) * Math.floor((50 * rem1) / 17719) +
    Math.floor(rem1 / 5670) * Math.floor((43 * rem1) / 15238);
  const rem2 =
    rem1 -
    Math.floor((30 - j) / 15) * Math.floor((17719 * j) / 50) -
    Math.floor(j / 16) * Math.floor((15238 * j) / 43) +
    29;

  const month = Math.floor((24 * rem2) / 709);
  const day = rem2 - Math.floor((709 * month) / 24);
  const year = 30 * n + j - 30;

  return { day, month, year, monthName: HIJRI_MONTHS[Math.min(11, Math.max(0, month - 1))] };
}

export interface HariPuasa {
  date: string;
  kinds: JenisPuasa[];
  /** Nama harinya dalam bahasa Indonesia. */
  dayName: string;
  hijri: string;
}

const NAMA_HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

/** Hari dalam minggu dari YYYY-MM-DD, tanpa bergantung zona waktu perangkat. */
export function hariKe(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getUTCDay();
}

function geser(iso: string, hari: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + hari * 86400000).toISOString().slice(0, 10);
}

/**
 * Jenis puasa sunnah yang jatuh pada satu tanggal.
 *
 * Kosong berarti tidak ada. Satu tanggal bisa membawa lebih dari satu — 13
 * Zulhijah yang jatuh hari Kamis adalah Ayyamul Bidh sekaligus Senin-Kamis,
 * dan menyembunyikan salah satunya membuat daftar terasa keliru.
 *
 * Hari yang HARAM dipuasakan dikecualikan: Idulfitri (1 Syawal), Iduladha
 * (10 Zulhijah), dan hari tasyrik (11–13 Zulhijah). Menyarankan puasa di hari
 * itu bukan sekadar salah jadwal — itu menyarankan sesuatu yang dilarang, dan
 * fitur yang melakukannya sekali saja tidak akan dipercaya lagi.
 */
export function puasaPada(iso: string): JenisPuasa[] {
  const h = toHijri(iso);

  // Idulfitri, Iduladha, dan tasyrik.
  if (h.month === 10 && h.day === 1) return [];
  if (h.month === 12 && h.day >= 10 && h.day <= 13) return [];

  const kinds: JenisPuasa[] = [];

  const hari = hariKe(iso);
  if (hari === 1 || hari === 4) kinds.push('senin-kamis');
  if (h.day >= 13 && h.day <= 15) kinds.push('ayyamul-bidh');

  // 9 Zulhijah dan 10 Muharram punya keutamaan tersendiri.
  if (h.month === 12 && h.day === 9) kinds.push('arafah');
  if (h.month === 1 && h.day === 10) kinds.push('asyura');
  // Enam hari Syawal, mulai 2 Syawal — 1 Syawal sudah dikecualikan di atas.
  if (h.month === 10 && h.day >= 2 && h.day <= 7) kinds.push('syawal');

  return kinds;
}

/**
 * Hari puasa sunnah dalam rentang ke depan.
 *
 * Dibatasi supaya satu permintaan tidak pernah menghasilkan daftar sepanjang
 * tahun yang tidak dibaca siapa pun.
 */
export function puasaMendatang(mulai: string, hari = 30): HariPuasa[] {
  const batas = Math.min(120, Math.max(1, Math.round(hari)));
  const out: HariPuasa[] = [];

  for (let i = 0; i < batas; i++) {
    const date = geser(mulai, i);
    const kinds = puasaPada(date);
    if (kinds.length === 0) continue;

    const h = toHijri(date);
    out.push({
      date,
      kinds,
      dayName: NAMA_HARI[hariKe(date)],
      hijri: `${h.day} ${h.monthName} ${h.year} H`,
    });
  }

  return out;
}

export interface RingkasanPuasa {
  /** Berapa hari puasa sunnah dijalani dalam rentang yang dihitung. */
  total: number;
  /** Rentetan hari puasa berturut-turut yang masih berjalan, dalam pekan. */
  seninKamisBerturut: number;
  perJenis: Array<{ kind: JenisPuasa; label: string; jumlah: number }>;
}

/**
 * Ringkas catatan puasa yang sudah dijalani.
 *
 * Rentetan dihitung dalam PEKAN untuk Senin-Kamis, bukan hari: puasa Senin
 * lalu Kamis bukan dua hari berturut-turut, dan menghitungnya sebagai rentetan
 * harian akan selalu menunjukkan angka satu — tidak memberi tahu apa pun.
 */
export function ringkasPuasa(
  log: ReadonlyArray<{ date: string; kind: string }>,
  hariIni: string
): RingkasanPuasa {
  const hitung = new Map<JenisPuasa, number>();
  for (const l of log) {
    const kind: JenisPuasa = jenisPuasaDikenal(l.kind) ? l.kind : 'lainnya';
    hitung.set(kind, (hitung.get(kind) ?? 0) + 1);
  }

  const tanggalSeninKamis = new Set(
    log.filter((l) => l.kind === 'senin-kamis').map((l) => l.date)
  );

  // Mundur pekan demi pekan: satu pekan terhitung kalau Senin ATAU Kamis-nya
  // dipuasakan. Pekan berjalan tidak memutus rentetan hanya karena harinya
  // belum tiba.
  let berturut = 0;
  for (let pekan = 0; pekan < 104; pekan++) {
    const senin = geser(hariIni, -(hariKe(hariIni) + 6) % 7 - pekan * 7);
    const kamis = geser(senin, 3);
    const adaYangDipuasakan = tanggalSeninKamis.has(senin) || tanggalSeninKamis.has(kamis);

    if (adaYangDipuasakan) {
      berturut++;
      continue;
    }
    // Pekan ini belum lewat: harinya mungkin belum datang, jadi bukan bolos.
    if (pekan === 0 && kamis >= hariIni) continue;
    break;
  }

  return {
    total: log.length,
    seninKamisBerturut: berturut,
    perJenis: [...hitung.entries()]
      .map(([kind, jumlah]) => ({ kind, label: LABEL_PUASA[kind], jumlah }))
      .sort((a, b) => b.jumlah - a.jumlah),
  };
}
