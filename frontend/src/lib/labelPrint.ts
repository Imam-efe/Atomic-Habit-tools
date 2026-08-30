/**
 * Tata letak dan warna untuk cetak label tanaman.
 *
 * Dipisah dari layar Kebun supaya perhitungan grid dan warna bisa diuji tanpa
 * merender jsPDF — hasil PDF tidak bisa diperiksa nilainya di test, tapi
 * jumlah kolom, tinggi label, dan warna kategori bisa dan harus.
 */

export type LabelSize = 'kecil' | 'sedang' | 'besar';
export type LabelColorMode = 'mono' | 'warna';

export const LABEL_SIZES: readonly LabelSize[] = ['kecil', 'sedang', 'besar'];

export const LABEL_SIZE_TITLE: Record<LabelSize, string> = {
  kecil: 'Kecil',
  sedang: 'Sedang',
  besar: 'Besar',
};

export interface LabelSizeSpec {
  /** Jumlah kolom label per halaman A4. */
  cols: number;
  /** Tinggi satu label, mm. */
  labelHmm: number;
  fontTitle: number;
  fontBody: number;
  /** Ukuran font untuk baris kategori/legenda — hanya tampak di mode Warna. */
  fontMeta: number;
}

/**
 * Tiga ukuran tetap, bukan slider bebas.
 *
 * Slider kontinu terlihat lebih fleksibel, tapi paket label ini menghitung
 * kolom-per-halaman dan tinggi label sekaligus — nilai yang tidak dari
 * himpunan kecil akan menghasilkan sisa ruang kosong yang janggal di kanan
 * atau bawah tiap halaman A4. Tiga ukuran ini sudah mewakili ujung dan
 * tengah rentang yang wajar: kecil untuk stiker semai bibit, besar untuk
 * label yang harus terbaca dari agak jauh.
 */
const SPECS: Record<LabelSize, LabelSizeSpec> = {
  kecil: { cols: 4, labelHmm: 22, fontTitle: 8, fontBody: 6, fontMeta: 5.5 },
  sedang: { cols: 3, labelHmm: 30, fontTitle: 10, fontBody: 7.5, fontMeta: 6.5 },
  besar: { cols: 2, labelHmm: 40, fontTitle: 13, fontBody: 9, fontMeta: 7.5 },
};

export function labelSizeSpec(size: LabelSize): LabelSizeSpec {
  return SPECS[size];
}

const A4_W_MM = 210;
const A4_H_MM = 297;
export const A4_MARGIN_MM = 8;
export const LABEL_GAP_MM = 2;

export interface LabelLayout extends LabelSizeSpec {
  /** Lebar satu label, mm — diturunkan dari jumlah kolom, bukan ditetapkan. */
  widthMm: number;
  rowsPerPage: number;
  /** cols × rowsPerPage. */
  perPage: number;
}

/** Tata letak grid A4 lengkap untuk satu ukuran label. */
export function labelLayout(size: LabelSize): LabelLayout {
  const spec = labelSizeSpec(size);
  const widthMm =
    (A4_W_MM - A4_MARGIN_MM * 2 - LABEL_GAP_MM * (spec.cols - 1)) / spec.cols;
  const rowsPerPage = Math.max(
    1,
    Math.floor((A4_H_MM - A4_MARGIN_MM * 2 + LABEL_GAP_MM) / (spec.labelHmm + LABEL_GAP_MM))
  );
  return { ...spec, widthMm, rowsPerPage, perPage: spec.cols * rowsPerPage };
}

/**
 * 1 pt dalam mm. jsPDF diberi `unit: 'mm'`, tapi ukuran font tetap dalam pt —
 * mencampur keduanya tanpa konversi ini adalah bug yang tepat membuat baris
 * "Ditanam" tercetak menimpa tepi bawah label, dan baris kategori jatuh ke
 * label baris berikutnya: jarak antar baris yang seharusnya ~3mm malah
 * dihitung sebagai ~8mm karena angka pt dipakai langsung sebagai mm.
 */
export const PT_TO_MM = 25.4 / 72;

/** Jarak dari tepi atas kotak label ke baseline baris pertama, mm. */
export function baselineOffsetMm(fontSizePt: number): number {
  return fontSizePt * PT_TO_MM;
}

/** Jarak baseline-ke-baseline yang nyaman dibaca untuk satu ukuran font, mm. */
export function linePitchMm(fontSizePt: number): number {
  return fontSizePt * PT_TO_MM * 1.5;
}

export interface LabelContentLayout {
  /** mm dari tepi atas kotak label ke baseline baris judul pertama. */
  titleY: number;
  /** mm antar baris judul yang membungkus ke baris kedua. */
  titleLineHeight: number;
  /** mm antar baris isi (Lokasi/Ditanam/kategori), dan dari judul ke baris isi pertama. */
  bodyLineHeight: number;
}

/**
 * Tata letak vertikal isi satu label, dalam mm — dipisah dari `buildLabelsPdf`
 * (yang butuh jsPDF) supaya angkanya bisa diuji tanpa merender PDF sungguhan.
 */
export function labelContentLayout(spec: LabelSizeSpec, padTopMm = 3): LabelContentLayout {
  return {
    titleY: padTopMm + baselineOffsetMm(spec.fontTitle),
    titleLineHeight: linePitchMm(spec.fontTitle),
    bodyLineHeight: linePitchMm(spec.fontBody),
  };
}

/**
 * Warna cetak per kategori tanaman, dipakai hanya pada mode Warna.
 *
 * Mode Monokrom tidak pernah menyentuh peta ini — printer tinta hitam-putih
 * merender warna sebagai abu-abu pekat dan boros tinta, jadi Monokrom
 * memakai jalur render yang sama sekali terpisah, bukan "warna yang
 * kebetulan gelap".
 *
 * Delapan warna dipilih agar saling terpisah jelas walau dicetak di printer
 * murah: hijau, oranye, cokelat, zaitun, merah, teal, magenta, ungu — tidak
 * ada dua yang bertetangga di roda warna.
 */
const CATEGORY_COLOR: Record<string, readonly [number, number, number]> = {
  'sayuran-daun': [46, 139, 69],
  'sayuran-buah': [230, 126, 34],
  umbi: [139, 90, 43],
  rempah: [125, 140, 30],
  buah: [192, 57, 43],
  'hias-daun': [22, 160, 133],
  'hias-bunga': [216, 27, 96],
  sukulen: [108, 92, 231],
};

/** Abu netral untuk tanaman custom di luar katalog — bukan salah satu warna kategori. */
export const FALLBACK_CATEGORY_COLOR: readonly [number, number, number] = [90, 90, 90];

/** RGB untuk kategori, atau abu netral bila kategorinya kosong/tidak dikenal. */
export function categoryColorRgb(category: string | null | undefined): readonly [number, number, number] {
  if (!category) return FALLBACK_CATEGORY_COLOR;
  return CATEGORY_COLOR[category] ?? FALLBACK_CATEGORY_COLOR;
}

/** Semua kategori yang punya warna sendiri — dipakai merender legenda di layar. */
export function categoriesWithColor(): string[] {
  return Object.keys(CATEGORY_COLOR);
}
