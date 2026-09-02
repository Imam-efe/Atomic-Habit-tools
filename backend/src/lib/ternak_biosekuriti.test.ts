/**
 * Uji karantina hewan baru.
 *
 * Penyakit masuk bersama hewan baru, bukan muncul sendiri. Dua pekan adalah
 * jeda terpendek yang masih menangkap sebagian besar penyakit menular sebelum
 * ia menyebar ke seluruh isi kandang.
 */
import { describe, it, expect } from 'vitest';
import { statusKarantina, HARI_KARANTINA } from './ternak_biosekuriti';

describe('statusKarantina', () => {
  it('ambangnya dua pekan', () => {
    expect(HARI_KARANTINA).toBe(14);
  });

  it('hewan baru bersama penghuni lain masih dalam karantina', () => {
    const k = statusKarantina('2026-06-01', '2026-06-05', true)!;
    expect(k.selesai).toBe('2026-06-15');
    expect(k.sisaHari).toBe(10);
    expect(k.aman).toBe(false);
  });

  it('lewat ambang berarti aman', () => {
    const k = statusKarantina('2026-06-01', '2026-06-16', true)!;
    expect(k.sisaHari).toBe(0);
    expect(k.aman).toBe(true);
  });

  it('tepat di hari selesai sudah aman', () => {
    expect(statusKarantina('2026-06-01', '2026-06-15', true)!.aman).toBe(true);
  });

  it('hewan sendirian di kandang tidak perlu dikarantina', () => {
    // Tidak ada yang bisa ditulari, jadi peringatannya cuma jadi bising.
    expect(statusKarantina('2026-06-01', '2026-06-05', false)).toBeNull();
  });
});
