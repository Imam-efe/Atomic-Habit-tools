/**
 * Baca cara perbanyakan dari katalog, lalu nilai mana yang benar-benar
 * berhasil di tangan pengguna ini.
 *
 * Kolom `propagation` sudah ada di tiap entri katalog sejak awal, tapi selama
 * ini hanya dirender sebagai satu baris teks di modal detail. Ia memberi tahu
 * CARA memperbanyak; tidak ada yang mencatat apakah caranya berhasil — padahal
 * justru itu yang membedakan panduan umum dari pengalaman sendiri.
 *
 * Dengan tabel garden_propagation, lingkaran modul kebun tertutup penuh:
 * benih -> tanam -> panen -> benih ATAU stek -> tanam.
 */

export type Metode =
  | 'benih-langsung'
  | 'semai-pindah'
  | 'stek'
  | 'cangkok'
  | 'okulasi'
  | 'anakan'
  | 'rimpang'
  | 'umbi'
  | 'daun';

export const METODE_LABEL: Record<Metode, string> = {
  'benih-langsung': 'Benih langsung',
  'semai-pindah': 'Semai lalu pindah',
  stek: 'Stek',
  cangkok: 'Cangkok',
  okulasi: 'Okulasi',
  anakan: 'Anakan',
  rimpang: 'Rimpang',
  umbi: 'Umbi',
  daun: 'Stek daun',
};

const POLA: Array<[Metode, RegExp]> = [
  ['daun', /stek daun/i],
  ['semai-pindah', /semai/i],
  ['benih-langsung', /(tanam|sebar)\s+benih\s+langsung|benih\s+langsung|tanam\s+langsung/i],
  ['stek', /stek/i],
  ['cangkok', /cangkok/i],
  ['okulasi', /okulasi|sambung/i],
  ['anakan', /anakan|tunas anak/i],
  ['rimpang', /rimpang/i],
  ['umbi', /umbi/i],
];

/**
 * Metode perbanyakan yang disebut sebuah entri katalog.
 *
 * Daftar kosong berarti teksnya memang tidak menyebut metode yang dikenal —
 * bukan berarti tanaman itu tidak bisa diperbanyak. Menebak metode dari teks
 * yang tidak menyebutkannya akan melahirkan saran yang salah dengan nada
 * seyakin saran yang benar.
 */
export function parseMetode(text: string): Metode[] {
  const t = text ?? '';
  const hasil: Metode[] = [];
  for (const [metode, pola] of POLA) {
    if (pola.test(t)) hasil.push(metode);
  }
  return hasil;
}

/**
 * Lama persemaian dalam pekan, [tercepat, terlama], dari teks katalog.
 *
 * Ini yang membuat jadwal semai mundur bisa dihitung tanpa data tambahan:
 * "Semai 3–4 minggu, pindah tanam" sudah menyimpan angkanya sejak dulu.
 */
export function pekanSemai(text: string): [number, number] | null {
  const t = text ?? '';
  if (!/semai/i.test(t)) return null;

  // Tanda hubung bisa '-' biasa atau '–' en dash; katalog memakai keduanya.
  const minggu = t.match(/(\d+)\s*(?:[-–]\s*(\d+)\s*)?minggu/i);
  if (minggu) {
    const a = Number(minggu[1]);
    const b = minggu[2] ? Number(minggu[2]) : a;
    return [a, b];
  }

  // Dibulatkan ke ATAS, bukan ke terdekat: "semai 10 hari" yang dibulatkan
  // jadi 1 pekan akan menghasilkan jadwal yang telat tiga hari, dan jadwal
  // semai yang telat tidak bisa diperbaiki lagi. Dibulatkan ke atas paling
  // buruk membuat bibit menunggu sebentar di tray.
  const hari = t.match(/(\d+)\s*(?:[-–]\s*(\d+)\s*)?hari/i);
  if (hari) {
    const a = Math.max(1, Math.ceil(Number(hari[1]) / 7));
    const b = hari[2] ? Math.max(1, Math.ceil(Number(hari[2]) / 7)) : a;
    return [a, b];
  }

  return null;
}

/** Persen stek yang berakar. `null` bila belum dihitung atau datanya mustahil. */
export function tingkatBerhasil(started: number, rooted: number | null): number | null {
  if (rooted === null) return null;
  if (!Number.isFinite(started) || started <= 0) return null;
  if (!Number.isFinite(rooted) || rooted < 0 || rooted > started) return null;
  return Math.round((rooted / started) * 100);
}

export interface CatatanPerbanyakan {
  plantId: string | null;
  nama: string;
  method: Metode;
  countStarted: number;
  countRooted: number | null;
}

export interface RingkasMetode {
  method: Metode;
  label: string;
  batch: number;
  started: number;
  rooted: number;
  rate: number;
}

/**
 * Rangkum keberhasilan per metode, diurutkan dari yang paling berhasil.
 *
 * Batch yang belum dihitung dikeluarkan dari pembagi, bukan dihitung nol:
 * stek yang baru dipasang kemarin belum gagal, ia baru belum selesai. Kalau
 * dihitung nol, tiap batch baru akan menjatuhkan angka keberhasilan metode
 * yang sebenarnya bagus.
 */
export function ringkasMetode(catatan: CatatanPerbanyakan[]): RingkasMetode[] {
  const per = new Map<Metode, { batch: number; started: number; rooted: number }>();

  for (const c of catatan) {
    if (tingkatBerhasil(c.countStarted, c.countRooted) === null) continue;
    const acc = per.get(c.method) ?? { batch: 0, started: 0, rooted: 0 };
    acc.batch += 1;
    acc.started += c.countStarted;
    acc.rooted += c.countRooted as number;
    per.set(c.method, acc);
  }

  return [...per.entries()]
    .map(([method, a]) => ({
      method,
      label: METODE_LABEL[method],
      batch: a.batch,
      started: a.started,
      rooted: a.rooted,
      rate: Math.round((a.rooted / a.started) * 100),
    }))
    .sort((x, y) => y.rate - x.rate || y.started - x.started);
}
