import { describe, it, expect } from 'vitest';
import { susunQr, bacaQr, QR_PREFIX, qrDataUrl } from './gardenQr';

describe('susunQr / bacaQr', () => {
  it('pulang pergi tanpa kehilangan apa pun', () => {
    for (const kasus of [
      { plantingId: 'abc123', unitNo: 1 },
      { plantingId: 'V1StGXR8_Z5jdHi6B-myT', unitNo: 42 },
      { plantingId: 'abc123', unitNo: null },
    ]) {
      expect(bacaQr(susunQr(kasus))).toEqual(kasus);
    }
  });

  it('bentuknya persis seperti yang dijanjikan', () => {
    expect(susunQr({ plantingId: 'p1', unitNo: 3 })).toBe(`${QR_PREFIX}:p1:3`);
    expect(susunQr({ plantingId: 'p1', unitNo: null })).toBe(`${QR_PREFIX}:p1:-`);
  });

  it('menolak QR yang bukan milik kebun, bukan melempar', () => {
    for (const teks of [
      '',
      'https://contoh.id/kebun/p1',
      'kebun:p1',           // kurang satu bagian
      'kebun:p1:2:3',       // kelebihan
      'lain:p1:2',          // awalan asing
      'kebun::2',           // tanpa id
      'kebun:p1:0',         // nomor pot mulai dari 1
      'kebun:p1:-3',        // negatif
      'kebun:p1:1e3',       // Number() menerimanya, kami tidak
      'kebun:p1: 2',        // spasi di dalam
      'kebun:p1:dua',
      4085700123456,        // barcode belanjaan, bukan string
      null,
      undefined,
    ]) {
      expect(bacaQr(teks)).toBeNull();
    }
  });

  it('spasi di ujung dimaafkan', () => {
    expect(bacaQr('  kebun:p1:2  ')).toEqual({ plantingId: 'p1', unitNo: 2 });
  });
});

describe('qrDataUrl', () => {
  it('menghasilkan PNG data URL yang bisa ditempel ke PDF', async () => {
    const url = await qrDataUrl(susunQr({ plantingId: 'p1', unitNo: 1 }));
    expect(url.startsWith('data:image/png;base64,')).toBe(true);
    // Cukup panjang untuk benar-benar berisi gambar, bukan header kosong.
    expect(url.length).toBeGreaterThan(200);
  });

  it('muatan berbeda menghasilkan gambar berbeda', async () => {
    const [a, b] = await Promise.all([
      qrDataUrl(susunQr({ plantingId: 'p1', unitNo: 1 })),
      qrDataUrl(susunQr({ plantingId: 'p1', unitNo: 2 })),
    ]);
    expect(a).not.toBe(b);
  });
});

/**
 * Bukti pulang-pergi yang sebenarnya: muatan disandikan oleh `qrcode`, lalu
 * dibaca kembali oleh jsQR — pustaka pembaca yang berbeda dan tidak berbagi
 * kode apa pun dengan penyandinya.
 *
 * Tanpa ini, seluruh berkas hanya membuktikan bahwa dua fungsi kami sepakat
 * satu sama lain; yang perlu dibuktikan adalah bahwa pemindai di luar sana
 * bisa membacanya.
 */
describe('pulang pergi lewat pembaca QR sungguhan', () => {
  /** Matriks modul jadi piksel RGBA, lengkap dengan zona sunyi. */
  function keRgba(modules: { size: number; data: Uint8Array }, skala = 4, sunyi = 4) {
    const sisi = (modules.size + sunyi * 2) * skala;
    const px = new Uint8ClampedArray(sisi * sisi * 4).fill(255);
    for (let y = 0; y < modules.size; y++) {
      for (let x = 0; x < modules.size; x++) {
        if (!modules.data[y * modules.size + x]) continue;
        for (let dy = 0; dy < skala; dy++) {
          for (let dx = 0; dx < skala; dx++) {
            const i = (((y + sunyi) * skala + dy) * sisi + (x + sunyi) * skala + dx) * 4;
            px[i] = px[i + 1] = px[i + 2] = 0;
          }
        }
      }
    }
    return { px, sisi };
  }

  it('jsQR membaca kembali muatan yang sama persis', async () => {
    const QRCode = (await import('qrcode')).default;
    const jsQR = (await import('jsqr')).default;

    for (const kasus of [
      { plantingId: 'p1', unitNo: 1 },
      { plantingId: 'V1StGXR8_Z5jdHi6B-myT', unitNo: 137 },
      { plantingId: 'p1', unitNo: null },
    ]) {
      const payload = susunQr(kasus);
      const { px, sisi } = keRgba(QRCode.create(payload, { errorCorrectionLevel: 'M' }).modules);
      const terbaca = jsQR(px, sisi, sisi);

      expect(terbaca?.data).toBe(payload);
      expect(bacaQr(terbaca?.data)).toEqual(kasus);
    }
  });
});
