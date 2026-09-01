/**
 * Karantina hewan baru.
 *
 * Penyakit masuk bersama hewan baru, bukan muncul sendiri. Satu ikan yang
 * langsung dimasukkan ke tangki utama bisa menghabiskan seluruh isinya dalam
 * sepekan, dan itu kerugian yang tidak bisa dibatalkan.
 */

/** Jeda terpendek yang masih menangkap sebagian besar penyakit menular. */
export const HARI_KARANTINA = 14;

export interface Karantina {
  selesai: string;
  sisaHari: number;
  aman: boolean;
}

function geser(tanggal: string, hari: number): string {
  const d = new Date(`${tanggal}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + hari);
  return d.toISOString().slice(0, 10);
}

function selisihHari(dari: string, ke: string): number {
  const a = Date.parse(`${dari}T00:00:00Z`);
  const b = Date.parse(`${ke}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/**
 * Status karantina, atau null bila memang tidak perlu dikarantina.
 *
 * Hewan yang sendirian di kandangnya tidak punya siapa pun untuk ditulari,
 * jadi peringatannya hanya akan jadi bising yang mengajari pengguna
 * mengabaikan peringatan berikutnya.
 */
export function statusKarantina(
  tanggalMasuk: string,
  hariIni: string,
  punyaTemanSekandang: boolean
): Karantina | null {
  if (!punyaTemanSekandang) return null;

  const selesai = geser(tanggalMasuk, HARI_KARANTINA);
  const sisaHari = Math.max(0, selisihHari(hariIni, selesai));
  return { selesai, sisaHari, aman: sisaHari === 0 };
}
