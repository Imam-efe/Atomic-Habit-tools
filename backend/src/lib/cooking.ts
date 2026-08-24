/**
 * Logika modul Masakan, dipisah dari rute dan dari AI.
 *
 * Bedanya dengan "Selamatkan Bahan" yang sudah ada: di sana model tidak boleh
 * menyebut bahan yang tidak dimiliki sama sekali, karena gunanya menghabiskan
 * stok yang mau kedaluwarsa. Di sini justru sebaliknya — pengguna ingin tahu
 * masakan apa yang bisa dibuat DAN apa yang kurang, supaya bisa memutuskan
 * mau masak sekarang atau belanja dulu. Jadi bahan kurang bukan cacat
 * jawaban; ia salah satu keluarannya.
 *
 * Yang tetap tidak boleh: mengaku punya bahan yang tidak ada. Model bebas
 * mengarang resep, tapi pemilahan "ada" dan "kurang" ditentukan kode dengan
 * membandingkan ke inventaris, bukan oleh klaim model.
 */

export interface StockItem {
  name: string;
  quantity: number;
  unit: string | null;
  /** Sisa hari sampai kedaluwarsa; null kalau tidak dicatat. */
  daysLeft: number | null;
}

export interface RecipeSuggestion {
  name: string;
  /** Bahan yang benar-benar ada, ditulis seperti di inventaris. */
  have: string[];
  /** Bahan yang harus dibeli. */
  missing: string[];
  steps: string[];
  minutes: number | null;
  servings: number | null;
  /** Berapa persen bahannya sudah dimiliki. */
  readiness: number;
}

/**
 * Samakan penulisan bahan sebelum dibandingkan.
 *
 * Inventaris ditulis manusia ("Bawang Merah", "bawang  merah"), model menulis
 * versi lain lagi. Tanpa normalisasi, bahan yang jelas-jelas ada akan masuk
 * daftar belanja — dan pengguna kehilangan kepercayaan pada fitur ini setelah
 * satu kali disuruh membeli telur yang ada di kulkasnya.
 */
export function normalkan(nama: string): string {
  return nama
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Apakah bahan yang diminta tercakup oleh sebuah baris stok.
 *
 * Pencocokan sengaja longgar dua arah: stok "Telur ayam" memenuhi permintaan
 * "telur", dan stok "Telur" memenuhi "telur ayam". Yang tidak dilakukan
 * adalah mencocokkan per kata — "daun bawang" tidak boleh dianggap terpenuhi
 * oleh stok "bawang merah", dan itu justru kesalahan yang paling mengganggu.
 */
export function cocok(diminta: string, stok: string): boolean {
  const a = normalkan(diminta);
  const b = normalkan(stok);
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

/**
 * Pilah bahan sebuah resep menjadi yang ada dan yang kurang.
 *
 * Nama yang cocok dikembalikan apa adanya seperti tertulis di inventaris,
 * bukan seperti ditulis model, supaya daftarnya bisa dicocokkan kembali ke
 * baris stok saat resep ditandai sudah dimasak.
 */
export function pilahBahan(
  bahan: readonly string[],
  stok: readonly StockItem[]
): { have: string[]; missing: string[] } {
  const have: string[] = [];
  const missing: string[] = [];

  for (const b of bahan) {
    const bersih = b.trim();
    if (!bersih) continue;

    const found = stok.find((s) => cocok(bersih, s.name));
    if (found) {
      if (!have.includes(found.name)) have.push(found.name);
    } else if (!missing.some((m) => normalkan(m) === normalkan(bersih))) {
      missing.push(bersih);
    }
  }

  return { have, missing };
}

/** Berapa persen bahan resep sudah dimiliki. Resep tanpa bahan dianggap nol. */
export function hitungKesiapan(have: number, missing: number): number {
  const total = have + missing;
  return total === 0 ? 0 : Math.round((have / total) * 100);
}

interface RawRecipe {
  nama?: unknown;
  bahan?: unknown;
  langkah?: unknown;
  menit?: unknown;
  porsi?: unknown;
}

function daftarBersih(value: unknown, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    .map((x) => x.trim().slice(0, maxLen))
    .slice(0, maxItems);
}

/**
 * Baca jawaban model menjadi daftar resep yang sudah dipilah terhadap stok.
 *
 * Resep tanpa nama atau tanpa bahan dibuang, bukan diperbaiki: menampilkan
 * kartu resep kosong lebih membingungkan daripada menampilkan dua resep
 * ketika model menjanjikan tiga.
 */
export function bacaResep(payload: unknown, stok: readonly StockItem[]): RecipeSuggestion[] {
  const raw = (payload as { resep?: unknown })?.resep;
  if (!Array.isArray(raw)) return [];

  const out: RecipeSuggestion[] = [];

  for (const item of raw.slice(0, 6)) {
    if (typeof item !== 'object' || item === null) continue;
    const r = item as RawRecipe;

    const nama = typeof r.nama === 'string' ? r.nama.trim().slice(0, 120) : '';
    if (!nama) continue;

    const bahan = daftarBersih(r.bahan, 20, 80);
    if (bahan.length === 0) continue;

    const { have, missing } = pilahBahan(bahan, stok);
    const menit = typeof r.menit === 'number' && r.menit > 0 ? Math.round(r.menit) : null;
    const porsi = typeof r.porsi === 'number' && r.porsi > 0 ? Math.round(r.porsi) : null;

    out.push({
      name: nama,
      have,
      missing,
      steps: daftarBersih(r.langkah, 12, 300),
      minutes: menit,
      servings: porsi,
      readiness: hitungKesiapan(have.length, missing.length),
    });
  }

  // Yang paling siap dimasak lebih dulu: itu keputusan yang sedang diambil
  // pengguna saat membuka layar ini.
  return out.sort((a, b) => b.readiness - a.readiness);
}

/**
 * Urutkan stok untuk dimasukkan ke prompt.
 *
 * Yang mau kedaluwarsa didahulukan supaya model condong memakainya, tanpa
 * memaksa seperti "Selamatkan Bahan" — pengguna tetap boleh memasak apa pun.
 */
export function urutkanStok(stok: readonly StockItem[]): StockItem[] {
  return [...stok].sort((a, b) => {
    const da = a.daysLeft ?? 9999;
    const dbb = b.daysLeft ?? 9999;
    return da - dbb;
  });
}

/** Baris bahan untuk prompt, ringkas dan menandai yang mendesak. */
export function ringkasStok(stok: readonly StockItem[], max = 40): string {
  return urutkanStok(stok)
    .slice(0, max)
    .map((s) => {
      const jumlah = `${s.quantity}${s.unit ? ` ${s.unit}` : ''}`;
      if (s.daysLeft === null) return `- ${s.name} (${jumlah})`;
      if (s.daysLeft < 0) return `- ${s.name} (${jumlah}, sudah kedaluwarsa)`;
      if (s.daysLeft <= 3) return `- ${s.name} (${jumlah}, sisa ${s.daysLeft} hari)`;
      return `- ${s.name} (${jumlah})`;
    })
    .join('\n');
}
