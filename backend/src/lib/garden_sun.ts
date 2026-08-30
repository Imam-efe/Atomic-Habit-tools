/**
 * Peta matahari: mencocokkan kebutuhan cahaya katalog dengan yang benar-benar
 * tersedia di tiap sudut kebun.
 *
 * Katalog sudah lama menyimpan kolom `sunlight` untuk tiap tanaman, tapi tidak
 * ada satu pun fitur yang menalar di atasnya — kebutuhan itu tersimpan lalu
 * ditampilkan, tidak pernah dibandingkan dengan apa pun. Sisi yang hilang
 * adalah jam matahari yang TERSEDIA, dan itu tidak bisa dihitung dari garis
 * lintang: pohon mangga tetangga dan atap dapur tidak ada di peta astronomi
 * mana pun. Jadi angkanya diamati sendiri oleh pengguna, sekali, per lokasi.
 *
 * Salah menaruh adalah penyebab gagal yang paling sering di kebun rumahan dan
 * paling jarang disadari — tanamannya "kurang subur" berbulan-bulan tanpa ada
 * yang menghubungkannya dengan tembok di sebelah barat.
 */

export type Sunlight = 'penuh' | 'sebagian' | 'teduh';

/** Cocok, kurang cahaya, atau justru terlalu terik. */
export type KecocokanMatahari = 'cocok' | 'kurang' | 'terlalu-terik';

export interface RentangJam {
  /** Jam minimum matahari langsung; di bawah ini tanaman kurang cahaya. */
  min: number;
  /**
   * Jam maksimum yang masih aman; di atas ini daun terbakar. `null` berarti
   * tidak ada batas atas yang realistis di Indonesia.
   */
  max: number | null;
}

/**
 * Kebutuhan jam matahari langsung per golongan katalog.
 *
 * Batas ATAS sengaja ada untuk 'sebagian' dan 'teduh'. Panduan berkebun
 * biasanya hanya menyebut minimum, seolah kelebihan matahari selalu aman —
 * di Indonesia itu tidak benar. Selada dan tanaman hias daun yang kena
 * matahari penuh seharian akan gosong tepinya, dan itu kegagalan yang sama
 * nyatanya dengan kurang cahaya. Tanpa batas atas, aplikasi hanya bisa
 * menyalahkan satu arah.
 */
export const KEBUTUHAN_JAM: Record<Sunlight, RentangJam> = {
  penuh: { min: 6, max: null },
  sebagian: { min: 3, max: 7 },
  teduh: { min: 1, max: 4 },
};

export const LABEL_SUNLIGHT: Record<Sunlight, string> = {
  penuh: 'Matahari penuh',
  sebagian: 'Setengah teduh',
  teduh: 'Teduh',
};

/** Batas jam yang masuk akal untuk dicatat; di khatulistiwa siang ~12 jam. */
export const MAX_JAM_MATAHARI = 14;

/** Jepit jam ke rentang yang masuk akal, dan bulatkan ke setengah jam. */
export function bersihkanJam(jam: number): number {
  if (!Number.isFinite(jam)) return 0;
  const dijepit = Math.min(MAX_JAM_MATAHARI, Math.max(0, jam));
  return Math.round(dijepit * 2) / 2;
}

/** Apakah jam yang tersedia cocok untuk kebutuhan tanaman ini. */
export function cocokMatahari(jamTersedia: number, butuh: Sunlight): KecocokanMatahari {
  const rentang = KEBUTUHAN_JAM[butuh];
  if (jamTersedia < rentang.min) return 'kurang';
  if (rentang.max !== null && jamTersedia > rentang.max) return 'terlalu-terik';
  return 'cocok';
}

export interface ProfilMatahari {
  lokasiId: string;
  lokasiLabel: string;
  jamLangsung: number;
}

export interface PenanamanUntukCek {
  plantingId: string;
  label: string;
  /** Kunci lokasi: id bedengan, atau `loc:<teks>`. Null = belum ditempatkan. */
  lokasiId: string | null;
  /** Kebutuhan dari katalog. Null = tanaman di luar katalog, tidak bisa dinilai. */
  butuh: Sunlight | null;
}

export interface PeringatanMatahari {
  plantingId: string;
  label: string;
  lokasiId: string;
  lokasiLabel: string;
  jamLangsung: number;
  butuh: Sunlight;
  kecocokan: Exclude<KecocokanMatahari, 'cocok'>;
  message: string;
}

/**
 * Tanaman yang berada di tempat yang tidak sesuai kebutuhan cahayanya.
 *
 * Yang TIDAK punya profil matahari sengaja dilewati diam-diam, bukan dianggap
 * bermasalah: belum diukur bukan berarti salah tempat, dan menuduh setiap
 * lokasi yang belum sempat diamati akan membuat daftar ini terlalu berisik
 * untuk dibaca sejak hari pertama.
 */
export function cariSalahTempat(
  penanaman: ReadonlyArray<PenanamanUntukCek>,
  profil: ReadonlyArray<ProfilMatahari>
): PeringatanMatahari[] {
  const byLokasi = new Map(profil.map((p) => [p.lokasiId, p]));
  const hasil: PeringatanMatahari[] = [];

  for (const p of penanaman) {
    if (!p.lokasiId || !p.butuh) continue;
    const lokasi = byLokasi.get(p.lokasiId);
    if (!lokasi) continue;

    const kecocokan = cocokMatahari(lokasi.jamLangsung, p.butuh);
    if (kecocokan === 'cocok') continue;

    const rentang = KEBUTUHAN_JAM[p.butuh];
    const message =
      kecocokan === 'kurang'
        ? `${p.label} di ${lokasi.lokasiLabel} dapat ${lokasi.jamLangsung} jam matahari, ` +
          `padahal butuh minimal ${rentang.min} jam. Tumbuhnya akan kurus dan panennya sedikit — ` +
          `pindahkan ke tempat yang lebih terbuka.`
        : `${p.label} di ${lokasi.lokasiLabel} dapat ${lokasi.jamLangsung} jam matahari, ` +
          `padahal cukup ${rentang.max} jam. Daunnya bisa gosong di tepi — ` +
          `beri naungan siang atau pindahkan ke tempat yang lebih teduh.`;

    hasil.push({
      plantingId: p.plantingId,
      label: p.label,
      lokasiId: lokasi.lokasiId,
      lokasiLabel: lokasi.lokasiLabel,
      jamLangsung: lokasi.jamLangsung,
      butuh: p.butuh,
      kecocokan,
      message,
    });
  }

  return hasil;
}

/**
 * Lokasi mana saja yang cocok untuk satu kebutuhan cahaya.
 *
 * Dipakai dua arah: menjawab "di mana sebaiknya ini ditanam" saat menanam, dan
 * menyaring wishlist jadi jujur — ingin tomat tapi tidak punya satu pun tempat
 * enam jam matahari adalah hal yang lebih baik diketahui sebelum benihnya
 * dibeli, bukan sesudah tiga bulan menunggu buah yang tidak datang.
 */
export function lokasiCocokUntuk(
  butuh: Sunlight,
  profil: ReadonlyArray<ProfilMatahari>
): ProfilMatahari[] {
  return profil.filter((p) => cocokMatahari(p.jamLangsung, butuh) === 'cocok');
}
