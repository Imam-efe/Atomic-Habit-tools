/**
 * Uji pembangun PDF label, terutama QR yang baru ditempel di tiap label.
 *
 * PDF tidak bisa dilihat dari dalam test, jadi yang diperiksa adalah hal yang
 * bisa dihitung: berapa gambar yang benar-benar tertanam, dan apakah
 * jumlahnya sama dengan jumlah muatan QR yang berbeda. Keterbacaan QR-nya
 * sendiri sudah dibuktikan terpisah di lib/gardenQr.test.ts lewat pembaca QR
 * pihak ketiga.
 */
import { describe, it, expect } from 'vitest';
import { buildLabelsPdf, type LabelUnit, type Planting } from '../Garden';

const tanaman = (over: Partial<Planting> = {}): Planting => ({
  id: 'p1', plantId: 'cabai-rawit', name: 'Cabai Rawit', emoji: '🌶️',
  category: 'sayur', latinName: null, nickname: null, location: 'Teras',
  quantity: 1, plantingMethod: 'benih', plantedDate: '2026-01-01',
  expectedHarvestDate: null, status: 'tumbuh', note: null,
  care: {} as Planting['care'],
  units: [], kodeRingkas: '',
  ...over,
});

const kategoriLabel = (id: string) => id;

/** Berapa objek gambar yang tertanam di PDF. */
function jumlahGambar(doc: import('jspdf').jsPDF): number {
  const isi = doc.output('datauristring');
  const mentah = atob(isi.slice(isi.indexOf(',') + 1));
  return mentah.split('/Subtype /Image').length - 1;
}

describe('buildLabelsPdf', () => {
  it('daftar kosong tidak melempar', async () => {
    const doc = await buildLabelsPdf([], 'sedang', 'mono', kategoriLabel);
    expect(doc.output('arraybuffer').byteLength).toBeGreaterThan(0);
  });

  it('tiap pot berbeda mendapat QR sendiri', async () => {
    const p = tanaman({
      units: [
        { unitNo: 1, code: 'Cabai #1', retired: false },
        { unitNo: 2, code: 'Cabai #2', retired: false },
      ],
    });
    const labels: LabelUnit[] = [
      { planting: p, code: 'Cabai #1', unitNo: 1 },
      { planting: p, code: 'Cabai #2', unitNo: 2 },
    ];

    const doc = await buildLabelsPdf(labels, 'sedang', 'warna', kategoriLabel);
    expect(jumlahGambar(doc)).toBe(2);
  });

  it('salinan label yang sama memakai ulang satu gambar QR', async () => {
    // Kalau tidak, mencetak sepuluh salinan berarti sepuluh gambar identik
    // dan berkas PDF yang membengkak tanpa alasan.
    const p = tanaman({ units: [{ unitNo: 1, code: 'Cabai #1', retired: false }] });
    const labels: LabelUnit[] = Array.from({ length: 10 }, () => ({
      planting: p, code: 'Cabai #1', unitNo: 1,
    }));

    const doc = await buildLabelsPdf(labels, 'kecil', 'mono', kategoriLabel);
    expect(jumlahGambar(doc)).toBe(1);
  });

  it('tanaman tanpa pot tetap dapat label dan QR tingkat tanaman', async () => {
    const doc = await buildLabelsPdf(
      [{ planting: tanaman(), code: null, unitNo: null }],
      'besar', 'mono', kategoriLabel
    );
    expect(jumlahGambar(doc)).toBe(1);
  });

  it('label melampaui satu halaman memicu halaman kedua', async () => {
    const labels: LabelUnit[] = Array.from({ length: 40 }, (_, i) => ({
      planting: tanaman({ id: `p${i}` }), code: `#${i}`, unitNo: i + 1,
    }));
    const doc = await buildLabelsPdf(labels, 'besar', 'warna', kategoriLabel);
    expect(doc.getNumberOfPages()).toBeGreaterThan(1);
  });

  it('nama sangat panjang dan lokasi kosong tidak melempar', async () => {
    const doc = await buildLabelsPdf(
      [{
        planting: tanaman({ nickname: 'Cabai Rawit Merah Warisan Nenek dari Kebun Belakang', location: null }),
        code: 'Cabai #12',
        unitNo: 12,
      }],
      'kecil', 'warna', kategoriLabel
    );
    expect(doc.output('arraybuffer').byteLength).toBeGreaterThan(0);
  });
});
