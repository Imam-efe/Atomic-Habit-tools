/**
 * Menilai hasil tes air terhadap rentang katalog.
 *
 * Satu aturan di sini tidak pernah lunak dan tidak butuh katalog: amonia di
 * atas nol selalu bahaya. Tidak ada kadar amonia yang aman bagi ikan mana pun,
 * dan itu penyebab kematian nomor satu di akuarium yang belum matang siklus
 * nitrogennya — biasanya beberapa hari setelah ikannya dimasukkan, saat
 * pemiliknya mengira semuanya berjalan baik.
 */

import type { Animal } from '../data/animals';

export interface HasilAir {
  suhuC: number | null;
  ph: number | null;
  amoniaPpm: number | null;
  nitritPpm: number | null;
  nitratPpm: number | null;
  salinitasPpt: number | null;
}

export type StatusAir = 'aman' | 'waspada' | 'bahaya';

export interface PenilaianAir {
  parameter: string;
  nilai: number;
  status: StatusAir;
  saran: string;
}

/** Nitrat ditoleransi jauh lebih tinggi daripada amonia dan nitrit. */
const NITRAT_WASPADA = 40;

/**
 * Selang terlama antar tes air sebelum pengguna ditagih, hari.
 *
 * Diekspor karena cron push di index.ts memakainya juga; menuliskannya ulang
 * di sana sebagai angka telanjang berarti dua ambang yang bisa menyimpang.
 */
export const HARI_TES_AIR = 14;

function rentang(
  parameter: string,
  nilai: number,
  batas: [number, number] | null,
  saranRendah: string,
  saranTinggi: string
): PenilaianAir | null {
  if (!batas) return null;
  if (nilai < batas[0]) return { parameter, nilai, status: 'waspada', saran: saranRendah };
  if (nilai > batas[1]) return { parameter, nilai, status: 'waspada', saran: saranTinggi };
  return { parameter, nilai, status: 'aman', saran: '' };
}

export function nilaiAir(hasil: HasilAir, animal: Animal | null): PenilaianAir[] {
  const keluar: PenilaianAir[] = [];

  if (hasil.amoniaPpm !== null) {
    keluar.push({
      parameter: 'amonia',
      nilai: hasil.amoniaPpm,
      status: hasil.amoniaPpm > 0 ? 'bahaya' : 'aman',
      saran: hasil.amoniaPpm > 0
        ? 'Ganti 30-50% air sekarang dan hentikan pakan sehari. Amonia terdeteksi berarti filternya belum matang atau kelebihan pakan.'
        : '',
    });
  }

  if (hasil.nitritPpm !== null) {
    keluar.push({
      parameter: 'nitrit',
      nilai: hasil.nitritPpm,
      status: hasil.nitritPpm > 0 ? 'bahaya' : 'aman',
      saran: hasil.nitritPpm > 0
        ? 'Ganti air dan jangan tambah ikan dulu. Nitrit mengikat darah ikan sehingga ia sesak walau airnya jernih.'
        : '',
    });
  }

  if (hasil.nitratPpm !== null) {
    keluar.push({
      parameter: 'nitrat',
      nilai: hasil.nitratPpm,
      status: hasil.nitratPpm > NITRAT_WASPADA ? 'waspada' : 'aman',
      saran: hasil.nitratPpm > NITRAT_WASPADA
        ? 'Perbesar porsi ganti air rutin. Nitrat tinggi tidak langsung membunuh, tapi menekan kekebalan dan memicu alga.'
        : '',
    });
  }

  if (hasil.ph !== null) {
    const p = rentang(
      'pH', hasil.ph, animal?.phAir ?? null,
      'pH di bawah rentang idealnya. Naikkan perlahan dengan penyangga; perubahan mendadak lebih berbahaya daripada pH yang sedikit meleset.',
      'pH di atas rentang idealnya. Turunkan perlahan; jangan pakai bahan penurun pH sekaligus banyak.'
    );
    if (p) keluar.push(p);
  }

  if (hasil.suhuC !== null) {
    const p = rentang(
      'suhu', hasil.suhuC, animal?.suhuC ?? null,
      'Suhu di bawah rentang idealnya. Ikan jadi lamban makan dan lebih mudah kena jamur.',
      'Suhu di atas rentang idealnya. Air hangat memuat lebih sedikit oksigen — tambah aerasi.'
    );
    if (p) keluar.push(p);
  }

  if (hasil.salinitasPpt !== null) {
    const p = rentang(
      'salinitas', hasil.salinitasPpt, animal?.salinitasPpt ?? null,
      'Salinitas terlalu rendah. Tambah air laut buatan, jangan garam dapur.',
      'Salinitas terlalu tinggi, biasanya karena penguapan. Tambah air tawar RO, bukan air laut.'
    );
    if (p) keluar.push(p);
  }

  return keluar;
}
