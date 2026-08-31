/**
 * Media tanam selain tanah, dan apa yang berubah karenanya.
 *
 * Seluruh modul kebun sampai sekarang mengandaikan tanah atau polybag:
 * `waterIntervalDays` di katalog berarti "siram tiap N hari". Untuk hidroponik
 * kalimat itu bukan sekadar kurang tepat — ia salah. Akarnya memang selalu di
 * dalam air; yang perlu dikerjakan adalah mengganti larutannya sebelum garamnya
 * menumpuk.
 *
 * Vertikultur dan tabulampot tetap disiram, tapi punya jebakan sendiri yang
 * pantas diingatkan sekali daripada ditemukan sesudah tanamannya kerdil.
 *
 * Bentuk-bentuk ini bukan pilihan sembarang: vertikultur dan hidroponik botol
 * bekas adalah yang dianjurkan program Pekarangan Pangan Lestari untuk
 * pekarangan sempit di perkotaan.
 */

export type Media = 'tanah' | 'polybag' | 'hidroponik' | 'vertikultur' | 'tabulampot';

export const MEDIA_LABEL: Record<Media, string> = {
  tanah: 'Tanah langsung',
  polybag: 'Polybag / pot',
  hidroponik: 'Hidroponik',
  vertikultur: 'Vertikultur',
  tabulampot: 'Tabulampot',
};

const SEMUA = Object.keys(MEDIA_LABEL) as Media[];

/** Setiap tenggang ini larutan hidroponik diganti, hari. */
export const HARI_GANTI_LARUTAN = 10;

/**
 * Nilai tak dikenal jatuh ke 'tanah', bukan melempar galat: media adalah
 * keterangan tambahan, dan penanaman tanpa keterangan yang sah tetap harus bisa
 * dirawat seperti biasa.
 */
export function bersihkanMedia(nilai: unknown): Media {
  return typeof nilai === 'string' && (SEMUA as string[]).includes(nilai)
    ? (nilai as Media)
    : 'tanah';
}

export function butuhSiram(media: Media): boolean {
  return media !== 'hidroponik';
}

function selisihHari(dari: string, ke: string): number {
  const a = Date.parse(`${dari}T00:00:00Z`);
  const b = Date.parse(`${ke}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/** Tugas tambahan yang lahir dari medianya, bukan dari tanamannya. */
export function tugasMedia(
  media: Media,
  lastSolutionChange: string | null,
  hariIni: string
): string[] {
  if (media === 'hidroponik') {
    const tugas = ['Cek EC dan pH larutan.'];
    const umur = lastSolutionChange ? selisihHari(lastSolutionChange, hariIni) : null;
    if (umur === null || umur >= HARI_GANTI_LARUTAN) {
      tugas.push(
        umur === null
          ? 'Ganti larutan nutrisi — belum pernah dicatat.'
          : `Ganti larutan nutrisi — sudah ${umur} hari.`
      );
    }
    return tugas;
  }

  if (media === 'vertikultur') {
    return [
      'Putar posisi rak: baris bawah dapat cahaya paling sedikit dan akan tertinggal kalau dibiarkan di situ terus.',
      'Cek baris paling bawah — air dari atas menumpuk di sana dan bisa membuat akar busuk.',
    ];
  }

  if (media === 'tabulampot') {
    return [
      'Cek akar yang keluar dari lubang bawah pot; kalau sudah melingkar, saatnya ganti media atau pangkas akar.',
    ];
  }

  return [];
}
