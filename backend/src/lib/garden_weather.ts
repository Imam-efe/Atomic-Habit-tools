/**
 * Siram sadar cuaca (#5).
 *
 * Pengingat siram sebelumnya menyala tanpa memandang cuaca. Di musim hujan itu
 * bukan cuma mubazir — menyiram tanah yang sudah jenuh membusukkan akar. Ini
 * satu-satunya perubahan yang membuat fitur lama jadi lebih benar, bukan
 * sekadar menambah fitur.
 *
 * Sumbernya Open-Meteo: gratis, tanpa API key, batas 10.000 panggilan/hari
 * untuk penggunaan non-komersial.
 */

const API = 'https://api.open-meteo.com/v1/forecast';
const FETCH_TIMEOUT_MS = 6000;

/**
 * Hujan minimal yang dianggap menggantikan satu kali siram, dalam milimeter.
 *
 * 5 mm kira-kira setara penyiraman ringan untuk bedengan dangkal. Sengaja
 * konservatif: melewatkan siram padahal tanah kering lebih merugikan daripada
 * menyiram padahal sudah agak basah.
 */
export const RAIN_SKIP_MM = 5;

/** Hujan sederas ini kemarin berarti tanah masih jenuh hari ini. */
export const RAIN_SOAKED_MM = 20;

export interface DailyRain {
  /** Curah hujan kemarin, mm. */
  yesterday: number;
  /** Curah hujan hari ini sejauh diramalkan, mm. */
  today: number;
  /** Ramalan besok, untuk memberi tahu "tunggu saja, besok hujan". */
  tomorrow: number;
}

export interface WateringVerdict {
  skip: boolean;
  reason: string;
}

/**
 * Putuskan apakah pengingat siram hari ini perlu dikirim.
 *
 * Tidak pernah melewatkan tanpa alasan yang bisa dibaca: pengguna harus tahu
 * kenapa pengingatnya diam, kalau tidak fitur ini terasa seperti kerusakan.
 */
export function shouldSkipWatering(
  rain: DailyRain,
  limits: { skipMm?: number; soakedMm?: number } = {}
): WateringVerdict {
  const skipMm = limits.skipMm ?? RAIN_SKIP_MM;
  const soakedMm = limits.soakedMm ?? RAIN_SOAKED_MM;

  if (rain.yesterday >= soakedMm) {
    return {
      skip: true,
      reason: `Kemarin hujan ${Math.round(rain.yesterday)} mm — tanah masih jenuh, menyiram sekarang berisiko busuk akar.`,
    };
  }
  if (rain.today >= skipMm) {
    return {
      skip: true,
      reason: `Hari ini diperkirakan hujan ${Math.round(rain.today)} mm — cukup menggantikan siram.`,
    };
  }
  if (rain.yesterday >= skipMm) {
    return {
      skip: true,
      reason: `Kemarin sudah hujan ${Math.round(rain.yesterday)} mm.`,
    };
  }
  return { skip: false, reason: '' };
}

/** Catatan tambahan untuk pengingat yang tetap dikirim. */
export function wateringNote(rain: DailyRain, skipMm: number = RAIN_SKIP_MM): string | null {
  if (rain.tomorrow >= skipMm) {
    return `Besok diperkirakan hujan ${Math.round(rain.tomorrow)} mm — siram secukupnya saja.`;
  }
  // Tiga hari kering berturut-turut layak disebut supaya penyiraman ditambah.
  if (rain.yesterday === 0 && rain.today === 0 && rain.tomorrow === 0) {
    return 'Tidak ada hujan kemarin sampai besok — siram lebih banyak dari biasanya.';
  }
  return null;
}

/** Kunci cache, dibulatkan ~1 km supaya pergeseran GPS kecil tetap kena cache. */
export function weatherCacheKey(lat: number, lon: number, date: string): string {
  return `${lat.toFixed(2)}:${lon.toFixed(2)}:${date}`;
}

export function parseRain(payload: unknown): DailyRain | null {
  const daily = (payload as { daily?: { precipitation_sum?: unknown[] } })?.daily;
  const sums = daily?.precipitation_sum;
  if (!Array.isArray(sums) || sums.length < 3) return null;

  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return { yesterday: num(sums[0]), today: num(sums[1]), tomorrow: num(sums[2]) };
}

/**
 * Evapotranspirasi acuan FAO-56 (#14) — perkiraan air yang menguap dari tanah
 * dan tanaman per hari, mm. Open-Meteo menghitungnya langsung dari suhu,
 * kelembapan, angin, dan radiasi matahari, jadi tidak perlu implementasi
 * Penman-Monteith sendiri di sini.
 *
 * Berbeda dari precipitation_sum: nilai null di sini berarti "belum bisa
 * dihitung" (input cuaca dasarnya kurang), bukan nol — jadi dikembalikan
 * apa adanya, tidak dianggap 0 seperti curah hujan.
 */
export function parseEt0(payload: unknown): number | null {
  const daily = (payload as { daily?: { et0_fao_evapotranspiration?: unknown[] } })?.daily;
  const values = daily?.et0_fao_evapotranspiration;
  if (!Array.isArray(values) || values.length < 3) return null;

  const today = values[1];
  return typeof today === 'number' && Number.isFinite(today) ? today : null;
}

export interface WaterBalance {
  et0Today: number;
  rainToday: number;
  /** Kekurangan air hari ini setelah dikurangi hujan, mm — 0 kalau hujan sudah cukup. */
  recommendedMm: number;
}

/**
 * Selisih antara air yang menguap dan air yang sudah turun dari hujan.
 *
 * Dipisah dari pemanggil jaringan supaya bisa diuji langsung dengan angka,
 * tanpa perlu memalsukan balasan Open-Meteo.
 */
export function computeWaterBalance(et0Today: number, rainToday: number): WaterBalance {
  return {
    et0Today,
    rainToday,
    recommendedMm: Math.max(0, Math.round((et0Today - rainToday) * 10) / 10),
  };
}

/**
 * Ambil (atau baca dari cache) balasan mentah Open-Meteo untuk satu hari.
 *
 * `getRain` dan `getWaterBalance` sama-sama butuh payload ini — dipisah
 * supaya keduanya berbagi satu baris cache dan satu panggilan jaringan,
 * bukan masing-masing memanggil Open-Meteo sendiri-sendiri.
 */
async function fetchWeatherPayload(
  db: D1Database,
  lat: number,
  lon: number,
  today: string
): Promise<unknown | null> {
  const key = weatherCacheKey(lat, lon, today);

  const cached = await db
    .prepare('SELECT payload FROM garden_weather_cache WHERE cache_key = ?1')
    .bind(key)
    .first<{ payload: string }>();

  if (cached) {
    try {
      return JSON.parse(cached.payload);
    } catch {
      // Cache rusak: ambil ulang daripada gagal.
    }
  }

  const url =
    `${API}?latitude=${lat}&longitude=${lon}` +
    `&daily=precipitation_sum,et0_fao_evapotranspiration&timezone=Asia%2FJakarta&past_days=1&forecast_days=2`;

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!response.ok) {
      console.warn(`[garden_weather] Open-Meteo membalas ${response.status}`);
      return null;
    }

    const payload = await response.json();

    await db
      .prepare(
        `INSERT INTO garden_weather_cache (cache_key, payload, fetched_at)
         VALUES (?1, ?2, unixepoch())
         ON CONFLICT (cache_key) DO UPDATE SET payload = excluded.payload, fetched_at = excluded.fetched_at`
      )
      .bind(key, JSON.stringify(payload))
      .run();

    return payload;
  } catch (err) {
    console.warn(`[garden_weather] gagal mengambil cuaca: ${err instanceof Error ? err.message : 'unknown'}`);
    return null;
  }
}

/**
 * Ambil curah hujan kemarin, hari ini, dan besok, lewat cache harian.
 *
 * Mengembalikan null kalau tidak tersedia — pemanggil harus memperlakukan itu
 * sebagai "tidak tahu" dan tetap mengirim pengingat, bukan menganggap kering
 * atau menganggap hujan.
 */
export async function getRain(
  db: D1Database,
  lat: number,
  lon: number,
  today: string
): Promise<DailyRain | null> {
  const payload = await fetchWeatherPayload(db, lat, lon, today);
  return payload ? parseRain(payload) : null;
}

/**
 * Kebutuhan air presisi hari ini (#14): evapotranspirasi dikurangi hujan yang
 * sudah turun.
 *
 * Mengembalikan null kalau salah satu datanya tidak tersedia — termasuk baris
 * cache lama dari sebelum fitur ini yang belum menyimpan
 * `et0_fao_evapotranspiration` sama sekali. Baris begitu akan digantikan cache
 * baru begitu tanggalnya berganti, tapi sampai saat itu fitur ini diam
 * daripada menghitung dari data yang tidak ada.
 */
export async function getWaterBalance(
  db: D1Database,
  lat: number,
  lon: number,
  today: string
): Promise<WaterBalance | null> {
  const payload = await fetchWeatherPayload(db, lat, lon, today);
  if (!payload) return null;

  const et0Today = parseEt0(payload);
  const rain = parseRain(payload);
  if (et0Today === null || !rain) return null;

  return computeWaterBalance(et0Today, rain.today);
}
