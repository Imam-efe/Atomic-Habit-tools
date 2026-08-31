/**
 * Cocokkan pH tanah yang diukur sendiri dengan pH yang diminta tanaman.
 *
 * Katalog menyimpan `phRange` untuk tiap tanaman sejak berkas plants.ts
 * ditulis, tapi sampai sekarang angka itu tidak pernah dibandingkan dengan apa
 * pun — tidak ada tempat menyimpan pH tanah yang sebenarnya. Ini sisi yang
 * hilang, sama seperti jam matahari sebelum garden_sun.ts ada.
 *
 * Kenapa penting di Indonesia: tanah masam adalah keadaan bawaan di banyak
 * daerah, dan tanaman yang mandek karenanya terlihat persis seperti tanaman
 * yang kurang pupuk. Pekebun lalu menambah pupuk — yang tidak menolong, karena
 * haranya sudah ada di tanah tapi terkunci oleh pH.
 */

/** Di luar rentang ini hampir pasti salah ketik, bukan tanah yang aneh. */
export const PH_MIN = 3.5;
export const PH_MAX = 9.5;

export type StatusPh = 'cocok' | 'terlalu-masam' | 'terlalu-basa';

export function bersihkanPh(nilai: unknown): number | null {
  const n = typeof nilai === 'string' ? Number(nilai) : nilai;
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  if (n < PH_MIN || n > PH_MAX) return null;
  return n;
}

export function cocokPh(range: [number, number], ph: number): StatusPh {
  if (ph < range[0]) return 'terlalu-masam';
  if (ph > range[1]) return 'terlalu-basa';
  return 'cocok';
}

/**
 * Dosis dolomit kasar per 100 m², kg, untuk menaikkan pH satu satuan.
 *
 * Bergantung daya sangga tanah: pasir hampir tidak menyangga, liat menyangga
 * kuat. Angka ini panduan pekarangan, bukan rekomendasi agronomi — karena itu
 * saran selalu menutup dengan ajakan mengukur ulang, dan dosis tidak disebut
 * sama sekali kalau teksturnya tidak diketahui. Menyebut angka tanpa tahu
 * teksturnya sama saja mengarang.
 */
const DOSIS_DOLOMIT: Record<string, number> = {
  pasir: 15,
  lempung: 25,
  liat: 40,
};

export function saranPerbaikan(
  range: [number, number],
  ph: number,
  texture: string | null
): string | null {
  const status = cocokPh(range, ph);
  if (status === 'cocok') return null;

  if (status === 'terlalu-masam') {
    const selisih = Math.max(0.5, range[0] - ph);
    const dosis = texture ? DOSIS_DOLOMIT[texture] : undefined;
    const takaran = dosis ? ` Perkiraan ${(dosis * selisih).toFixed(0)} kg per 100 m².` : '';
    return (
      `Tanah terlalu masam (pH ${ph}, tanaman minta ${range[0]}–${range[1]}). ` +
      `Tabur dolomit lalu diamkan 2–3 pekan sebelum tanam.${takaran} Ukur ulang sesudahnya.`
    );
  }

  return (
    `Tanah terlalu basa (pH ${ph}, tanaman minta ${range[0]}–${range[1]}). ` +
    `Tambah kompos matang atau pupuk kandang; untuk penurunan yang lebih cepat pakai belerang. ` +
    `Jangan dikapur. Ukur ulang sesudah 3–4 pekan.`
  );
}

export interface UjiTanah {
  lokasiId: string;
  lokasiLabel: string;
  ph: number;
  texture: string | null;
  testedDate: string;
}

export interface TanamanDiLokasi {
  plantingId: string;
  nama: string;
  plantId: string | null;
  lokasiId: string;
}

export interface SalahTanah {
  plantingId: string;
  nama: string;
  lokasiId: string;
  lokasiLabel: string;
  ph: number;
  status: 'terlalu-masam' | 'terlalu-basa';
  saran: string | null;
}

/** Uji paling akhir untuk tiap lokasi. */
export function ujiTerbaru(uji: UjiTanah[]): Map<string, UjiTanah> {
  const terbaru = new Map<string, UjiTanah>();
  for (const u of uji) {
    const ada = terbaru.get(u.lokasiId);
    if (!ada || u.testedDate > ada.testedDate) terbaru.set(u.lokasiId, u);
  }
  return terbaru;
}

/**
 * Tanaman yang berdiri di tanah dengan pH di luar syaratnya.
 *
 * Lokasi yang belum pernah diuji sengaja dilewati, bukan dianggap bermasalah:
 * peringatan tanpa pengukuran adalah tebakan, dan tebakan yang sering salah
 * membuat pengguna berhenti membaca semua peringatan.
 */
export function cariSalahTanah(
  plantings: TanamanDiLokasi[],
  uji: UjiTanah[],
  phByPlant: Map<string, [number, number]>
): SalahTanah[] {
  // Satu lokasi bisa diuji berkali-kali. Yang berlaku hanya yang terbaru —
  // memakai yang lama membuat peringatan bertahan sesudah tanahnya diperbaiki.
  const terbaru = ujiTerbaru(uji);

  const hasil: SalahTanah[] = [];
  for (const t of plantings) {
    if (!t.plantId) continue;
    const range = phByPlant.get(t.plantId);
    if (!range) continue;

    const u = terbaru.get(t.lokasiId);
    if (!u) continue;

    const status = cocokPh(range, u.ph);
    if (status === 'cocok') continue;

    hasil.push({
      plantingId: t.plantingId,
      nama: t.nama,
      lokasiId: t.lokasiId,
      lokasiLabel: u.lokasiLabel,
      ph: u.ph,
      status,
      saran: saranPerbaikan(range, u.ph, u.texture),
    });
  }
  return hasil;
}
