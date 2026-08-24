import { describe, it, expect } from 'vitest';
import { calibrateFromHistory, effectiveDaysToHarvest, type HarvestCycle } from './garden_calibration';
import { computeGardenStreak } from './garden_streak';
import { computeUnitCosts, type PlantCostEntry, type PlantHarvestEntry } from './garden_unit_cost';
import {
  planNextSeason, type SeasonCandidate, type EconomicSignal, type FailureSignal, type SeedOnHand,
} from './garden_next_season';
import { classifyWeather } from './garden_weather_events';

// ───────────────────── KALIBRASI KATALOG ─────────────────────

const catalog = new Map([['cabai', 60], ['bayam', 25]]);

function cycle(over: Partial<HarvestCycle> = {}): HarvestCycle {
  return { plantId: 'cabai', plantedDate: '2026-01-01', firstHarvestDate: '2026-03-12', ...over };
}

describe('calibrateFromHistory', () => {
  it('menghitung selisih umur panen nyata terhadap katalog', () => {
    const [c] = calibrateFromHistory([cycle()], catalog);
    expect(c.actualDays).toBe(70);
    expect(c.catalogDays).toBe(60);
    expect(c.deltaDays).toBe(10);
  });

  it('menandai satu siklus sebagai belum meyakinkan', () => {
    expect(calibrateFromHistory([cycle()], catalog)[0].reliable).toBe(false);
  });

  it('menjadi meyakinkan setelah dua siklus', () => {
    const [c] = calibrateFromHistory([cycle(), cycle({ plantedDate: '2026-04-01', firstHarvestDate: '2026-06-10' })], catalog);
    expect(c.reliable).toBe(true);
    expect(c.cycles).toBe(2);
  });

  it('membuang tanggal yang tidak masuk akal', () => {
    // Panen sehari setelah tanam hampir pasti salah ketik; satu baris seperti
    // ini bisa menyeret rata-rata sampai tak berguna.
    const out = calibrateFromHistory([cycle({ firstHarvestDate: '2026-01-02' })], catalog);
    expect(out).toHaveLength(0);
  });

  it('melewati tanaman yang tidak ada di katalog', () => {
    expect(calibrateFromHistory([cycle({ plantId: 'entah' })], catalog)).toHaveLength(0);
  });
});

describe('effectiveDaysToHarvest', () => {
  it('tetap memakai katalog sampai kalibrasi meyakinkan', () => {
    const cals = calibrateFromHistory([cycle()], catalog);
    expect(effectiveDaysToHarvest('cabai', 60, cals)).toEqual({ days: 60, calibrated: false });
  });

  it('memakai angka kebun sendiri begitu cukup siklus', () => {
    const cals = calibrateFromHistory(
      [cycle(), cycle({ plantedDate: '2026-04-01', firstHarvestDate: '2026-06-10' })],
      catalog
    );
    expect(effectiveDaysToHarvest('cabai', 60, cals)).toEqual({ days: 70, calibrated: true });
  });
});

// ───────────────────────── STREAK KEBUN ─────────────────────────

const d = (...dates: string[]) => dates.map((date) => ({ date }));

describe('computeGardenStreak', () => {
  it('mengembalikan nol saat belum ada perawatan', () => {
    const s = computeGardenStreak([], '2026-01-10');
    expect(s).toEqual({ current: 0, longest: 0, activeToday: false, totalDays: 0 });
  });

  it('menghitung hari berturut-turut', () => {
    const s = computeGardenStreak(d('2026-01-08', '2026-01-09', '2026-01-10'), '2026-01-10');
    expect(s.current).toBe(3);
    expect(s.activeToday).toBe(true);
  });

  it('memaafkan bolong satu hari', () => {
    // Kebun tidak menuntut perawatan tiap hari; yang dinilai kehadiran teratur.
    const s = computeGardenStreak(d('2026-01-06', '2026-01-08', '2026-01-10'), '2026-01-10');
    expect(s.current).toBe(3);
  });

  it('memutus rentetan setelah dua hari kosong', () => {
    const s = computeGardenStreak(d('2026-01-01', '2026-01-05', '2026-01-06'), '2026-01-06');
    expect(s.current).toBe(2);
  });

  it('tidak mengaku punya rentetan kalau kebun lama ditinggal', () => {
    const s = computeGardenStreak(d('2026-01-01', '2026-01-02', '2026-01-03'), '2026-02-01');
    expect(s.current).toBe(0);
    expect(s.longest).toBe(3);
  });

  it('menghitung beberapa perawatan sehari sebagai satu hari', () => {
    const s = computeGardenStreak(d('2026-01-10', '2026-01-10', '2026-01-10'), '2026-01-10');
    expect(s.totalDays).toBe(1);
    expect(s.current).toBe(1);
  });

  it('rentetan tetap berjalan kalau hari ini belum sempat merawat', () => {
    const s = computeGardenStreak(d('2026-01-08', '2026-01-09'), '2026-01-10');
    expect(s.current).toBe(2);
    expect(s.activeToday).toBe(false);
  });
});

// ─────────────────────────── HPP PER SATUAN ───────────────────────────

const cost = (over: Partial<PlantCostEntry> = {}): PlantCostEntry =>
  ({ plantKey: 'cabai', name: 'Cabai', costIdr: 100000, ...over });
const harv = (over: Partial<PlantHarvestEntry> = {}): PlantHarvestEntry =>
  ({ plantKey: 'cabai', name: 'Cabai', amount: 10, unit: 'kg', ...over });

describe('computeUnitCosts', () => {
  it('menghitung biaya per satuan dan menyebut untung', () => {
    const [u] = computeUnitCosts([cost()], [harv()], new Map([['cabai', 30000]]));
    expect(u.costPerUnitIdr).toBe(10000);
    expect(u.verdict).toBe('untung');
    expect(u.savingPerUnitIdr).toBe(20000);
  });

  it('menyebut rugi saat menanam lebih mahal daripada membeli', () => {
    const [u] = computeUnitCosts([cost({ costIdr: 500000 })], [harv()], new Map([['cabai', 30000]]));
    expect(u.verdict).toBe('rugi');
    expect(u.advice).toContain('Lebih mahal');
  });

  it('menyebut impas saat selisihnya tipis', () => {
    const [u] = computeUnitCosts([cost({ costIdr: 300000 })], [harv()], new Map([['cabai', 30000]]));
    expect(u.verdict).toBe('impas');
  });

  it('tidak menghakimi tanpa harga pasar', () => {
    const [u] = computeUnitCosts([cost()], [harv()], new Map());
    expect(u.verdict).toBe('belum-cukup-data');
    expect(u.advice).toContain('Catat harga pasarnya');
  });

  it('melaporkan biaya yang belum menghasilkan panen', () => {
    const [u] = computeUnitCosts([cost()], [], new Map());
    expect(u.costPerUnitIdr).toBeNull();
    expect(u.advice).toContain('belum ada panen');
  });

  it('memakai satuan mayoritas, tidak menjumlahkan satuan berbeda', () => {
    const [u] = computeUnitCosts(
      [cost()],
      [harv({ amount: 10, unit: 'kg' }), harv({ amount: 2, unit: 'ikat' })],
      new Map()
    );
    expect(u.unit).toBe('kg');
    expect(u.totalAmount).toBe(10);
  });

  it('mendahulukan yang paling merugi', () => {
    const out = computeUnitCosts(
      [cost({ plantKey: 'a', name: 'A', costIdr: 10000 }), cost({ plantKey: 'b', name: 'B', costIdr: 900000 })],
      [harv({ plantKey: 'a', name: 'A' }), harv({ plantKey: 'b', name: 'B' })],
      new Map([['a', 30000], ['b', 30000]])
    );
    expect(out[0].name).toBe('B');
    expect(out[0].verdict).toBe('rugi');
  });
});

// ──────────────────── RENCANA MUSIM DEPAN ────────────────────

const cand = (over: Partial<SeasonCandidate> = {}): SeasonCandidate =>
  ({ plantId: 'cabai', name: 'Cabai', emoji: '🌶️', fit: 'ideal', daysToHarvestMin: 60, ...over });

describe('planNextSeason', () => {
  it('mengutamakan tanaman yang musimnya pas, untung, dan benihnya ada', () => {
    const [item] = planNextSeason(
      [cand()],
      [{ plantId: 'cabai', verdict: 'untung', savingPerUnitIdr: 20000 } as EconomicSignal],
      [],
      [{ plantId: 'cabai', name: 'Cabai', expired: false } as SeedOnHand],
      []
    );
    expect(item.recommendation).toBe('utamakan');
    expect(item.seedOnHand).toBe(true);
  });

  it('menyarankan menghindari tanaman yang berulang kali gagal dan merugi', () => {
    const [item] = planNextSeason(
      [cand()],
      [{ plantId: 'cabai', verdict: 'rugi', savingPerUnitIdr: -5000 } as EconomicSignal],
      [{ plantId: 'cabai', failures: 3 } as FailureSignal],
      [],
      []
    );
    expect(item.recommendation).toBe('hindari');
    expect(item.reasons.join(' ')).toContain('3 kali gagal');
  });

  it('menyebut lokasi yang terhalang rotasi tanpa mencoret tanamannya', () => {
    const [item] = planNextSeason(
      [cand()], [], [], [],
      [{ location: 'Bedeng A', plantId: 'cabai', reason: 'famili sama' }]
    );
    expect(item.blockedLocations).toEqual(['Bedeng A']);
    expect(item.reasons.join(' ')).toContain('Bedeng A');
  });

  it('mencocokkan benih lewat nama untuk tanaman di luar katalog', () => {
    const [item] = planNextSeason(
      [cand({ plantId: 'kemangi', name: 'Kemangi' })], [], [],
      [{ plantId: null, name: '  kemangi ', expired: false }], []
    );
    expect(item.seedOnHand).toBe(true);
  });

  it('tidak mengarang tanaman di luar kandidat musim', () => {
    const out = planNextSeason([], [{ plantId: 'x', verdict: 'untung', savingPerUnitIdr: 1 }], [], [], []);
    expect(out).toHaveLength(0);
  });
});

// ──────────────────── CUACA EKSTREM ────────────────────

describe('classifyWeather', () => {
  it('menandai hujan sangat lebat', () => {
    const e = classifyWeather({ yesterday: 0, today: 60, tomorrow: 0 });
    expect(e.kind).toBe('hujan-ekstrem');
    expect(e.note).toContain('genangan');
  });

  it('menandai kering panjang', () => {
    const e = classifyWeather({ yesterday: 0, today: 0, tomorrow: 0 });
    expect(e.kind).toBe('kering-panjang');
  });

  it('menyebut cuaca biasa sebagai normal tanpa catatan', () => {
    const e = classifyWeather({ yesterday: 5, today: 3, tomorrow: 8 });
    expect(e.kind).toBe('normal');
    expect(e.note).toBe('');
  });

  it('mendahulukan hujan ekstrem daripada hitungan hari kering', () => {
    // Dua hari kering lalu hujan deras: yang mendesak jelas hujannya.
    const e = classifyWeather({ yesterday: 0, today: 0, tomorrow: 80 });
    expect(e.kind).toBe('hujan-ekstrem');
  });
});
