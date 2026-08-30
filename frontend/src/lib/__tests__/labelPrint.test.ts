import { describe, it, expect } from 'vitest';
import {
  LABEL_SIZES, LABEL_SIZE_TITLE, labelSizeSpec, labelLayout,
  categoryColorRgb, categoriesWithColor, FALLBACK_CATEGORY_COLOR,
  A4_MARGIN_MM, LABEL_GAP_MM, labelContentLayout, PT_TO_MM,
} from '../labelPrint';

const A4_W_MM = 210;
const A4_H_MM = 297;

describe('labelSizeSpec', () => {
  it('font membesar seiring ukuran label membesar', () => {
    const kecil = labelSizeSpec('kecil');
    const sedang = labelSizeSpec('sedang');
    const besar = labelSizeSpec('besar');

    expect(sedang.fontTitle).toBeGreaterThan(kecil.fontTitle);
    expect(besar.fontTitle).toBeGreaterThan(sedang.fontTitle);
    expect(sedang.fontBody).toBeGreaterThan(kecil.fontBody);
    expect(besar.fontBody).toBeGreaterThan(sedang.fontBody);
  });

  it('label yang lebih besar berarti kolom per halaman lebih sedikit', () => {
    // Label besar makan lebih banyak ruang, jadi mesti lebih sedikit muat
    // berdampingan — kebalikannya berarti gridnya salah hitung.
    expect(labelSizeSpec('besar').cols).toBeLessThan(labelSizeSpec('sedang').cols);
    expect(labelSizeSpec('sedang').cols).toBeLessThan(labelSizeSpec('kecil').cols);
  });

  it('label yang lebih besar berarti tinggi label lebih besar', () => {
    expect(labelSizeSpec('besar').labelHmm).toBeGreaterThan(labelSizeSpec('sedang').labelHmm);
    expect(labelSizeSpec('sedang').labelHmm).toBeGreaterThan(labelSizeSpec('kecil').labelHmm);
  });

  it('tiap ukuran di LABEL_SIZES punya judul dan spek', () => {
    for (const size of LABEL_SIZES) {
      expect(LABEL_SIZE_TITLE[size], size).toBeTruthy();
      expect(labelSizeSpec(size), size).toBeDefined();
    }
  });
});

describe('labelLayout', () => {
  it('label yang dipak muat di dalam lebar A4', () => {
    // Kesalahan pembulatan di sini berarti kolom terakhir tercetak di luar
    // kertas — tidak kelihatan sampai halaman sungguhan dicetak.
    for (const size of LABEL_SIZES) {
      const l = labelLayout(size);
      const totalWidth = l.widthMm * l.cols + LABEL_GAP_MM * (l.cols - 1) + A4_MARGIN_MM * 2;
      expect(totalWidth, size).toBeLessThanOrEqual(A4_W_MM + 0.01);
    }
  });

  it('baris yang dipak muat di dalam tinggi A4', () => {
    for (const size of LABEL_SIZES) {
      const l = labelLayout(size);
      const totalHeight = l.labelHmm * l.rowsPerPage + LABEL_GAP_MM * (l.rowsPerPage - 1) + A4_MARGIN_MM * 2;
      expect(totalHeight, size).toBeLessThanOrEqual(A4_H_MM + 0.01);
    }
  });

  it('perPage adalah cols dikali rowsPerPage', () => {
    for (const size of LABEL_SIZES) {
      const l = labelLayout(size);
      expect(l.perPage).toBe(l.cols * l.rowsPerPage);
    }
  });

  it('ukuran kecil memuat lebih banyak label sehalaman daripada besar', () => {
    expect(labelLayout('kecil').perPage).toBeGreaterThan(labelLayout('sedang').perPage);
    expect(labelLayout('sedang').perPage).toBeGreaterThan(labelLayout('besar').perPage);
  });

  it('lebar label selalu positif', () => {
    for (const size of LABEL_SIZES) {
      expect(labelLayout(size).widthMm, size).toBeGreaterThan(0);
    }
  });
});

describe('categoryColorRgb', () => {
  it('mengembalikan RGB valid untuk kategori yang dikenal', () => {
    for (const kategori of categoriesWithColor()) {
      const [r, g, b] = categoryColorRgb(kategori);
      for (const channel of [r, g, b]) {
        expect(Number.isInteger(channel), kategori).toBe(true);
        expect(channel, kategori).toBeGreaterThanOrEqual(0);
        expect(channel, kategori).toBeLessThanOrEqual(255);
      }
    }
  });

  it('kategori tidak dikenal jatuh ke abu netral, bukan salah satu warna kategori', () => {
    expect(categoryColorRgb('kategori-yang-tidak-ada')).toEqual(FALLBACK_CATEGORY_COLOR);
  });

  it('kategori null atau kosong jatuh ke abu netral', () => {
    expect(categoryColorRgb(null)).toEqual(FALLBACK_CATEGORY_COLOR);
    expect(categoryColorRgb(undefined)).toEqual(FALLBACK_CATEGORY_COLOR);
    expect(categoryColorRgb('')).toEqual(FALLBACK_CATEGORY_COLOR);
  });

  it('tidak ada dua kategori yang warnanya persis sama', () => {
    // Dua kategori berwarna sama membuat legenda tidak berguna — tidak ada
    // cara membedakan labelnya setelah tercetak.
    const seen = new Map<string, string>();
    for (const kategori of categoriesWithColor()) {
      const key = categoryColorRgb(kategori).join(',');
      const bentrok = seen.get(key);
      expect(bentrok, `${kategori} vs ${bentrok}`).toBeUndefined();
      seen.set(key, kategori);
    }
  });

  it('mencakup delapan kategori katalog', () => {
    expect(categoriesWithColor().sort()).toEqual(
      ['buah', 'hias-bunga', 'hias-daun', 'rempah', 'sayuran-buah', 'sayuran-daun', 'sukulen', 'umbi'].sort()
    );
  });
});

describe('labelContentLayout', () => {
  // Regresi untuk bug: fontTitle/fontBody dalam pt sempat dipakai langsung
  // sebagai jarak mm tanpa konversi, membuat baris "Ditanam" tercetak di
  // tepi bawah label dan baris kategori jatuh ke kotak label berikutnya.
  it('konversi pt ke mm masuk akal — bukan 1:1', () => {
    expect(PT_TO_MM).toBeGreaterThan(0.3);
    expect(PT_TO_MM).toBeLessThan(0.4);
  });

  it('seluruh isi (judul 2 baris + 3 baris isi) selalu muat di dalam tinggi label', () => {
    for (const size of LABEL_SIZES) {
      const spec = labelSizeSpec(size);
      const layout = labelContentLayout(spec);
      // Kasus terburuk yang realistis: judul membungkus ke baris kedua,
      // lalu Lokasi, Ditanam, dan baris kategori (mode Warna).
      const bottomMostBaseline =
        layout.titleY + layout.titleLineHeight + 3 * layout.bodyLineHeight;
      expect(bottomMostBaseline, size).toBeLessThan(spec.labelHmm);
    }
  });

  it('baris judul tunggal tidak pernah menimpa tepi bawah label', () => {
    for (const size of LABEL_SIZES) {
      const spec = labelSizeSpec(size);
      const layout = labelContentLayout(spec);
      const lastBodyBaseline = layout.titleY + layout.bodyLineHeight * 3;
      expect(lastBodyBaseline, size).toBeLessThan(spec.labelHmm - 1);
    }
  });

  it('label lebih besar berarti jarak baris lebih lebar', () => {
    const kecil = labelContentLayout(labelSizeSpec('kecil'));
    const besar = labelContentLayout(labelSizeSpec('besar'));
    expect(besar.titleLineHeight).toBeGreaterThan(kecil.titleLineHeight);
    expect(besar.bodyLineHeight).toBeGreaterThan(kecil.bodyLineHeight);
  });
});
