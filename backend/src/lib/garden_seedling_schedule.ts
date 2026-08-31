/**
 * Hitung mundur kapan harus mulai menyemai supaya bibit siap pada tanggal
 * tanam yang diinginkan.
 *
 * Datanya sudah ada di katalog sejak dulu: `propagation` menulis "Semai 3–4
 * minggu, pindah tanam". Yang belum ada adalah yang membalik arah hitungnya —
 * selama ini pengguna hanya bisa bertanya "kapan bibit ini siap", bukan "kapan
 * saya harus mulai supaya siap saat hujan pertama".
 *
 * Berbeda dari sowLeadDays di garden_succession.ts, yang menjawab pertanyaan
 * lain: kapan menyemai batch berikutnya supaya panen bersambung.
 */

import { pekanSemai } from './garden_propagation';

/**
 * Lama penyesuaian sebelum pindah tanam, hari.
 *
 * Bibit yang dipindah mendadak dari tempat teduh ke matahari penuh sering layu
 * dan tidak pulih. Seminggu dikeluarkan bertahap membuat daunnya menebal lebih
 * dulu.
 */
const HARI_ADAPTASI = 7;

export interface JadwalSemai {
  mulaiSemai: string;
  mulaiAdaptasi: string;
  targetTanam: string;
  pekan: [number, number];
}

/** Geser tanggal YYYY-MM-DD sebanyak `hari`. UTC saja — DST tidak boleh ikut. */
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
 * Jadwal mundur untuk satu target tanam, atau null bila tanaman ini memang
 * tidak lewat persemaian.
 *
 * Dipakai yang TERLAMA dari rentang pekan, bukan yang tercepat: menyemai
 * kepagian hanya berarti bibit menunggu sebentar di tray, sedangkan menyemai
 * kesiangan berarti target tanamnya meleset dan tidak bisa diperbaiki lagi.
 */
export function jadwalMundur(targetTanam: string, propagation: string): JadwalSemai | null {
  const pekan = pekanSemai(propagation);
  if (!pekan) return null;

  return {
    mulaiSemai: geser(targetTanam, -pekan[1] * 7),
    mulaiAdaptasi: geser(targetTanam, -HARI_ADAPTASI),
    targetTanam,
    pekan,
  };
}

/** Berapa hari terlambat dari jadwal semai. 0 bila belum waktunya atau tepat waktu. */
export function semaiTerlambat(jadwal: JadwalSemai, hariIni: string): number {
  return Math.max(0, selisihHari(jadwal.mulaiSemai, hariIni));
}
