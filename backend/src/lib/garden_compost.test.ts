import { describe, it, expect } from 'vitest';
import { estimasiSiap, ringkasBatch, HARI_KOMPOS } from './garden_compost';

describe('estimasiSiap', () => {
  it('metode cepat lebih pendek dari sedang, sedang lebih pendek dari lambat', () => {
    expect(HARI_KOMPOS.cepat).toBeLessThan(HARI_KOMPOS.sedang);
    expect(HARI_KOMPOS.sedang).toBeLessThan(HARI_KOMPOS.lambat);
  });

  it('menggeser tanggal mulai sesuai jumlah hari metode', () => {
    expect(estimasiSiap('2026-01-01', 'cepat')).toBe('2026-01-22');
  });

  it('jatuh ke sedang untuk metode yang tidak dikenal', () => {
    expect(estimasiSiap('2026-01-01', 'entah' as never)).toBe(estimasiSiap('2026-01-01', 'sedang'));
  });
});

describe('ringkasBatch', () => {
  it('status terpakai menang atas tanggal, walau estimasi baru lewat kemarin', () => {
    const r = ringkasBatch('2026-01-20', '2026-01-21', 'terpakai');
    expect(r.status).toBe('terpakai');
    expect(r.siapDiterapkan).toBe(false);
  });

  it('siap diterapkan begitu hari ini melewati estimasi, selama masih proses', () => {
    const r = ringkasBatch('2026-01-20', '2026-01-21', 'proses');
    expect(r.siapDiterapkan).toBe(true);
    expect(r.hariSejakEstimasi).toBe(1);
  });

  it('belum siap sebelum tanggal estimasi', () => {
    const r = ringkasBatch('2026-01-20', '2026-01-10', 'proses');
    expect(r.siapDiterapkan).toBe(false);
    expect(r.hariSejakEstimasi).toBe(-10);
  });

  it('batch yang sudah ditandai siap tidak lagi "siapDiterapkan" — itu untuk memicu transisi, bukan status akhir', () => {
    const r = ringkasBatch('2026-01-20', '2026-02-01', 'siap');
    expect(r.status).toBe('siap');
    expect(r.siapDiterapkan).toBe(false);
  });
});
