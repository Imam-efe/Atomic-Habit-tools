/**
 * Rotasi tanam otomatis (#13).
 *
 * Menanam famili yang sama berturut-turut di lokasi yang sama membuat
 * penyakit dan hama spesifik famili itu menumpuk di tanahnya — ini alasan
 * klasik kenapa tomat tahun depan di bedeng yang sama tumbuh lebih buruk
 * padahal dirawat sama persis. Katalog tidak menyimpan famili botani secara
 * eksplisit, jadi peta kecil ini hanya mencakup famili yang benar-benar
 * relevan untuk rotasi — tanaman tahunan/pohon buah sengaja tidak dipetakan
 * karena rotasi tidak berlaku untuknya.
 */

export type PlantFamily =
  | 'Solanaceae'
  | 'Brassicaceae'
  | 'Cucurbitaceae'
  | 'Fabaceae'
  | 'Alliaceae'
  | 'Poaceae'
  | 'Amaranthaceae'
  | 'Apiaceae'
  | 'Convolvulaceae'
  | 'Euphorbiaceae'
  | 'Zingiberaceae';

export const FAMILY_LABEL: Record<PlantFamily, string> = {
  Solanaceae: 'terong-terongan',
  Brassicaceae: 'kubis-kubisan',
  Cucurbitaceae: 'labu-labuan',
  Fabaceae: 'kacang-kacangan',
  Alliaceae: 'bawang-bawangan',
  Poaceae: 'rumput-rumputan',
  Amaranthaceae: 'bayam-bayaman',
  Apiaceae: 'payung-payungan',
  Convolvulaceae: 'kangkung-ubian',
  Euphorbiaceae: 'getah-getahan',
  Zingiberaceae: 'jahe-jahean',
};

const PLANT_FAMILY: Partial<Record<string, PlantFamily>> = {
  'cabai-rawit': 'Solanaceae', 'cabai-merah': 'Solanaceae', tomat: 'Solanaceae',
  terong: 'Solanaceae', kentang: 'Solanaceae',

  'sawi-hijau': 'Brassicaceae', pakcoy: 'Brassicaceae', kubis: 'Brassicaceae',
  kailan: 'Brassicaceae', 'sawi-putih': 'Brassicaceae', lobak: 'Brassicaceae',

  timun: 'Cucurbitaceae', pare: 'Cucurbitaceae', oyong: 'Cucurbitaceae',
  'labu-siam': 'Cucurbitaceae', melon: 'Cucurbitaceae', semangka: 'Cucurbitaceae',

  'kacang-panjang': 'Fabaceae', buncis: 'Fabaceae',

  'bawang-merah': 'Alliaceae', 'bawang-putih': 'Alliaceae', 'daun-bawang': 'Alliaceae',

  'jagung-manis': 'Poaceae',

  bayam: 'Amaranthaceae', 'bayam-merah': 'Amaranthaceae', bit: 'Amaranthaceae',

  wortel: 'Apiaceae', seledri: 'Apiaceae', 'ketumbar-daun': 'Apiaceae',

  kangkung: 'Convolvulaceae', 'ubi-jalar': 'Convolvulaceae',

  singkong: 'Euphorbiaceae',

  jahe: 'Zingiberaceae', kunyit: 'Zingiberaceae', lengkuas: 'Zingiberaceae', kencur: 'Zingiberaceae',
};

export function familyOf(plantId: string): PlantFamily | null {
  return PLANT_FAMILY[plantId] ?? null;
}

export interface LocationPlanting {
  plantingId: string;
  plantId: string;
  label: string;
  location: string;
  /** YYYY-MM-DD */
  plantedDate: string;
}

export interface RotationWarning {
  plantingId: string;
  label: string;
  location: string;
  familyLabel: string;
  previousLabel: string;
  previousPlantedDate: string;
  message: string;
}

/**
 * Bandingkan famili penanaman terbaru dengan yang menempati lokasi yang sama
 * sebelum itu — bukan seluruh riwayat lokasi itu, supaya rotasi yang sudah
 * lama dijalankan dengan benar tidak terus ditandai sebagai masalah.
 */
export function checkRotation(history: LocationPlanting[]): RotationWarning[] {
  const byLocation = new Map<string, LocationPlanting[]>();
  for (const h of history) {
    const list = byLocation.get(h.location) ?? [];
    list.push(h);
    byLocation.set(h.location, list);
  }

  const warnings: RotationWarning[] = [];

  for (const group of byLocation.values()) {
    if (group.length < 2) continue;

    const sorted = [...group].sort((a, b) => a.plantedDate.localeCompare(b.plantedDate));
    const current = sorted[sorted.length - 1];
    const previous = sorted[sorted.length - 2];

    const family = familyOf(current.plantId);
    if (!family || familyOf(previous.plantId) !== family) continue;

    const familyLabel = FAMILY_LABEL[family];
    warnings.push({
      plantingId: current.plantingId,
      label: current.label,
      location: current.location,
      familyLabel,
      previousLabel: previous.label,
      previousPlantedDate: previous.plantedDate,
      message: `${current.label} di lokasi "${current.location}" satu famili (${familyLabel}) dengan ${previous.label} yang ditanam di situ sebelumnya (${previous.plantedDate}) — penyakit tanah bisa menumpuk. Pertimbangkan famili lain dulu di lokasi ini.`,
    });
  }

  return warnings.sort((a, b) => a.location.localeCompare(b.location));
}
