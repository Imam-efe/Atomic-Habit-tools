import { describe, it, expect } from 'vitest';
import { bersihkanMedia, butuhSiram, tugasMedia, HARI_GANTI_LARUTAN } from './garden_media';
import { PLANTS, CATEGORY_LABELS, CATEGORY_PANEN, dipanen } from '../data/plants';

describe('bersihkanMedia', () => {
  it('menerima media yang dikenal', () => {
    expect(bersihkanMedia('hidroponik')).toBe('hidroponik');
    expect(bersihkanMedia('vertikultur')).toBe('vertikultur');
  });

  it('nilai tak dikenal jatuh ke tanah, bukan melempar galat', () => {
    expect(bersihkanMedia('akuaponik')).toBe('tanah');
    expect(bersihkanMedia(null)).toBe('tanah');
    expect(bersihkanMedia(42)).toBe('tanah');
  });
});

describe('butuhSiram', () => {
  it('media tanah butuh siram', () => {
    expect(butuhSiram('tanah')).toBe(true);
    expect(butuhSiram('polybag')).toBe(true);
    expect(butuhSiram('tabulampot')).toBe(true);
    expect(butuhSiram('vertikultur')).toBe(true);
  });

  it('hidroponik tidak disiram', () => {
    // "Siram tiap 2 hari" adalah nasihat yang salah untuk akar yang memang
    // selalu di dalam air. Yang benar mengganti larutannya.
    expect(butuhSiram('hidroponik')).toBe(false);
  });
});

describe('tugasMedia', () => {
  it('hidroponik yang larutannya belum pernah diganti diminta mengganti', () => {
    const t = tugasMedia('hidroponik', null, '2026-08-31');
    expect(t.join(' ')).toMatch(/larutan/i);
  });

  it('hidroponik yang baru diganti tidak diminta mengganti lagi', () => {
    const t = tugasMedia('hidroponik', '2026-08-29', '2026-08-31');
    expect(t.join(' ')).not.toMatch(/ganti larutan/i);
  });

  it('hidroponik yang lewat tenggat diminta mengganti', () => {
    const t = tugasMedia('hidroponik', '2026-08-01', '2026-08-31');
    expect(t.join(' ')).toMatch(/ganti larutan/i);
  });

  it('tenggatnya sesuai HARI_GANTI_LARUTAN', () => {
    const tepat = tugasMedia('hidroponik', '2026-08-21', '2026-08-31'); // 10 hari
    expect(tepat.join(' ')).toMatch(/ganti larutan/i);
    const belum = tugasMedia('hidroponik', '2026-08-22', '2026-08-31'); // 9 hari
    expect(belum.join(' ')).not.toMatch(/ganti larutan/i);
    expect(HARI_GANTI_LARUTAN).toBe(10);
  });

  it('vertikultur diingatkan soal baris bawah yang kurang cahaya', () => {
    expect(tugasMedia('vertikultur', null, '2026-08-31').join(' ')).toMatch(/bawah/i);
  });

  it('tanah biasa tidak menambah tugas apa pun', () => {
    expect(tugasMedia('tanah', null, '2026-08-31')).toEqual([]);
  });
});

describe('katalog mikrogreen', () => {
  const mikro = PLANTS.filter((p) => p.category === 'mikrogreen');

  it('ada isinya', () => {
    expect(mikro.length).toBeGreaterThanOrEqual(6);
  });

  it('punya label kategori', () => {
    expect(CATEGORY_LABELS.mikrogreen).toBeTruthy();
  });

  it('dihitung sebagai tanaman panen', () => {
    expect(CATEGORY_PANEN).toContain('mikrogreen');
    for (const p of mikro) expect(dipanen(p), p.id).toBe(true);
  });

  it('umur panennya sangat pendek — itu seluruh alasan keberadaannya', () => {
    for (const p of mikro) {
      expect(p.daysToHarvest![1], p.id).toBeLessThanOrEqual(21);
    }
  });

  it('tidak panen berulang — sekali potong lalu semai ulang', () => {
    for (const p of mikro) {
      expect(p.repeatHarvest, p.id).toBe(false);
      expect(p.harvestEveryDays, p.id).toBeNull();
    }
  });
});
