/**
 * Penanda cuaca ekstrem untuk pencari pola gagal (#10 rilis ini).
 *
 * Pencari pola gagal sekarang hanya bisa menyilangkan lokasi dan bulan. Jadi
 * ketika tiga tanaman mati di bulan yang sama, yang bisa dikatakannya cuma
 * "Februari sering gagal" — padahal penyebabnya mungkin satu minggu hujan
 * deras yang tidak tercatat di mana pun.
 *
 * File ini menerjemahkan angka curah hujan jadi kejadian yang bisa disebut
 * namanya. Sengaja hanya tiga kategori: yang tidak bisa dibedakan pekebun
 * dengan mata sendiri tidak berguna sebagai penjelasan.
 */

export type WeatherEventKind = 'hujan-ekstrem' | 'kering-panjang' | 'normal';

export interface WeatherEvent {
  kind: WeatherEventKind;
  /** Kalimat siap tampil, kosong bila normal. */
  note: string;
}

/**
 * Ambang hujan ekstrem harian, mm.
 *
 * BMKG menyebut hujan sangat lebat mulai 100 mm/hari; di skala pekarangan,
 * 50 mm sehari sudah cukup untuk menggenangi bedengan dan membusukkan akar,
 * jadi itu yang dipakai sebagai ambang peringatan.
 */
const HEAVY_RAIN_MM = 50;

/** Tiga hari tanpa hujan sama sekali sudah terasa di tanah pot. */
const DRY_SPELL_DAYS = 3;

export function classifyWeather(rain: {
  yesterday: number;
  today: number;
  tomorrow: number;
}): WeatherEvent {
  const heaviest = Math.max(rain.yesterday, rain.today, rain.tomorrow);

  if (heaviest >= HEAVY_RAIN_MM) {
    return {
      kind: 'hujan-ekstrem',
      note: `Hujan sangat lebat (${Math.round(heaviest)} mm) — periksa genangan dan drainase bedengan.`,
    };
  }

  // Ramalan besok ikut dihitung: kering yang akan berlanjut lebih berguna
  // diketahui sekarang daripada dikonfirmasi besok lusa.
  const dryDays = [rain.yesterday, rain.today, rain.tomorrow].filter((mm) => mm === 0).length;
  if (dryDays >= DRY_SPELL_DAYS) {
    return {
      kind: 'kering-panjang',
      note: 'Tiga hari tanpa hujan — tambah porsi siram, terutama tanaman dalam pot.',
    };
  }

  return { kind: 'normal', note: '' };
}
