/**
 * Denah bedengan (#8).
 *
 * Perencana susun-tanam yang ada sekarang menjawab "boleh tidak ditanam
 * berdampingan" dengan kalimat. Yang tidak dijawabnya: apakah muat, dan di
 * sebelah mana persisnya. Begitu posisi punya koordinat, dua pertanyaan itu
 * bisa diperiksa sendiri oleh aplikasi.
 *
 * Modelnya sederhana dan sengaja begitu: bedengan adalah persegi panjang dalam
 * sentimeter, tanaman adalah titik dengan radius jarak tanam. Kebun rumahan
 * tidak butuh geometri yang lebih rumit dari ini.
 */

export interface Bed {
  id: string;
  name: string;
  widthCm: number;
  lengthCm: number;
}

export interface BedSlot {
  plantingId: string;
  name: string;
  posX: number;
  posY: number;
  /** Jarak tanam dari katalog, cm. Jadi diameter ruang yang dibutuhkan. */
  spacingCm: number;
}

export type IssueKind = 'keluar-batas' | 'terlalu-rapat';

export interface BedIssue {
  kind: IssueKind;
  plantingIds: string[];
  message: string;
}

export interface BedMapReport {
  bedId: string;
  slotCount: number;
  /** Persen luas bedengan yang sudah terpakai lingkaran jarak tanam. */
  usedPercent: number;
  issues: BedIssue[];
}

/** Jarak tanam yang tidak diketahui katalog; dipakai supaya tetap bisa dicek. */
const FALLBACK_SPACING_CM = 20;

function radiusOf(slot: BedSlot): number {
  const spacing = slot.spacingCm > 0 ? slot.spacingCm : FALLBACK_SPACING_CM;
  return spacing / 2;
}

/**
 * Periksa satu bedengan: ada yang keluar batas, ada yang berebut ruang.
 *
 * Dua tanaman dianggap terlalu rapat kalau jarak antar titiknya lebih kecil
 * dari jumlah radius keduanya — persis definisi dua lingkaran bersinggungan.
 * Itu memakai jarak tanam masing-masing, jadi cabai berdampingan bayam dinilai
 * dengan angkanya sendiri-sendiri, bukan satu angka rata-rata.
 */
export function inspectBed(bed: Bed, slots: BedSlot[]): BedMapReport {
  const issues: BedIssue[] = [];

  for (const s of slots) {
    const r = radiusOf(s);
    const outLeft = s.posX - r < 0;
    const outTop = s.posY - r < 0;
    const outRight = s.posX + r > bed.widthCm;
    const outBottom = s.posY + r > bed.lengthCm;

    if (outLeft || outTop || outRight || outBottom) {
      issues.push({
        kind: 'keluar-batas',
        plantingIds: [s.plantingId],
        message: `${s.name} melewati tepi bedengan; butuh ruang ${Math.round(r * 2)} cm.`,
      });
    }
  }

  for (let i = 0; i < slots.length; i++) {
    for (let j = i + 1; j < slots.length; j++) {
      const a = slots[i];
      const b = slots[j];
      const dx = a.posX - b.posX;
      const dy = a.posY - b.posY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const needed = radiusOf(a) + radiusOf(b);

      if (distance < needed) {
        issues.push({
          kind: 'terlalu-rapat',
          plantingIds: [a.plantingId, b.plantingId],
          message: `${a.name} dan ${b.name} berjarak ${Math.round(distance)} cm, sebaiknya minimal ${Math.round(needed)} cm.`,
        });
      }
    }
  }

  const bedArea = Math.max(1, bed.widthCm * bed.lengthCm);
  const usedArea = slots.reduce((sum, s) => sum + Math.PI * radiusOf(s) ** 2, 0);

  return {
    bedId: bed.id,
    slotCount: slots.length,
    // Dikunci di 100%: bedengan yang kelewat penuh tetap "penuh", dan
    // masalahnya sudah dilaporkan lewat issues, bukan lewat angka 140%.
    usedPercent: Math.min(100, Math.round((usedArea / bedArea) * 100)),
    issues,
  };
}

/**
 * Titik kosong terdekat untuk menaruh tanaman baru.
 *
 * Dicari dengan menyapu grid kasar, bukan optimasi penempatan: pengguna toh
 * bisa menggeser sendiri, dan saran yang bisa langsung dipakai lebih berguna
 * daripada penempatan optimal yang lambat dihitung.
 */
export function suggestSlot(
  bed: Bed,
  slots: BedSlot[],
  spacingCm: number,
  stepCm = 5
): { posX: number; posY: number } | null {
  const r = (spacingCm > 0 ? spacingCm : FALLBACK_SPACING_CM) / 2;

  for (let y = Math.ceil(r); y <= bed.lengthCm - r; y += stepCm) {
    for (let x = Math.ceil(r); x <= bed.widthCm - r; x += stepCm) {
      const clashes = slots.some((s) => {
        const dx = x - s.posX;
        const dy = y - s.posY;
        return Math.sqrt(dx * dx + dy * dy) < r + radiusOf(s);
      });
      if (!clashes) return { posX: x, posY: y };
    }
  }

  return null;
}
