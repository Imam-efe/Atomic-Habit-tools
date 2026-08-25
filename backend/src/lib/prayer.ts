/**
 * Perhitungan waktu salat.
 *
 * Dihitung, bukan diambil dari API. Tiga alasan: koordinat rumah pengguna
 * sudah tersimpan untuk cuaca kebun, jadwal salat harus tetap muncul saat
 * ponsel offline, dan satu panggilan jaringan per hari untuk angka yang
 * ditentukan sepenuhnya oleh posisi matahari adalah ketergantungan yang tidak
 * memberi apa-apa.
 *
 * Algoritmenya standar: posisi matahari (deklinasi dan persamaan waktu) dari
 * hari Julian, lalu sudut jam untuk tiap ketinggian matahari yang menandai
 * awal waktu. Yang berbeda antar metode hanyalah sudut Subuh dan Isya, dan
 * itu memang perbedaan pendapat — bukan perbedaan perhitungan.
 *
 * Sudut bawaan mengikuti Kemenag (Subuh 20°, Isya 18°) karena itu yang dipakai
 * jadwal masjid di Indonesia.
 *
 * Hasilnya bisa berbeda satu sampai dua menit dari jadwal Kemenag yang
 * dicetak, dan itu bukan kesalahan yang bisa dihilangkan: jadwal resmi
 * menambahkan menit ihtiyat — kehati-hatian yang sengaja — dan besarnya tidak
 * seragam antar daerah. Karena itu yang disediakan bukan klaim "sama persis",
 * melainkan penyesuaian per waktu dalam menit, supaya pengguna bisa
 * menyamakannya dengan masjid di depan rumahnya. Itu jadwal yang benar-benar
 * diikuti orang.
 */

export type PrayerMethod = 'kemenag' | 'mwl';
export type AsrMethod = 'syafii' | 'hanafi';

export interface PrayerAngles {
  /** Derajat matahari di bawah ufuk saat Subuh. */
  fajr: number;
  /** Derajat matahari di bawah ufuk saat Isya. */
  isha: number;
}

export const METHODS: Record<PrayerMethod, PrayerAngles> = {
  // Kemenag RI — dipakai jadwal masjid di Indonesia.
  kemenag: { fajr: 20, isha: 18 },
  // Muslim World League.
  mwl: { fajr: 18, isha: 17 },
};

export type PrayerName = 'subuh' | 'terbit' | 'dzuhur' | 'ashar' | 'maghrib' | 'isya';

export const PRAYER_ORDER: PrayerName[] = ['subuh', 'terbit', 'dzuhur', 'ashar', 'maghrib', 'isya'];

export const PRAYER_LABEL: Record<PrayerName, string> = {
  subuh: 'Subuh',
  terbit: 'Terbit',
  dzuhur: 'Dzuhur',
  ashar: 'Ashar',
  maghrib: 'Maghrib',
  isya: 'Isya',
};

/** Jadwal satu hari, jam dalam format HH:MM waktu setempat. */
export type PrayerTimes = Record<PrayerName, string>;

const RAD = Math.PI / 180;

/** Hari Julian dari tanggal Masehi. */
export function julianDay(year: number, month: number, day: number): number {
  let y = year;
  let m = month;
  if (m <= 2) {
    y -= 1;
    m += 12;
  }
  const a = Math.floor(y / 100);
  const b = 2 - a + Math.floor(a / 4);
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + day + b - 1524.5;
}

/**
 * Deklinasi matahari (derajat) dan persamaan waktu (menit).
 *
 * Deklinasi menentukan seberapa tinggi matahari bisa naik di lintang itu;
 * persamaan waktu adalah selisih antara tengah hari menurut jam dan tengah
 * hari menurut matahari, yang bisa mencapai seperempat jam.
 */
export function sunPosition(jd: number): { declination: number; equationOfTime: number } {
  const d = jd - 2451545.0;

  const g = (357.529 + 0.98560028 * d) % 360;          // anomali rata-rata
  const q = (280.459 + 0.98564736 * d) % 360;          // bujur rata-rata
  const l = (q + 1.915 * Math.sin(g * RAD) + 0.020 * Math.sin(2 * g * RAD)) % 360;

  const e = 23.439 - 0.00000036 * d;                   // kemiringan sumbu bumi

  const declination = Math.asin(Math.sin(e * RAD) * Math.sin(l * RAD)) / RAD;

  let ra = Math.atan2(Math.cos(e * RAD) * Math.sin(l * RAD), Math.cos(l * RAD)) / RAD;
  ra = ((ra % 360) + 360) % 360;

  // Persamaan waktu dalam menit; selisih bujur dinormalkan supaya tidak
  // melompat 24 jam di sekitar pergantian tahun.
  let eqt = q / 15 - ra / 15;
  if (eqt > 12) eqt -= 24;
  if (eqt < -12) eqt += 24;

  return { declination, equationOfTime: eqt * 60 };
}

/**
 * Sudut jam (jam) untuk matahari pada ketinggian tertentu.
 *
 * NaN bila matahari tidak pernah mencapai ketinggian itu pada hari dan
 * lintang tersebut — nyata di lintang tinggi, tidak pernah terjadi di
 * Indonesia, tapi pemanggil tetap harus menanganinya.
 */
export function hourAngle(latitude: number, declination: number, altitude: number): number {
  const cosH =
    (Math.sin(altitude * RAD) - Math.sin(latitude * RAD) * Math.sin(declination * RAD)) /
    (Math.cos(latitude * RAD) * Math.cos(declination * RAD));

  if (cosH > 1 || cosH < -1) return NaN;
  return Math.acos(cosH) / RAD / 15;
}

/** Jam desimal jadi "HH:MM", dibulatkan ke menit terdekat. */
export function formatJam(hours: number): string {
  if (!Number.isFinite(hours)) return '--:--';

  let total = Math.round(hours * 60);
  // Pembulatan bisa mendorong 23:59:40 ke hari berikutnya; dinormalkan supaya
  // tidak pernah muncul "24:00".
  total = ((total % 1440) + 1440) % 1440;

  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export interface PrayerInput {
  date: string;
  latitude: number;
  longitude: number;
  /** Selisih jam dari UTC. WIB = 7. */
  timezone: number;
  method?: PrayerMethod;
  asrMethod?: AsrMethod;
  /** Penyesuaian menit per waktu, untuk mencocokkan jadwal masjid setempat. */
  adjust?: Partial<Record<PrayerName, number>>;
}

/**
 * Ketinggian matahari saat terbit dan terbenam.
 *
 * Bukan nol: piringan matahari punya lebar, dan cahayanya dibelokkan atmosfer,
 * jadi matahari terlihat terbit saat pusatnya masih sedikit di bawah ufuk.
 */
const ALTITUDE_TERBIT = -0.833;

export function hitungJadwalSalat(input: PrayerInput): PrayerTimes {
  const [y, m, d] = input.date.split('-').map(Number);
  const angles = METHODS[input.method ?? 'kemenag'] ?? METHODS.kemenag;
  const shadowFactor = input.asrMethod === 'hanafi' ? 2 : 1;

  const jd = julianDay(y, m, d);
  const { declination, equationOfTime } = sunPosition(jd);

  // Tengah hari matahari di bujur ini, dalam jam waktu setempat.
  const dzuhur = 12 + input.timezone - input.longitude / 15 - equationOfTime / 60;

  const lat = input.latitude;
  const sunriseHA = hourAngle(lat, declination, ALTITUDE_TERBIT);
  const fajrHA = hourAngle(lat, declination, -angles.fajr);
  const ishaHA = hourAngle(lat, declination, -angles.isha);

  // Ashar: saat panjang bayangan benda sama dengan tingginya (Syafi'i) atau
  // dua kalinya (Hanafi), ditambah panjang bayangan saat matahari tertinggi.
  const asrAltitude =
    Math.atan(1 / (shadowFactor + Math.tan(Math.abs(lat - declination) * RAD))) / RAD;
  const asrHA = hourAngle(lat, declination, asrAltitude);

  const raw: PrayerTimes = {
    subuh: formatJam(dzuhur - fajrHA),
    terbit: formatJam(dzuhur - sunriseHA),
    dzuhur: formatJam(dzuhur),
    ashar: formatJam(dzuhur + asrHA),
    maghrib: formatJam(dzuhur + sunriseHA),
    isya: formatJam(dzuhur + ishaHA),
  };

  const adjust = input.adjust ?? {};
  const out = {} as PrayerTimes;
  for (const name of PRAYER_ORDER) {
    const menit = adjust[name];
    out[name] = typeof menit === 'number' && Number.isFinite(menit)
      ? geserMenit(raw[name], Math.round(menit))
      : raw[name];
  }
  return out;
}

/** Geser "HH:MM" sekian menit, tetap dalam satu hari. */
export function geserMenit(jam: string, menit: number): string {
  if (jam === '--:--') return jam;
  const [h, m] = jam.split(':').map(Number);
  return formatJam((h * 60 + m + menit) / 60);
}

export interface NextPrayer {
  name: PrayerName;
  label: string;
  time: string;
  /** Menit dari sekarang. */
  inMinutes: number;
  /** Benar bila waktu berikutnya jatuh besok (setelah Isya). */
  besok: boolean;
}

/**
 * Waktu salat berikutnya dari jam sekarang.
 *
 * "Terbit" dilewati: ia penanda batas akhir Subuh, bukan waktu salat, dan
 * menampilkannya sebagai "berikutnya" akan membingungkan.
 */
export function salatBerikutnya(times: PrayerTimes, sekarang: string): NextPrayer | null {
  const menitDari = (jam: string) => {
    const [h, m] = jam.split(':').map(Number);
    return h * 60 + m;
  };

  if (!/^\d{2}:\d{2}$/.test(sekarang)) return null;
  const now = menitDari(sekarang);

  const daftar = PRAYER_ORDER.filter((n) => n !== 'terbit' && times[n] !== '--:--');
  if (daftar.length === 0) return null;

  for (const name of daftar) {
    const t = menitDari(times[name]);
    if (t > now) {
      return { name, label: PRAYER_LABEL[name], time: times[name], inMinutes: t - now, besok: false };
    }
  }

  // Sudah lewat Isya: yang berikutnya Subuh besok.
  const subuh = daftar[0];
  return {
    name: subuh,
    label: PRAYER_LABEL[subuh],
    time: times[subuh],
    inMinutes: 1440 - now + menitDari(times[subuh]),
    besok: true,
  };
}
