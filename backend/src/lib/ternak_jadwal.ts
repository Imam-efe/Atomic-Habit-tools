/**
 * Jadwal perawatan ternak: katalog + penyimpangan + riwayat, jadi satu daftar.
 *
 * Berbeda dari kebun, jenis tugasnya berbeda per spesies dan bukan cuma
 * intervalnya. Karena itu daftar tugas datang dari katalog, dan berkas ini
 * yang menentukan kapan tiap tugas jatuh tempo.
 *
 * Aturan yang paling menentukan ada di penyaringan `sasaran`: tugas ganti air
 * milik akuariumnya, bukan milik tiap ikan di dalamnya. Tanpa itu, satu
 * akuarium berisi delapan guppy akan menagih pekerjaan yang sama delapan kali,
 * dan daftar yang menagih pekerjaan hantu akan berhenti dibaca.
 */

import type { TugasKatalog } from '../data/animals';

export interface Subjek {
  tipe: 'kandang' | 'hewan';
  id: string;
  nama: string;
  /** Slug katalog; null untuk yang di luar katalog. */
  animalId: string | null;
  /** tanggal_masuk untuk hewan, tanggal_mulai untuk kandang. */
  mulai: string;
}

export interface Ubahan {
  kodeTugas: string;
  /** null = ikut interval katalog. */
  tiapHari: number | null;
  nonaktif: boolean;
  namaKustom: string | null;
  caraKustom: string | null;
}

export interface TugasJatuhTempo {
  subjekTipe: 'kandang' | 'hewan';
  subjekId: string;
  nama: string;
  kodeTugas: string;
  labelTugas: string;
  cara: string;
  penting: boolean;
  berikutnya: string;
  /** Hari terlewat dari jatuh tempo; 0 bila belum. */
  telat: number;
  sumberInterval: 'katalog' | 'ubahan';
}

function geser(tanggal: string, hari: number): string {
  const d = new Date(`${tanggal}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + hari);
  return d.toISOString().slice(0, 10);
}

function selisihHari(dari: string, ke: string): number {
  const a = Date.parse(`${dari}T00:00:00Z`);
  const b = Date.parse(`${ke}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/**
 * Daftar tugas jatuh tempo untuk satu kandang atau satu hewan.
 *
 * `terakhir` memetakan kode tugas ke tanggal log terakhirnya. Kode yang tidak
 * ada di peta berarti tugas itu belum pernah dikerjakan sama sekali, dan
 * hitungannya jatuh ke `mulai + mulaiHari` — bukan `mulai + tiapHari`. Anak
 * kucing umur tiga minggu belum boleh divaksin, dan menagihnya di hari ia
 * dicatat adalah saran yang salah secara medis.
 */
export function jadwalSubjek(
  subjek: Subjek,
  tugasKatalog: TugasKatalog[],
  ubahan: Ubahan[],
  terakhir: Map<string, string>,
  hariIni: string
): TugasJatuhTempo[] {
  const ubahanPer = new Map(ubahan.map((u) => [u.kodeTugas, u]));
  const hasil: TugasJatuhTempo[] = [];

  // Hewan di luar katalog tidak punya interval yang bisa dipakai, jadi tidak
  // dijadwalkan — bukan dijadwalkan dengan angka tebakan. Tugas custom-nya
  // tetap berlaku: itu angka yang ditulis penggunanya sendiri.
  const dariKatalog = subjek.animalId
    ? tugasKatalog.filter((t) => t.sasaran === subjek.tipe)
    : [];

  for (const t of dariKatalog) {
    const u = ubahanPer.get(t.kode);
    if (u?.nonaktif) continue;

    const tiapHari = u?.tiapHari ?? t.tiapHari;
    const last = terakhir.get(t.kode) ?? null;
    const berikutnya = last ? geser(last, tiapHari) : geser(subjek.mulai, t.mulaiHari);

    hasil.push({
      subjekTipe: subjek.tipe,
      subjekId: subjek.id,
      nama: subjek.nama,
      kodeTugas: t.kode,
      labelTugas: u?.namaKustom ?? t.nama,
      cara: u?.caraKustom ?? t.cara,
      penting: t.penting,
      berikutnya,
      telat: Math.max(0, selisihHari(berikutnya, hariIni)),
      sumberInterval: u?.tiapHari != null ? 'ubahan' : 'katalog',
    });
  }

  // Tugas yang tidak ada di katalog sama sekali: milik subjek ini sendiri,
  // seperti antibiotik pasca operasi. Tanpa interval ia bukan jadwal, jadi
  // dilewati alih-alih ditagih tiap nol hari.
  const kodeKatalog = new Set(dariKatalog.map((t) => t.kode));
  for (const u of ubahan) {
    if (kodeKatalog.has(u.kodeTugas) || u.nonaktif) continue;
    if (u.tiapHari == null || u.tiapHari <= 0) continue;

    const last = terakhir.get(u.kodeTugas) ?? null;
    const berikutnya = last ? geser(last, u.tiapHari) : geser(subjek.mulai, u.tiapHari);

    hasil.push({
      subjekTipe: subjek.tipe,
      subjekId: subjek.id,
      nama: subjek.nama,
      kodeTugas: u.kodeTugas,
      labelTugas: u.namaKustom ?? u.kodeTugas,
      cara: u.caraKustom ?? '',
      // Tugas buatan pengguna tidak pernah otomatis dianggap kritis; hanya
      // katalog yang boleh menandai sesuatu sebagai penting.
      penting: false,
      berikutnya,
      telat: Math.max(0, selisihHari(berikutnya, hariIni)),
      sumberInterval: 'ubahan',
    });
  }

  return hasil.sort(
    (a, b) => b.telat - a.telat || a.berikutnya.localeCompare(b.berikutnya)
  );
}
