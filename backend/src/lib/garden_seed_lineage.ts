/**
 * Benih simpanan sendiri dan silsilahnya.
 *
 * Sampai sekarang lingkaran kebun ini terbuka di satu ujung: beli benih,
 * tanam, panen — lalu berhenti. Benih yang ada di aplikasi selalu benih BELI
 * (`garden_seeds`), jadi kebun ini tidak pernah bisa menjawab pertanyaan yang
 * membedakan berkebun dari berbelanja: galur mana, dari tanamanku sendiri,
 * yang paling kuat di tanah ini.
 *
 * Generasi disimpan tegas di basis data, bukan ditelusuri ulang tiap dibaca.
 * Rantainya bisa panjang, dan induknya boleh dihapus — silsilah yang harus
 * ditelusuri ulang akan patah diam-diam begitu satu catatan penanaman lama
 * dibersihkan.
 */

/** Generasi pertama: dipanen dari tanaman yang tumbuh dari benih beli. */
export const GENERASI_AWAL = 1;

/**
 * Generasi untuk benih yang baru disimpan dari satu tanaman.
 *
 * `generasiInduk` adalah generasi benih yang MENUMBUHKAN tanaman itu; null
 * berarti tanamannya berasal dari benih beli atau tidak diketahui asalnya,
 * dan benih hasilnya jadi generasi pertama.
 */
export function generasiBerikutnya(generasiInduk: number | null): number {
  if (generasiInduk === null || !Number.isFinite(generasiInduk)) return GENERASI_AWAL;
  return Math.max(GENERASI_AWAL, Math.floor(generasiInduk) + 1);
}

/** Label pendek untuk ditampilkan: F1, F2, … */
export function labelGenerasi(generasi: number): string {
  return `F${Math.max(GENERASI_AWAL, Math.floor(generasi))}`;
}

export interface BenihSimpanan {
  id: string;
  plantKey: string;
  /** Nama tampil tanaman asalnya. */
  label: string;
  generation: number;
  harvestedDate: string;
}

/**
 * Satu penanaman yang berasal dari benih simpanan, beserta hasilnya.
 *
 * `totalPanen` null berarti tanaman itu belum pernah dipanen — beda dari 0
 * yang berarti gagal total. Membedakan keduanya penting: rata-rata yang
 * memasukkan tanaman yang masih tumbuh sebagai "nol" akan menghukum galur
 * yang sebenarnya baru mulai.
 */
export interface HasilGalur {
  savedSeedId: string;
  plantKey: string;
  generation: number;
  totalPanen: number | null;
  unit: string;
}

export interface RingkasanGenerasi {
  generation: number;
  /** Berapa penanaman dari generasi ini yang SUDAH dipanen. */
  jumlahDinilai: number;
  rataPanen: number;
  unit: string;
}

export interface RingkasanGalur {
  plantKey: string;
  label: string;
  /** Generasi tertinggi yang pernah disimpan — seberapa jauh galur ini berjalan. */
  generasiTertinggi: number;
  /** Berapa batch benih yang tersimpan untuk tanaman ini. */
  jumlahBatch: number;
  perGenerasi: RingkasanGenerasi[];
  /**
   * Generasi dengan rata-rata panen tertinggi, hanya kalau ada minimal dua
   * generasi yang sudah bisa dinilai. Satu generasi tidak bisa dibandingkan
   * dengan apa pun, dan menyebutnya "terbaik" akan menyesatkan.
   */
  generasiTerbaik: number | null;
}

/** Kelompokkan benih simpanan dan hasil panennya jadi ringkasan per tanaman. */
export function ringkasGalur(
  benih: ReadonlyArray<BenihSimpanan>,
  hasil: ReadonlyArray<HasilGalur>
): RingkasanGalur[] {
  const perTanaman = new Map<string, { label: string; benih: BenihSimpanan[] }>();
  for (const b of benih) {
    const entry = perTanaman.get(b.plantKey) ?? { label: b.label, benih: [] };
    entry.benih.push(b);
    perTanaman.set(b.plantKey, entry);
  }

  return [...perTanaman.entries()].map(([plantKey, { label, benih: batch }]) => {
    const hasilTanaman = hasil.filter((h) => h.plantKey === plantKey && h.totalPanen !== null);

    const perGen = new Map<number, { total: number; n: number; unit: string }>();
    for (const h of hasilTanaman) {
      const e = perGen.get(h.generation) ?? { total: 0, n: 0, unit: h.unit };
      e.total += h.totalPanen!;
      e.n += 1;
      perGen.set(h.generation, e);
    }

    const perGenerasi: RingkasanGenerasi[] = [...perGen.entries()]
      .map(([generation, e]) => ({
        generation,
        jumlahDinilai: e.n,
        rataPanen: Math.round((e.total / e.n) * 100) / 100,
        unit: e.unit,
      }))
      .sort((a, b) => a.generation - b.generation);

    const generasiTerbaik =
      perGenerasi.length >= 2
        ? perGenerasi.reduce((a, b) => (b.rataPanen > a.rataPanen ? b : a)).generation
        : null;

    return {
      plantKey,
      label,
      generasiTertinggi: Math.max(...batch.map((b) => b.generation)),
      jumlahBatch: batch.length,
      perGenerasi,
      generasiTerbaik,
    };
  });
}
