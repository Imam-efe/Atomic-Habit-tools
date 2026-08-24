import { describe, it, expect } from 'vitest';
import { PLANTS } from '../data/plants';
import {
  shouldSkipWatering,
  wateringNote,
  weatherCacheKey,
  parseRain,
  parseEt0,
  computeWaterBalance,
  RAIN_SKIP_MM,
  RAIN_SOAKED_MM,
} from './garden_weather';
import { summarizeEconomics, computeBreakEven } from './garden_economics';
import { findSuccessionDue, sowLeadDays } from './garden_succession';

describe('shouldSkipWatering', () => {
  it('melewati siram saat kemarin hujan deras', () => {
    const verdict = shouldSkipWatering({ yesterday: RAIN_SOAKED_MM, today: 0, tomorrow: 0 });
    expect(verdict.skip).toBe(true);
    expect(verdict.reason).toContain('busuk akar');
  });

  it('melewati siram saat hari ini diperkirakan hujan cukup', () => {
    expect(shouldSkipWatering({ yesterday: 0, today: RAIN_SKIP_MM, tomorrow: 0 }).skip).toBe(true);
  });

  it('tetap menyiram saat hujannya di bawah ambang', () => {
    expect(shouldSkipWatering({ yesterday: 2, today: 1, tomorrow: 0 }).skip).toBe(false);
  });

  it('selalu memberi alasan yang bisa dibaca saat melewati', () => {
    // Pengingat yang diam tanpa penjelasan terasa seperti kerusakan.
    const verdict = shouldSkipWatering({ yesterday: 0, today: 10, tomorrow: 0 });
    expect(verdict.reason.length).toBeGreaterThan(10);
    expect(verdict.reason).toContain('10 mm');
  });

  it('tidak memberi alasan saat tidak melewati', () => {
    expect(shouldSkipWatering({ yesterday: 0, today: 0, tomorrow: 0 }).reason).toBe('');
  });
});

describe('wateringNote', () => {
  it('menyarankan siram secukupnya kalau besok hujan', () => {
    expect(wateringNote({ yesterday: 0, today: 0, tomorrow: 10 })).toContain('secukupnya');
  });

  it('menyarankan siram lebih banyak saat tiga hari kering', () => {
    expect(wateringNote({ yesterday: 0, today: 0, tomorrow: 0 })).toContain('lebih banyak');
  });

  it('diam saat tidak ada yang perlu disebut', () => {
    expect(wateringNote({ yesterday: 2, today: 1, tomorrow: 2 })).toBeNull();
  });
});

describe('weatherCacheKey / parseRain', () => {
  it('membulatkan lokasi supaya pergeseran GPS kecil tetap kena cache', () => {
    expect(weatherCacheKey(-6.2001, 106.8156, '2026-08-24')).toBe(
      weatherCacheKey(-6.2004, 106.8161, '2026-08-24')
    );
  });

  it('membaca tiga hari dari balasan Open-Meteo', () => {
    expect(parseRain({ daily: { precipitation_sum: [12.4, 0, 3.1] } })).toEqual({
      yesterday: 12.4,
      today: 0,
      tomorrow: 3.1,
    });
  });

  it('mengembalikan null untuk balasan yang tidak lengkap', () => {
    expect(parseRain({ daily: { precipitation_sum: [1] } })).toBeNull();
    expect(parseRain({})).toBeNull();
  });

  it('memperlakukan nilai null dari API sebagai nol', () => {
    expect(parseRain({ daily: { precipitation_sum: [null, 5, null] } })).toEqual({
      yesterday: 0,
      today: 5,
      tomorrow: 0,
    });
  });
});

describe('parseEt0', () => {
  it('membaca nilai hari ini dari balasan Open-Meteo', () => {
    expect(parseEt0({ daily: { et0_fao_evapotranspiration: [3.1, 4.2, 3.8] } })).toBe(4.2);
  });

  it('mengembalikan null untuk balasan yang tidak lengkap', () => {
    expect(parseEt0({ daily: { et0_fao_evapotranspiration: [4.2] } })).toBeNull();
    expect(parseEt0({})).toBeNull();
  });

  it('mengembalikan null untuk nilai null dari API, bukan nol', () => {
    // Beda dari curah hujan: et0 null berarti "belum bisa dihitung", bukan 0.
    expect(parseEt0({ daily: { et0_fao_evapotranspiration: [3.1, null, 3.8] } })).toBeNull();
  });
});

describe('computeWaterBalance', () => {
  it('menyarankan siram sebesar selisih evapotranspirasi dan hujan', () => {
    expect(computeWaterBalance(5, 2)).toEqual({ et0Today: 5, rainToday: 2, recommendedMm: 3 });
  });

  it('tidak pernah menyarankan angka negatif saat hujan melebihi evapotranspirasi', () => {
    expect(computeWaterBalance(3, 10).recommendedMm).toBe(0);
  });

  it('membulatkan ke satu desimal', () => {
    expect(computeWaterBalance(5.55, 1.11).recommendedMm).toBe(4.4);
  });
});

describe('summarizeEconomics', () => {
  const labels = new Map([
    ['p1', { label: 'Kangkung bedeng A', plantKey: 'kangkung' }],
    ['p2', { label: 'Cabai pot', plantKey: 'cabai-rawit' }],
  ]);

  it('menghitung untung bersih per penanaman', () => {
    const result = summarizeEconomics(
      labels,
      [{ plantingId: 'p1', kind: 'benih', amount: 15_000 }],
      [{ plantingId: 'p1', plantKey: 'kangkung', amount: 3, unit: 'kg' }],
      [{ plantKey: 'kangkung', price: 12_000, unit: 'kg' }]
    );

    const kangkung = result.perPlanting.find((p) => p.plantingId === 'p1')!;
    expect(kangkung.value).toBe(36_000);
    expect(kangkung.net).toBe(21_000);
  });

  it('tidak pernah menebak harga yang belum diisi', () => {
    const result = summarizeEconomics(
      labels,
      [{ plantingId: 'p2', kind: 'benih', amount: 20_000 }],
      [{ plantingId: 'p2', plantKey: 'cabai-rawit', amount: 1, unit: 'kg' }],
      []
    );

    const cabai = result.perPlanting.find((p) => p.plantingId === 'p2')!;
    // Dinilai nol akan membuat kebun terlihat rugi padahal datanya cuma belum ada.
    expect(cabai.value).toBeNull();
    expect(cabai.net).toBeNull();
    expect(result.missingPrices).toContain('cabai-rawit');
  });

  it('menandai satuan panen yang tidak cocok dengan satuan harga', () => {
    const result = summarizeEconomics(
      labels,
      [],
      [{ plantingId: 'p1', plantKey: 'kangkung', amount: 5, unit: 'ikat' }],
      [{ plantKey: 'kangkung', price: 12_000, unit: 'kg' }]
    );

    const kangkung = result.perPlanting.find((p) => p.plantingId === 'p1')!;
    expect(kangkung.unitMismatch).toBe(true);
    expect(kangkung.value).toBeNull();
  });

  it('memasukkan biaya umum ke total tapi tidak ke penanaman mana pun', () => {
    const result = summarizeEconomics(
      labels,
      [
        { plantingId: null, kind: 'pupuk', amount: 50_000 },
        { plantingId: 'p1', kind: 'benih', amount: 15_000 },
      ],
      [],
      []
    );

    expect(result.sharedCost).toBe(50_000);
    expect(result.totalCost).toBe(65_000);
    expect(result.perPlanting.find((p) => p.plantingId === 'p1')!.cost).toBe(15_000);
  });

  it('mengurutkan yang paling menguntungkan lebih dulu', () => {
    const result = summarizeEconomics(
      labels,
      [{ plantingId: 'p1', kind: 'benih', amount: 15_000 }],
      [
        { plantingId: 'p1', plantKey: 'kangkung', amount: 3, unit: 'kg' },
        { plantingId: 'p2', plantKey: 'cabai-rawit', amount: 1, unit: 'kg' },
      ],
      [
        { plantKey: 'kangkung', price: 12_000, unit: 'kg' },
        { plantKey: 'cabai-rawit', price: 5_000, unit: 'kg' },
      ]
    );

    expect(result.perPlanting[0].plantingId).toBe('p1');
  });
});

describe('sowLeadDays', () => {
  it('memakai setengah umur panen dalam batas 7 sampai 21 hari', () => {
    expect(sowLeadDays(25)).toBe(13);
    expect(sowLeadDays(10)).toBe(7);  // dibatasi bawah
    expect(sowLeadDays(90)).toBe(21); // dibatasi atas
  });
});

describe('findSuccessionDue', () => {
  const plantsById = new Map(PLANTS.map((p) => [p.id, p]));
  const singleHarvest = PLANTS.find((p) => !p.repeatHarvest)!;
  const repeatHarvest = PLANTS.find((p) => p.repeatHarvest)!;

  it('mengusulkan semai ulang menjelang panen tanaman sekali cabut', () => {
    const lead = sowLeadDays(singleHarvest.daysToHarvest[0]);
    const harvest = '2026-09-01';
    const today = new Date(new Date(`${harvest}T00:00:00Z`).getTime() - lead * 86400000)
      .toISOString()
      .slice(0, 10);

    const due = findSuccessionDue(
      [{ id: 'p1', plantId: singleHarvest.id, label: 'Bedeng A', nextHarvest: harvest }],
      plantsById,
      today
    );

    expect(due).toHaveLength(1);
    expect(due[0].daysUntilSow).toBe(0);
  });

  it('mengabaikan tanaman panen berulang', () => {
    const due = findSuccessionDue(
      [{ id: 'p2', plantId: repeatHarvest.id, label: 'Cabai', nextHarvest: '2026-08-25' }],
      plantsById,
      '2026-08-24'
    );

    // Bedengannya tidak pernah kosong, jadi tidak ada jeda yang perlu ditutup.
    expect(due).toEqual([]);
  });

  it('tetap menyertakan yang tanggal semainya sudah terlewat', () => {
    const due = findSuccessionDue(
      [{ id: 'p1', plantId: singleHarvest.id, label: 'Bedeng A', nextHarvest: '2026-08-25' }],
      plantsById,
      '2026-08-24'
    );

    expect(due).toHaveLength(1);
    expect(due[0].daysUntilSow).toBeLessThan(0);
  });

  it('mengabaikan penanaman tanpa perkiraan panen', () => {
    expect(
      findSuccessionDue(
        [{ id: 'p1', plantId: singleHarvest.id, label: 'Bedeng A', nextHarvest: null }],
        plantsById,
        '2026-08-24'
      )
    ).toEqual([]);
  });

  it('mengabaikan tanaman di luar katalog', () => {
    expect(
      findSuccessionDue(
        [{ id: 'p1', plantId: null, label: 'Entah', nextHarvest: '2026-08-25' }],
        plantsById,
        '2026-08-24'
      )
    ).toEqual([]);
  });
});

describe('computeBreakEven', () => {
  it('menandai tahun pertama kumulatif net tidak lagi negatif', () => {
    const result = computeBreakEven([
      { year: 2024, cost: 500_000, value: 100_000 }, // net -400.000, kumulatif -400.000
      { year: 2025, cost: 100_000, value: 300_000 }, // net +200.000, kumulatif -200.000
      { year: 2026, cost: 50_000, value: 400_000 }, // net +350.000, kumulatif +150.000
    ]);
    expect(result.breakEvenYear).toBe(2026);
    expect(result.cumulativeNet).toBe(150_000);
  });

  it('null kalau belum pernah balik modal', () => {
    const result = computeBreakEven([
      { year: 2024, cost: 500_000, value: 100_000 },
      { year: 2025, cost: 100_000, value: 50_000 },
    ]);
    expect(result.breakEvenYear).toBeNull();
    expect(result.cumulativeNet).toBeLessThan(0);
  });

  it('tahun pertama sudah untung langsung ditandai balik modal', () => {
    const result = computeBreakEven([{ year: 2026, cost: 50_000, value: 200_000 }]);
    expect(result.breakEvenYear).toBe(2026);
  });

  it('mengurutkan tahun walau input tidak berurutan', () => {
    const result = computeBreakEven([
      { year: 2026, cost: 0, value: 100_000 },
      { year: 2024, cost: 500_000, value: 0 },
      { year: 2025, cost: 0, value: 300_000 },
    ]);
    expect(result.years.map((y) => y.year)).toEqual([2024, 2025, 2026]);
    // Kumulatif tetap dihitung berurutan waktu meski input acak.
    expect(result.years[1].cumulativeNet).toBe(-200_000);
  });

  it('array kosong menghasilkan ringkasan kosong tanpa error', () => {
    expect(computeBreakEven([])).toEqual({ years: [], breakEvenYear: null, cumulativeNet: 0 });
  });
});
