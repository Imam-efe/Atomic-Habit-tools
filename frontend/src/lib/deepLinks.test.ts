import { describe, it, expect } from 'vitest';
import { DEEP_LINKS, resolveDeepLink } from './deepLinks';

/**
 * Daftar tab yang benar-benar ada, disalin dari TabName. Disalin dengan sengaja:
 * kalau tab dihapus atau diganti nama, tes ini yang harus berteriak, bukan diam
 * karena ikut berubah otomatis.
 */
const TAB_ADA = new Set(['beranda', 'kebiasaan', 'kalender', 'kebun', 'ternak', 'uang', 'lainnya']);

describe('deep link notifikasi', () => {
  it('tiap tujuan menunjuk tab yang benar-benar ada', () => {
    for (const [path, tujuan] of Object.entries(DEEP_LINKS)) {
      expect(TAB_ADA.has(tujuan.tab), `"${path}" menunjuk tab "${tujuan.tab}" yang tidak ada`).toBe(true);
    }
  });

  it('/ternak mendarat di tab Ternak, bukan sub-layar', () => {
    expect(resolveDeepLink('/ternak')).toEqual({ tab: 'ternak' });
  });

  it('/goals tetap mendarat benar meski Goals bukan tab lagi', () => {
    // Pengingat custom yang tersimpan sebelum pertukaran masih menunjuk ke sini.
    expect(resolveDeepLink('/goals')).toEqual({ tab: 'lainnya', sub: 'goals' });
  });

  it('path tidak dikenal mengembalikan null, bukan tujuan asal', () => {
    expect(resolveDeepLink('/tidak-ada')).toBeNull();
    expect(resolveDeepLink('/ternak/123')).toBeNull();
  });

  it('tidak ada tujuan yang membuka sub-layar bernama sama dengan tab', () => {
    // Sub-layar dibuka SESUDAH setTab, dan setTab mengosongkan subScreen.
    // Kalau `sub` kebetulan sama dengan nama tab, dua mekanisme berebut layar.
    for (const [path, tujuan] of Object.entries(DEEP_LINKS)) {
      if (tujuan.sub) {
        expect(TAB_ADA.has(tujuan.sub), `"${path}" memakai sub "${tujuan.sub}" yang juga nama tab`).toBe(false);
      }
    }
  });
});
