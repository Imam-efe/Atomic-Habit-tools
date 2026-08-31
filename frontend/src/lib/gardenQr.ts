/**
 * QR pada label tanaman.
 *
 * Nomor pot menyelesaikan masalah "cabai mana ini" untuk mata; QR
 * menyelesaikannya untuk jari. Membuka aplikasi, mencari tanaman di daftar,
 * memilih potnya, lalu mencatat pupuk — empat langkah dengan tangan berlumpur,
 * dan langkah pertama sampai ketiga adalah pekerjaan pencarian yang hasilnya
 * sudah tertempel di pot itu sendiri.
 *
 * Muatannya sengaja teks polos, bukan URL. Label dicetak sekali dan menempel
 * bertahun-tahun; menaruh nama domain di dalamnya berarti label lama menjadi
 * sampah pada hari domainnya berubah. Pemindainya milik aplikasi ini sendiri,
 * jadi ia tidak butuh alamat — ia butuh identitas.
 */

/** Awalan tetap: pembeda dari QR apa pun yang kebetulan ikut ter-scan. */
export const QR_PREFIX = 'kebun';

/** Penanda "seluruh tanaman", untuk penanaman yang belum punya pot bernomor. */
const TANPA_POT = '-';

export interface QrTanaman {
  plantingId: string;
  /** null berarti labelnya menunjuk penanaman, bukan satu pot tertentu. */
  unitNo: number | null;
}

/**
 * Susun muatan QR: `kebun:<plantingId>:<unitNo|->`.
 *
 * plantingId adalah nanoid — huruf, angka, tanda hubung, dan garis bawah —
 * jadi titik dua aman sebagai pemisah dan tidak perlu di-escape.
 */
export function susunQr({ plantingId, unitNo }: QrTanaman): string {
  const pot = unitNo === null || unitNo === undefined ? TANPA_POT : String(unitNo);
  return `${QR_PREFIX}:${plantingId}:${pot}`;
}

/**
 * Baca muatan QR kembali, atau null bila bukan milik kebun ini.
 *
 * Mengembalikan null alih-alih melempar: pemindai kamera membaca apa pun yang
 * masuk ke bingkai, termasuk barcode belanjaan dan QR pembayaran, dan itu
 * bukan galat — cuma bukan tanaman.
 */
export function bacaQr(teks: unknown): QrTanaman | null {
  if (typeof teks !== 'string') return null;

  const bagian = teks.trim().split(':');
  if (bagian.length !== 3) return null;
  const [prefix, plantingId, pot] = bagian;
  if (prefix !== QR_PREFIX || !plantingId) return null;

  if (pot === TANPA_POT) return { plantingId, unitNo: null };

  // Nomor pot selalu bilangan bulat positif. `Number('1e3')` dan
  // `Number(' 1 ')` juga menghasilkan angka, jadi bentuknya diperiksa dulu
  // supaya QR cacat tidak menunjuk pot yang salah dengan yakin.
  if (!/^\d+$/.test(pot)) return null;
  const unitNo = Number(pot);
  return unitNo > 0 ? { plantingId, unitNo } : null;
}

/** Sisi QR pada label, mm — ikut ukuran labelnya. */
export const QR_MM: Record<'kecil' | 'sedang' | 'besar', number> = {
  kecil: 9,
  sedang: 12,
  besar: 16,
};

/**
 * Render muatan jadi data URL PNG untuk ditempel ke PDF.
 *
 * `margin: 0` karena label sudah menyediakan jaraknya sendiri; margin bawaan
 * empat modul akan memakan hampir sepertiga sisi QR sembilan milimeter.
 * Koreksi galat 'M' — cukup untuk label yang tergores atau agak kotor tanpa
 * memperbanyak modul sampai tidak terbaca kamera ponsel pada ukuran sekecil
 * itu.
 */
export async function qrDataUrl(payload: string): Promise<string> {
  const QRCode = (await import('qrcode')).default;
  return QRCode.toDataURL(payload, {
    errorCorrectionLevel: 'M',
    margin: 0,
    width: 256,
    color: { dark: '#000000ff', light: '#ffffffff' },
  });
}
