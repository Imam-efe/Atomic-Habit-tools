import { describe, it, expect } from 'vitest';
import {
  cocokMatahari, cariSalahTempat, lokasiCocokUntuk, bersihkanJam,
  KEBUTUHAN_JAM, MAX_JAM_MATAHARI, LABEL_SUNLIGHT, type Sunlight,
} from './garden_sun';

const SEMUA: Sunlight[] = ['penuh', 'sebagian', 'teduh'];

describe('bersihkanJam', () => {
  it('menjepit ke rentang yang masuk akal', () => {
    expect(bersihkanJam(-3)).toBe(0);
    expect(bersihkanJam(99)).toBe(MAX_JAM_MATAHARI);
  });

  it('membulatkan ke setengah jam', () => {
    expect(bersihkanJam(5.2)).toBe(5);
    expect(bersihkanJam(5.3)).toBe(5.5);
  });

  it('nilai rusak jadi nol, bukan NaN yang menular atau matahari maksimum', () => {
    // Nol berarti "belum terukur" dan tidak memicu peringatan apa pun.
    // Menjepit Infinity ke 14 justru akan mengklaim matahari penuh di tempat
    // yang tidak pernah diamati — kesalahan yang lebih berbahaya daripada
    // kehilangan satu angka.
    expect(bersihkanJam(NaN)).toBe(0);
    expect(bersihkanJam(Infinity)).toBe(0);
    expect(bersihkanJam(-Infinity)).toBe(0);
  });
});

describe('cocokMatahari', () => {
  it('tanaman matahari penuh kurang cahaya di tempat teduh', () => {
    expect(cocokMatahari(2, 'penuh')).toBe('kurang');
    expect(cocokMatahari(6, 'penuh')).toBe('cocok');
  });

  it('tanaman matahari penuh tidak pernah terlalu terik', () => {
    // Tidak ada batas atas: di Indonesia tidak ada tempat yang terlalu terang
    // untuk cabai atau tomat.
    expect(cocokMatahari(MAX_JAM_MATAHARI, 'penuh')).toBe('cocok');
  });

  it('tanaman teduh gosong kalau kena matahari seharian', () => {
    // Inti dari batas ATAS: kelebihan matahari adalah kegagalan yang nyata,
    // bukan cuma kekurangan yang perlu diperingatkan.
    expect(cocokMatahari(8, 'teduh')).toBe('terlalu-terik');
    expect(cocokMatahari(3, 'teduh')).toBe('cocok');
  });

  it('setengah teduh punya dua sisi batas', () => {
    expect(cocokMatahari(2, 'sebagian')).toBe('kurang');
    expect(cocokMatahari(5, 'sebagian')).toBe('cocok');
    expect(cocokMatahari(9, 'sebagian')).toBe('terlalu-terik');
  });

  it('tepat di batas dianggap cocok', () => {
    for (const s of SEMUA) {
      const r = KEBUTUHAN_JAM[s];
      expect(cocokMatahari(r.min, s), `${s} min`).toBe('cocok');
      if (r.max !== null) expect(cocokMatahari(r.max, s), `${s} max`).toBe('cocok');
    }
  });

  it('tiap golongan punya label dan rentang yang sah', () => {
    for (const s of SEMUA) {
      expect(LABEL_SUNLIGHT[s], s).toBeTruthy();
      const r = KEBUTUHAN_JAM[s];
      expect(r.min, s).toBeGreaterThanOrEqual(0);
      if (r.max !== null) expect(r.max, s).toBeGreaterThan(r.min);
    }
  });
});

describe('cariSalahTempat', () => {
  const profil = [
    { lokasiId: 'bed-1', lokasiLabel: 'Bedengan A', jamLangsung: 8 },
    { lokasiId: 'loc:Teras', lokasiLabel: 'Teras', jamLangsung: 2 },
  ];

  it('menandai tanaman matahari penuh yang ditaruh di teras teduh', () => {
    const hasil = cariSalahTempat(
      [{ plantingId: 'p1', label: 'Tomat', lokasiId: 'loc:Teras', butuh: 'penuh' }],
      profil
    );
    expect(hasil).toHaveLength(1);
    expect(hasil[0].kecocokan).toBe('kurang');
    expect(hasil[0].message).toContain('Teras');
    expect(hasil[0].message).toContain('2 jam');
  });

  it('menandai tanaman teduh yang ditaruh di bedengan terbuka', () => {
    const hasil = cariSalahTempat(
      [{ plantingId: 'p2', label: 'Selada', lokasiId: 'bed-1', butuh: 'teduh' }],
      profil
    );
    expect(hasil).toHaveLength(1);
    expect(hasil[0].kecocokan).toBe('terlalu-terik');
    expect(hasil[0].message).toContain('gosong');
  });

  it('tidak menandai penempatan yang sudah cocok', () => {
    expect(
      cariSalahTempat([{ plantingId: 'p3', label: 'Cabai', lokasiId: 'bed-1', butuh: 'penuh' }], profil)
    ).toHaveLength(0);
  });

  it('lokasi yang belum diukur dilewati, bukan dituduh salah', () => {
    // Belum sempat diamati bukan berarti salah tempat. Menuduhnya membuat
    // daftar ini berisik sejak hari pertama, sebelum satu pun jam dicatat.
    const hasil = cariSalahTempat(
      [{ plantingId: 'p4', label: 'Tomat', lokasiId: 'loc:Belum diukur', butuh: 'penuh' }],
      profil
    );
    expect(hasil).toHaveLength(0);
  });

  it('tanaman di luar katalog dilewati karena kebutuhannya tidak diketahui', () => {
    const hasil = cariSalahTempat(
      [{ plantingId: 'p5', label: 'Tanaman kustom', lokasiId: 'loc:Teras', butuh: null }],
      profil
    );
    expect(hasil).toHaveLength(0);
  });

  it('tanaman tanpa lokasi dilewati', () => {
    expect(
      cariSalahTempat([{ plantingId: 'p6', label: 'Tomat', lokasiId: null, butuh: 'penuh' }], profil)
    ).toHaveLength(0);
  });
});

describe('lokasiCocokUntuk', () => {
  const profil = [
    { lokasiId: 'bed-1', lokasiLabel: 'Bedengan A', jamLangsung: 8 },
    { lokasiId: 'bed-2', lokasiLabel: 'Bedengan B', jamLangsung: 4 },
    { lokasiId: 'loc:Teras', lokasiLabel: 'Teras', jamLangsung: 2 },
  ];

  it('hanya mengembalikan lokasi yang benar-benar memenuhi', () => {
    expect(lokasiCocokUntuk('penuh', profil).map((p) => p.lokasiId)).toEqual(['bed-1']);
    expect(lokasiCocokUntuk('sebagian', profil).map((p) => p.lokasiId)).toEqual(['bed-2']);
  });

  it('kosong kalau tidak ada satu pun tempat yang memenuhi', () => {
    // Justru jawaban yang paling berguna: lebih baik tahu sebelum beli benih.
    expect(lokasiCocokUntuk('penuh', [{ lokasiId: 'x', lokasiLabel: 'X', jamLangsung: 1 }])).toEqual([]);
  });
});
