/**
 * Uji pembangun PDF lembar kerja.
 *
 * Sebelum ini fungsinya tidak punya tes sama sekali, dan pemanggilnya
 * menelan setiap galat tanpa suara — gabungan yang membuat kegagalan apa pun
 * di sini tampak sebagai "tombolnya tidak merespons".
 */
import { describe, it, expect } from 'vitest';
import { buildWorksheetPdf } from '../Garden';
import { susunLembarKerja, type TugasKebun } from '@/lib/gardenWorksheet';

const tugas = (over: Partial<TugasKebun> = {}): TugasKebun => ({
  plantingId: 'p1', label: 'Cabai', location: 'Teras',
  action: 'siram', dueDate: '2026-08-31', overdueDays: 0, ...over,
});

describe('buildWorksheetPdf', () => {
  it('membangun PDF dari jadwal kosong tanpa melempar', async () => {
    const lembar = susunLembarKerja([], '2026-08-31');
    const doc = await buildWorksheetPdf(lembar);
    expect(doc.output('arraybuffer').byteLength).toBeGreaterThan(0);
  });

  it('membangun PDF dari jadwal berisi', async () => {
    const lembar = susunLembarKerja(
      [tugas(), tugas({ action: 'pupuk', dueDate: '2026-09-02' })],
      '2026-08-31'
    );
    const doc = await buildWorksheetPdf(lembar);
    expect(doc.output('arraybuffer').byteLength).toBeGreaterThan(0);
  });

  it('aksi di luar daftar cetak tidak melempar, hanya dipakai apa adanya', async () => {
    const lembar = susunLembarKerja([tugas({ action: 'pangkas' })], '2026-08-31');
    const doc = await buildWorksheetPdf(lembar);
    expect(doc.output('arraybuffer').byteLength).toBeGreaterThan(0);
  });

  it('lokasi null tidak melempar', async () => {
    const lembar = susunLembarKerja([tugas({ location: null })], '2026-08-31');
    const doc = await buildWorksheetPdf(lembar);
    expect(doc.output('arraybuffer').byteLength).toBeGreaterThan(0);
  });

  it('tugas terlewat ikut masuk PDF', async () => {
    const lembar = susunLembarKerja(
      [tugas({ dueDate: '2026-08-01', overdueDays: 30 })],
      '2026-08-31'
    );
    expect(lembar.terlewat.length).toBeGreaterThan(0);
    const doc = await buildWorksheetPdf(lembar);
    expect(doc.output('arraybuffer').byteLength).toBeGreaterThan(0);
  });

  it('banyak tugas memicu halaman kedua tanpa melempar', async () => {
    const banyak = Array.from({ length: 80 }, (_, i) =>
      tugas({ plantingId: `p${i}`, label: `Tanaman ${i}`, dueDate: '2026-09-01' })
    );
    const doc = await buildWorksheetPdf(susunLembarKerja(banyak, '2026-08-31'));
    expect(doc.getNumberOfPages()).toBeGreaterThan(1);
  });
});
