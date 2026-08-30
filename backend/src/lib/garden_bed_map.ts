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

/**
 * Penanda bukan-tanaman di denah: jalan setapak, pot kompos, rak.
 *
 * Diperlakukan sebagai lingkaran radius tetap, sama seperti tanaman —
 * satu rumus tabrakan untuk keduanya, bukan dua sistem geometri berbeda
 * yang harus dijaga konsisten sendiri-sendiri.
 */
export interface BedMarker {
  id: string;
  label: string;
  posX: number;
  posY: number;
  radiusCm: number;
}

export type IssueKind = 'keluar-batas' | 'terlalu-rapat';

export interface BedIssue {
  kind: IssueKind;
  plantingIds: string[];
  /** Terisi kalau salah satu (atau kedua) pihak yang bertabrakan adalah penanda, bukan tanaman. */
  markerIds: string[];
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

/** Bentuk seragam untuk tanaman dan penanda, supaya rumus tabrakan satu saja. */
interface Occupant {
  plantingId: string | null;
  markerId: string | null;
  name: string;
  posX: number;
  posY: number;
  radiusCm: number;
}

function occupantsOf(slots: BedSlot[], markers: BedMarker[]): Occupant[] {
  return [
    ...slots.map((s): Occupant => ({
      plantingId: s.plantingId, markerId: null, name: s.name,
      posX: s.posX, posY: s.posY, radiusCm: radiusOf(s),
    })),
    ...markers.map((m): Occupant => ({
      plantingId: null, markerId: m.id, name: m.label,
      posX: m.posX, posY: m.posY, radiusCm: m.radiusCm > 0 ? m.radiusCm : FALLBACK_SPACING_CM / 2,
    })),
  ];
}

/**
 * Periksa satu bedengan: ada yang keluar batas, ada yang berebut ruang.
 *
 * Dua penghuni — tanaman atau penanda seperti jalan/kompos/rak — dianggap
 * terlalu rapat kalau jarak antar titiknya lebih kecil dari jumlah radius
 * keduanya: persis definisi dua lingkaran bersinggungan. Penanda ikut
 * diperiksa dengan rumus yang sama karena keduanya sama-sama memakai ruang
 * fisik di bedengan — pot kompos yang menumpuk dengan tanaman adalah
 * masalah tata letak yang sama nyatanya dengan dua tanaman terlalu rapat.
 */
export function inspectBed(bed: Bed, slots: BedSlot[], markers: BedMarker[] = []): BedMapReport {
  const issues: BedIssue[] = [];
  const occupants = occupantsOf(slots, markers);

  for (const o of occupants) {
    const outLeft = o.posX - o.radiusCm < 0;
    const outTop = o.posY - o.radiusCm < 0;
    const outRight = o.posX + o.radiusCm > bed.widthCm;
    const outBottom = o.posY + o.radiusCm > bed.lengthCm;

    if (outLeft || outTop || outRight || outBottom) {
      issues.push({
        kind: 'keluar-batas',
        plantingIds: o.plantingId ? [o.plantingId] : [],
        markerIds: o.markerId ? [o.markerId] : [],
        message: `${o.name} melewati tepi bedengan; butuh ruang ${Math.round(o.radiusCm * 2)} cm.`,
      });
    }
  }

  for (let i = 0; i < occupants.length; i++) {
    for (let j = i + 1; j < occupants.length; j++) {
      const a = occupants[i];
      const b = occupants[j];
      const dx = a.posX - b.posX;
      const dy = a.posY - b.posY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const needed = a.radiusCm + b.radiusCm;

      if (distance < needed) {
        issues.push({
          kind: 'terlalu-rapat',
          plantingIds: [a.plantingId, b.plantingId].filter((id): id is string => id !== null),
          markerIds: [a.markerId, b.markerId].filter((id): id is string => id !== null),
          message: `${a.name} dan ${b.name} berjarak ${Math.round(distance)} cm, sebaiknya minimal ${Math.round(needed)} cm.`,
        });
      }
    }
  }

  const bedArea = Math.max(1, bed.widthCm * bed.lengthCm);
  const usedArea = occupants.reduce((sum, o) => sum + Math.PI * o.radiusCm ** 2, 0);

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
  stepCm = 5,
  markers: BedMarker[] = []
): { posX: number; posY: number } | null {
  const r = (spacingCm > 0 ? spacingCm : FALLBACK_SPACING_CM) / 2;
  const occupants = occupantsOf(slots, markers);

  for (let y = Math.ceil(r); y <= bed.lengthCm - r; y += stepCm) {
    for (let x = Math.ceil(r); x <= bed.widthCm - r; x += stepCm) {
      const clashes = occupants.some((o) => {
        const dx = x - o.posX;
        const dy = y - o.posY;
        return Math.sqrt(dx * dx + dy * dy) < r + o.radiusCm;
      });
      if (!clashes) return { posX: x, posY: y };
    }
  }

  return null;
}
