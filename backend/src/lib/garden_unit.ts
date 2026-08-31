/**
 * Nomor pot: identitas satu tanaman fisik di dalam satu catatan penanaman.
 *
 * Satu baris garden_plantings dengan quantity 5 adalah satu benda bagi
 * aplikasi, tapi lima pot yang berdiri terpisah di kebun. Saat memupuk, dua
 * cabai di dua pot terlihat persis sama di layar — dan itulah yang membuatnya
 * tertukar.
 *
 * Dua kunci sengaja dipisah, dan pemisahan itu yang membuat kode boleh diedit
 * tanpa merusak apa pun:
 *
 *   unit_no — permanen, dipakai semua relasi termasuk log perawatan.
 *   code    — yang tercetak di label, bebas diubah pengguna.
 *
 * Karena riwayat menunjuk unit_no, mengganti kode hari ini tidak menggeser
 * satu pun catatan kemarin.
 */

/** Di atas ini hampir pasti salah ketik, bukan kebun yang besar. */
export const MAX_UNIT_PER_PLANTING = 200;

/**
 * Kode lebih panjang dari ini tidak muat terbaca di label terkecil, dan label
 * yang tidak terbaca sambil jongkok tidak menyelesaikan masalah apa pun.
 */
export const MAX_CODE_LEN = 8;

/**
 * Hanya huruf, angka, dan tanda hubung.
 *
 * Font helvetica bawaan jsPDF cuma mengerti Latin-1: emoji dan simbol tercetak
 * sebagai karakter acak, dan yang lebih parah lebarnya salah dihitung sehingga
 * teksnya meluber ke label sebelah.
 */
const KODE_SAH = /^[A-Za-z0-9-]+$/;

/**
 * Kunci deret nomor: satu deret per jenis per pengguna.
 *
 * Awalan `nama:` untuk tanaman di luar katalog supaya tidak pernah bentrok
 * dengan slug katalog — tanpa itu, tanaman kustom bernama "tomat" akan ikut ke
 * deret slug `tomat` dan nomornya bercampur dengan tomat katalog.
 */
export function speciesKey(plantId: string | null, customName: string | null): string {
  const slug = (plantId ?? '').trim();
  if (slug) return slug;
  const nama = (customName ?? '').trim().toLowerCase();
  return `nama:${nama || 'tanaman'}`;
}

export function bersihkanKode(raw: unknown): string | null {
  const teks =
    typeof raw === 'number' && Number.isFinite(raw) ? String(raw)
    : typeof raw === 'string' ? raw.trim()
    : '';
  if (!teks || teks.length > MAX_CODE_LEN) return null;
  return KODE_SAH.test(teks) ? teks : null;
}

/**
 * Nomor otomatis berikutnya: satu di atas angka tertinggi yang PERNAH dipakai.
 *
 * Bukan jumlah baris, dan bukan lubang terkecil yang kosong. Pot yang pensiun
 * labelnya bisa saja masih tergeletak di gudang, dan memberi nomor yang sama
 * ke pot baru akan menghidupkan lagi persis kebingungan yang sedang dibereskan.
 * Pengguna tetap boleh memakai ulang nomor pensiunan — tapi dengan sadar,
 * lewat mengetiknya sendiri.
 */
export function kodeBerikutnya(kodeTerpakai: string[]): string {
  let tertinggi = 0;
  for (const k of kodeTerpakai) {
    const n = Number(k);
    if (Number.isInteger(n) && n > tertinggi) tertinggi = n;
  }
  return String(tertinggi + 1);
}

export interface Unit {
  unitNo: number;
  code: string;
  retired: boolean;
}

/** Di atas ini daftar kode lebih panjang daripada nama tanamannya sendiri. */
const MAKS_KODE_DISEBUT = 6;

/**
 * Ringkasan kode untuk satu baris daftar: '#3', '#1–#5', '#1, #3, #7'.
 *
 * Rentang hanya dipakai kalau deretnya benar-benar rapat. '#1–#7' untuk pot
 * yang sebenarnya cuma tiga adalah kebohongan yang baru ketahuan saat pengguna
 * berdiri di kebun menghitung pot.
 */
export function ringkasKode(units: Unit[]): string {
  const aktif = units.filter((u) => !u.retired);
  if (aktif.length === 0) return 'tidak ada pot aktif';
  if (aktif.length === 1) return `#${aktif[0].code}`;

  const angka = aktif.map((u) => Number(u.code));
  if (angka.every((n) => Number.isInteger(n))) {
    const urut = [...angka].sort((a, b) => a - b);
    const rapat = urut.every((n, i) => i === 0 || n === urut[i - 1] + 1);
    if (rapat) return `#${urut[0]}–#${urut[urut.length - 1]}`;
  }

  if (aktif.length > MAKS_KODE_DISEBUT) return `${aktif.length} pot`;
  return aktif.map((u) => `#${u.code}`).join(', ');
}

export type HasilUbah =
  | { jenis: 'bebas' }
  | { jenis: 'tukar'; denganUnitNo: number; denganPlantingId: string }
  | { jenis: 'ditolak'; alasan: string };

export interface UnitLain {
  plantingId: string;
  unitNo: number;
  code: string;
  retired: boolean;
}

/**
 * Apa yang terjadi kalau satu unit diberi kode baru.
 *
 * Tabrakan dengan unit aktif lain tidak ditolak, melainkan ditawarkan sebagai
 * tukar: kasus nyatanya adalah dua label yang tertempel di pot yang salah, dan
 * menukar nomornya jauh lebih masuk akal daripada memaksa mencetak ulang
 * keduanya. Tabrakan dengan unit pensiun dibiarkan lewat — memasang label lama
 * yang masih bagus ke pot baru memang tujuannya.
 */
export function rencanaUbahKode(
  kodeBaru: string,
  sendiri: { plantingId: string; unitNo: number },
  semuaSejenis: UnitLain[]
): HasilUbah {
  const kode = bersihkanKode(kodeBaru);
  if (!kode) {
    return {
      jenis: 'ditolak',
      alasan: `Kode harus 1–${MAX_CODE_LEN} karakter, hanya huruf, angka, dan tanda hubung.`,
    };
  }

  const bentrok = semuaSejenis.find(
    (u) =>
      u.code === kode &&
      !u.retired &&
      !(u.plantingId === sendiri.plantingId && u.unitNo === sendiri.unitNo)
  );

  if (!bentrok) return { jenis: 'bebas' };
  return { jenis: 'tukar', denganUnitNo: bentrok.unitNo, denganPlantingId: bentrok.plantingId };
}
