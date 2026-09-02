/**
 * Satu tempat untuk "tugas spesies ini yang menempel ke kandang".
 *
 * jadwalSubjek hanya menagih tugas bersasaran `kandang` lewat kandangnya.
 * Hewan yang dicatat tanpa kandang karena itu diam-diam kehilangan seluruh
 * tugas tersebut: tugasnya tidak dimiliki siapa pun dan tidak akan pernah
 * muncul di jadwal. Itu perilaku yang benar — memaksa tiap hewan punya
 * "kandang bernama Rumah" cuma melahirkan baris palsu (lihat migrasi 0040) —
 * tapi pengguna harus diberi tahu, kalau tidak ia cuma melihat jadwal kosong
 * tanpa penjelasan.
 *
 * Predikat dan kalimat peringatannya dipakai di tiga tempat: GET /api/ternak,
 * POST /api/ternak/hewan, dan alat AI ternak.tambah. Ditulis terpisah di
 * masing-masing, ketiganya pasti menyimpang — dan pengguna yang menambah
 * hewan lewat suara akan diberi tahu hal yang berbeda dari yang menambah
 * lewat formulir, untuk keadaan yang sama persis.
 */

import { ANIMAL_BY_ID, type TugasKatalog } from '../data/animals';

/**
 * Tugas bersasaran kandang milik satu spesies katalog.
 *
 * Mengembalikan array kosong untuk hewan tanpa spesies (nama kustom): tanpa
 * entri katalog tidak ada tugas yang bisa jadi dorman.
 */
export function tugasKandang(animalId: string | null | undefined): TugasKatalog[] {
  if (!animalId) return [];
  return ANIMAL_BY_ID.get(animalId)?.tugas.filter((t) => t.sasaran === 'kandang') ?? [];
}

/**
 * Kalimat peringatan untuk hewan berspesies yang dicatat tanpa kandang.
 *
 * null kalau tidak ada yang perlu diperingatkan — hewan sudah punya kandang,
 * tidak punya spesies, atau spesiesnya memang tidak punya tugas kandang sama
 * sekali (3 dari 61 spesies).
 */
export function peringatanDorman(
  animalId: string | null | undefined,
  kandangId: string | null | undefined
): string | null {
  if (kandangId) return null;
  const dorman = tugasKandang(animalId);
  if (dorman.length === 0) return null;
  return `${dorman.length} tugas perawatan spesies ini menempel ke kandang, jadi belum dijadwalkan karena hewan ini belum punya kandang. Pilih kandang untuk mengaktifkannya.`;
}
