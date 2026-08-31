import { describe, it, expect } from 'vitest';
import {
  LABEL_SIZES, LABEL_SIZE_TITLE, labelSizeSpec, labelLayout,
  categoryColorRgb, categoriesWithColor, FALLBACK_CATEGORY_COLOR,
  A4_MARGIN_MM, LABEL_GAP_MM, labelContentLayout, PT_TO_MM,
  tintTowardWhite, relativeLuminance, secondaryTextColor, badgeSpec,
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

describe('warna teks mode Warna', () => {
  // Inti permintaannya: di mode Warna tidak boleh ada hitam atau abu di mana
  // pun — bukan cuma pada judul.
  it('tidak ada warna kategori yang hitam atau abu netral', () => {
    for (const kategori of [...categoriesWithColor(), 'di-luar-katalog', '']) {
      const [r, g, b] = categoryColorRgb(kategori);
      // Abu = ketiga kanal (nyaris) sama. Warna sejati punya selisih kanal.
      const spread = Math.max(r, g, b) - Math.min(r, g, b);
      expect(spread, `${kategori} terlihat abu-abu`).toBeGreaterThan(20);
      // Dan tidak ada yang mendekati hitam.
      expect(relativeLuminance([r, g, b]), `${kategori} terlalu gelap`).toBeGreaterThan(0.1);
    }
  });

  it('tintTowardWhite 0 mengembalikan warna asli, 1 mengembalikan putih', () => {
    expect(tintTowardWhite([46, 139, 69], 0)).toEqual([46, 139, 69]);
    expect(tintTowardWhite([46, 139, 69], 1)).toEqual([255, 255, 255]);
  });

  it('tintTowardWhite menjepit nilai di luar 0–1', () => {
    expect(tintTowardWhite([46, 139, 69], -5)).toEqual([46, 139, 69]);
    expect(tintTowardWhite([46, 139, 69], 9)).toEqual([255, 255, 255]);
  });

  it('warna sekunder selalu lebih muda dari warna dasar, tidak pernah lebih gelap', () => {
    // Kalau lebih gelap, ia bergerak menuju hitam — persis yang dilarang.
    for (const kategori of categoriesWithColor()) {
      const dasar = categoryColorRgb(kategori);
      const sekunder = secondaryTextColor(dasar);
      expect(relativeLuminance(sekunder), kategori).toBeGreaterThanOrEqual(relativeLuminance(dasar));
    }
  });

  it('warna sekunder tidak pernah pudar sampai sulit dibaca di kertas putih', () => {
    for (const kategori of [...categoriesWithColor(), 'di-luar-katalog']) {
      const sekunder = secondaryTextColor(categoryColorRgb(kategori));
      expect(relativeLuminance(sekunder), kategori).toBeLessThanOrEqual(0.62);
    }
  });

  it('warna sekunder tetap warna, bukan abu', () => {
    for (const kategori of [...categoriesWithColor(), 'di-luar-katalog']) {
      const [r, g, b] = secondaryTextColor(categoryColorRgb(kategori));
      expect(Math.max(r, g, b) - Math.min(r, g, b), kategori).toBeGreaterThan(10);
    }
  });

  it('setiap kanal warna sekunder tetap RGB yang sah', () => {
    for (const kategori of categoriesWithColor()) {
      for (const ch of secondaryTextColor(categoryColorRgb(kategori))) {
        expect(Number.isInteger(ch)).toBe(true);
        expect(ch).toBeGreaterThanOrEqual(0);
        expect(ch).toBeLessThanOrEqual(255);
      }
    }
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

describe('badgeSpec', () => {
  it('ada untuk tiap ukuran label', () => {
    for (const size of LABEL_SIZES) {
      expect(badgeSpec(size).fontSize, size).toBeGreaterThan(0);
    }
  });

  it('kode lebih besar daripada teks isi — ia yang dibaca sambil jongkok', () => {
    for (const size of LABEL_SIZES) {
      expect(badgeSpec(size).fontSize, size).toBeGreaterThan(labelSizeSpec(size).fontBody);
    }
  });

  it('makin besar labelnya makin besar kodenya', () => {
    expect(badgeSpec('besar').fontSize).toBeGreaterThan(badgeSpec('sedang').fontSize);
    expect(badgeSpec('sedang').fontSize).toBeGreaterThan(badgeSpec('kecil').fontSize);
  });

  it('lencana muat di label terkecil bersama kode terpanjang', () => {
    // 8 karakter adalah MAX_CODE_LEN di backend. Perkiraan lebar helvetica
    // bold ~0.62em per karakter, ditambah tanda pagar dan ruang dalam.
    const badge = badgeSpec('kecil');
    const perkiraanLebarMm = (9 * badge.fontSize * 0.62) / 2.83 + badge.padXmm * 2;
    expect(perkiraanLebarMm).toBeLessThan(labelLayout('kecil').widthMm * 0.75);
  });
});

describe('lencana kode tidak menghimpit judul', () => {
  // Perkiraan lebar helvetica bold, dipakai untuk menjaga geometri tetap waras
  // tanpa perlu merender jsPDF di dalam test.
  const lebarMm = (teks: string, fontPt: number, tebal = false) =>
    (teks.length * fontPt * (tebal ? 0.62 : 0.52)) / 2.83;

  it.each(LABEL_SIZES)('ukuran %s menyisakan ruang judul yang cukup', (size) => {
    const layout = labelLayout(size);
    const badge = badgeSpec(size);
    // 8 karakter adalah MAX_CODE_LEN di backend, plus tanda pagar.
    const badgeW = lebarMm('#ABCDEFGH', badge.fontSize, true) + badge.padXmm * 2 + 1.5;
    // Mode Warna memakan ruang paling banyak: pita aksen di tepi kiri.
    const titleWidth = layout.widthMm - 7.5 - badgeW;

    expect(titleWidth, `${size}: judul kehabisan ruang`).toBeGreaterThan(0);
    // Kata terpanjang di katalog harus muat utuh, kalau tidak judulnya
    // terpotong jadi elipsis pada setiap label mikrogreen.
    expect(titleWidth, size).toBeGreaterThan(lebarMm('Mikrogreen', layout.fontTitle, true));
  });
});
