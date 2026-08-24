/**
 * Streak merawat kebun (#4 rilis ini).
 *
 * Seluruh aplikasi ini berdiri di atas gagasan Atomic Habits, tapi kebun —
 * satu-satunya modul yang benar-benar menuntut kehadiran tiap hari — tidak
 * pernah diperlakukan sebagai kebiasaan. Log perawatan sudah ada sejak awal;
 * yang belum ada hanya cara membacanya sebagai rentetan.
 *
 * Aturannya sengaja lebih longgar dari streak kebiasaan: kebun tidak menuntut
 * perawatan tiap hari (tanaman yang disiram tiap tiga hari memang begitu
 * anjurannya), jadi jeda satu hari tidak memutus rentetan. Yang dihitung
 * adalah kehadiran yang teratur, bukan kesempurnaan harian.
 */

export interface CareDay {
  /** YYYY-MM-DD, satu baris per hari yang ada perawatannya. */
  date: string;
}

export interface GardenStreak {
  /** Hari beruntun sampai hari ini (atau kemarin, kalau hari ini belum). */
  current: number;
  /** Rentetan terpanjang yang pernah dicapai. */
  longest: number;
  /** Sudah merawat hari ini? */
  activeToday: boolean;
  /** Total hari yang pernah ada perawatannya. */
  totalDays: number;
}

/**
 * Jeda maksimum yang masih dianggap menyambung.
 *
 * 1 berarti "boleh bolong sehari". Dua hari tanpa menyentuh kebun sama sekali
 * memang layak disebut putus.
 */
const MAX_GAP_DAYS = 1;

function daysBetween(from: string, to: string): number {
  return Math.round(
    (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86400000
  );
}

export function computeGardenStreak(days: CareDay[], today: string): GardenStreak {
  // Duplikat tanggal dibuang: beberapa perawatan di hari yang sama tetap satu
  // hari kehadiran, bukan tiga.
  const unique = [...new Set(days.map((d) => d.date))].sort();

  if (unique.length === 0) {
    return { current: 0, longest: 0, activeToday: false, totalDays: 0 };
  }

  let longest = 1;
  let run = 1;
  for (let i = 1; i < unique.length; i++) {
    const gap = daysBetween(unique[i - 1], unique[i]);
    if (gap <= MAX_GAP_DAYS + 1) {
      run++;
      longest = Math.max(longest, run);
    } else {
      run = 1;
    }
  }

  // Rentetan berjalan hanya sah kalau ujungnya menyentuh hari ini atau masih
  // dalam toleransi jeda. Kebun yang terakhir disentuh bulan lalu tidak sedang
  // punya rentetan, sepanjang apa pun rekornya dulu.
  const last = unique[unique.length - 1];
  const sinceLast = daysBetween(last, today);

  let current = 0;
  if (sinceLast <= MAX_GAP_DAYS) {
    current = 1;
    for (let i = unique.length - 1; i > 0; i--) {
      const gap = daysBetween(unique[i - 1], unique[i]);
      if (gap <= MAX_GAP_DAYS + 1) current++;
      else break;
    }
  }

  return {
    current,
    longest,
    activeToday: unique.includes(today),
    totalDays: unique.length,
  };
}
