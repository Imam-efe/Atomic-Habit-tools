import { describe, it, expect } from 'vitest';
import {
  germinationRate, rankSeedSources, summarizeSowings, NO_BRAND,
  type SowingRecord, type SowingStatusRecord,
} from './garden_germination';
import { forecastHarvest, expectedCareCount } from './garden_harvest_forecast';
import { planSupplies, type SupplyPlanting } from './garden_supplies';
import { rankTreatments, pendingReviews, bestTreatmentFor, type TreatmentRecord } from './garden_treatment';
import { inspectBed, suggestSlot, type Bed, type BedSlot, type BedMarker } from './garden_bed_map';
import { buildKitchenReport, priceKey, type HarvestEntry } from './garden_kitchen';

// ───────────────────────── #6 PEMBIBITAN ─────────────────────────

describe('germinationRate', () => {
  it('menghitung persen kecambah', () => {
    expect(germinationRate(20, 15)).toBe(75);
  });

  it('menolak pembagian dengan nol', () => {
    expect(germinationRate(0, 0)).toBeNull();
  });

  it('mengunci di 100% saat kecambah melebihi yang disemai', () => {
    // Salah ketik lebih baik dilaporkan sebagai 100% daripada 150%.
    expect(germinationRate(10, 15)).toBe(100);
  });

  it('memperlakukan gagal total sebagai 0, bukan tidak ada data', () => {
    expect(germinationRate(30, 0)).toBe(0);
  });
});

function sowing(over: Partial<SowingRecord> = {}): SowingRecord {
  return {
    id: 'a', plantId: 'cabai', name: 'Cabai', brand: 'Merek A',
    sownDate: '2026-01-01', seedCount: 10, germinatedCount: 8, ...over,
  };
}

describe('rankSeedSources', () => {
  it('mengabaikan batch yang belum dihitung', () => {
    const scores = rankSeedSources([
      sowing({ brand: 'A', seedCount: 10, germinatedCount: 9 }),
      sowing({ brand: 'A', seedCount: 100, germinatedCount: null }),
    ]);
    // Batch kedua tidak boleh menyeret angka A turun.
    expect(scores[0].seedsSown).toBe(10);
    expect(scores[0].ratePercent).toBe(90);
  });

  it('mendahulukan merek dengan data cukup meski persennya kalah', () => {
    const scores = rankSeedSources([
      sowing({ brand: 'Untung', seedCount: 5, germinatedCount: 5 }),
      sowing({ brand: 'Terbukti', seedCount: 30, germinatedCount: 24 }),
      sowing({ brand: 'Terbukti', seedCount: 30, germinatedCount: 24 }),
    ]);
    expect(scores[0].brand).toBe('Terbukti');
    expect(scores[0].reliable).toBe(true);
    expect(scores[1].reliable).toBe(false);
  });

  it('mengelompokkan benih tanpa merek', () => {
    const scores = rankSeedSources([sowing({ brand: null }), sowing({ brand: '  ' })]);
    expect(scores).toHaveLength(1);
    expect(scores[0].brand).toBe(NO_BRAND);
    expect(scores[0].batches).toBe(2);
  });
});

describe('summarizeSowings', () => {
  it('menghitung bibit siap pindah dan batch yang belum dinilai', () => {
    const records: SowingStatusRecord[] = [
      { ...sowing({ seedCount: 20, germinatedCount: 16 }), transplantedDate: null },
      { ...sowing({ seedCount: 20, germinatedCount: 10 }), transplantedDate: '2026-02-01' },
      { ...sowing({ germinatedCount: null }), transplantedDate: null },
    ];
    const s = summarizeSowings(records);
    expect(s.totalBatches).toBe(3);
    expect(s.pendingCount).toBe(1);
    // Hanya yang belum dipindah yang dihitung siap tanam.
    expect(s.readyToTransplant).toBe(16);
    expect(s.overallRatePercent).toBe(65); // 26 dari 40
  });
});

// ─────────────────── #5 PERKIRAAN PANEN ADAPTIF ───────────────────

describe('forecastHarvest', () => {
  const patuh = { waterExpected: 10, waterActual: 10, fertilizeExpected: 3, fertilizeActual: 3 };

  it('tidak menggeser tanggal saat perawatan sesuai anjuran', () => {
    const f = forecastHarvest('2026-01-01', 60, patuh, '2026-02-01');
    expect(f.baselineDate).toBe('2026-03-02');
    expect(f.shiftDays).toBe(0);
    expect(f.estimatedDate).toBe(f.baselineDate);
    expect(f.confidence).toBe('tinggi');
  });

  it('memundurkan panen saat penyiraman jauh tertinggal', () => {
    const f = forecastHarvest(
      '2026-01-01', 60,
      { waterExpected: 10, waterActual: 5, fertilizeExpected: 3, fertilizeActual: 3 },
      '2026-02-01'
    );
    expect(f.shiftDays).toBeGreaterThan(0);
    expect(f.estimatedDate > f.baselineDate).toBe(true);
    expect(f.reason).toContain('penyiraman');
  });

  it('membatasi geseran supaya tidak melempar tanggal terlalu jauh', () => {
    const f = forecastHarvest(
      '2026-01-01', 60,
      { waterExpected: 10, waterActual: 0, fertilizeExpected: 10, fertilizeActual: 0 },
      '2026-02-01'
    );
    expect(f.shiftDays).toBeLessThanOrEqual(30); // 50% dari 60 hari
  });

  it('menandai keyakinan rendah saat riwayat perawatan masih tipis', () => {
    const f = forecastHarvest(
      '2026-01-01', 60,
      { waterExpected: 1, waterActual: 1, fertilizeExpected: 0, fertilizeActual: 0 },
      '2026-01-04'
    );
    expect(f.confidence).toBe('rendah');
    expect(f.reason).toContain('Belum cukup riwayat');
  });

  it('menghormati tanggal panen yang diisi pengguna', () => {
    const f = forecastHarvest('2026-01-01', 60, patuh, '2026-02-01', '2026-04-01');
    expect(f.baselineDate).toBe('2026-04-01');
  });

  it('melaporkan hari terlewat saat perkiraan sudah lewat', () => {
    const f = forecastHarvest('2026-01-01', 30, patuh, '2026-02-10');
    expect(f.overdueDays).toBe(10); // panen 31 Jan, hari ini 10 Feb
  });
});

describe('expectedCareCount', () => {
  it('menghitung kewajiban dari umur tanaman', () => {
    expect(expectedCareCount('2026-01-01', '2026-01-15', 3)).toBe(4);
  });

  it('mengembalikan nol untuk interval tidak masuk akal', () => {
    expect(expectedCareCount('2026-01-01', '2026-01-15', 0)).toBe(0);
  });
});

// ──────────────────── #7 KALKULATOR BELANJA ────────────────────

describe('planSupplies', () => {
  const base: SupplyPlanting = {
    plantingId: 'p1', name: 'Cabai', quantity: 4,
    potLiter: 10, fertilizeIntervalDays: 14, daysToHarvest: 56,
  };

  it('membulatkan media tanam ke jumlah karung', () => {
    const needs = planSupplies([base]); // 40 liter
    const media = needs.find((n) => n.id === 'media')!;
    expect(media.amount).toBe(2); // 40 / 25 dibulatkan ke atas
    expect(media.basis).toContain('40 liter');
  });

  it('melewati media untuk tanaman yang tidak cocok di pot', () => {
    const needs = planSupplies([{ ...base, potLiter: 0 }]);
    expect(needs.find((n) => n.id === 'media')).toBeUndefined();
  });

  it('tidak menghitung pupuk untuk tanaman yang sudah lewat panen', () => {
    const needs = planSupplies([{ ...base, daysToHarvest: 0 }]);
    expect(needs.find((n) => n.id === 'pupuk')).toBeUndefined();
  });

  it('menjumlahkan kebutuhan lintas tanaman', () => {
    const needs = planSupplies([base, { ...base, plantingId: 'p2', quantity: 6 }]);
    const media = needs.find((n) => n.id === 'media')!;
    expect(media.basis).toContain('100 liter');
  });
});

// ─────────────── #9 EFEKTIVITAS PENANGANAN HAMA ───────────────

function pest(over: Partial<TreatmentRecord> = {}): TreatmentRecord {
  return {
    pest: 'Kutu daun', treatment: 'Neem oil', worked: 1,
    spottedDate: '2026-01-01', resolvedDate: '2026-01-05', ...over,
  };
}

describe('rankTreatments', () => {
  it('menggabungkan penulisan yang beda kapital dan spasi', () => {
    const scores = rankTreatments([pest(), pest({ treatment: ' neem oil ' })]);
    expect(scores).toHaveLength(1);
    expect(scores[0].tried).toBe(2);
  });

  it('memisahkan penanganan per hama', () => {
    const scores = rankTreatments([pest(), pest({ pest: 'Ulat' })]);
    expect(scores).toHaveLength(2);
  });

  it('melewati catatan yang belum dinilai', () => {
    const scores = rankTreatments([pest({ worked: null })]);
    expect(scores).toHaveLength(0);
  });

  it('menghitung persen keberhasilan dan rata-rata hari', () => {
    const scores = rankTreatments([
      pest({ worked: 1, spottedDate: '2026-01-01', resolvedDate: '2026-01-05' }),
      pest({ worked: 0, resolvedDate: null }),
    ]);
    expect(scores[0].successPercent).toBe(50);
    expect(scores[0].avgDaysToResolve).toBe(4);
  });

  it('mendahulukan yang lebih sering dicoba saat persennya seri', () => {
    const scores = rankTreatments([
      pest({ treatment: 'Sekali coba' }),
      pest({ treatment: 'Sering' }),
      pest({ treatment: 'Sering' }),
    ]);
    expect(scores[0].treatment).toBe('Sering');
  });
});

describe('pendingReviews', () => {
  it('hanya menagih catatan yang sudah cukup umur dan belum dinilai', () => {
    const list = pendingReviews([
      pest({ worked: null, spottedDate: '2026-01-01' }),
      pest({ worked: null, spottedDate: '2026-01-09' }),
      pest({ worked: 1, spottedDate: '2026-01-01' }),
    ], '2026-01-10');
    expect(list).toHaveLength(1);
    expect(list[0].spottedDate).toBe('2026-01-01');
  });
});

describe('bestTreatmentFor', () => {
  it('mengabaikan penanganan yang belum pernah berhasil', () => {
    const scores = rankTreatments([pest({ treatment: 'Gagal terus', worked: 0 })]);
    expect(bestTreatmentFor('Kutu daun', scores)).toBeNull();
  });

  it('menemukan penanganan terbaik tanpa peduli kapital', () => {
    const scores = rankTreatments([pest()]);
    expect(bestTreatmentFor('kutu DAUN', scores)?.treatment).toBe('Neem oil');
  });
});

// ─────────────────────── #8 DENAH BEDENGAN ───────────────────────

const bed: Bed = { id: 'b1', name: 'Bedeng A', widthCm: 100, lengthCm: 200 };

function slot(over: Partial<BedSlot> = {}): BedSlot {
  return { plantingId: 's1', name: 'Cabai', posX: 50, posY: 50, spacingCm: 40, ...over };
}

describe('inspectBed', () => {
  it('menerima denah yang lapang', () => {
    const r = inspectBed(bed, [slot(), slot({ plantingId: 's2', posY: 150 })]);
    expect(r.issues).toHaveLength(0);
    expect(r.slotCount).toBe(2);
  });

  it('menandai tanaman yang melewati tepi', () => {
    const r = inspectBed(bed, [slot({ posX: 5 })]); // radius 20, keluar kiri
    expect(r.issues[0].kind).toBe('keluar-batas');
  });

  it('menandai dua tanaman yang berebut ruang', () => {
    const r = inspectBed(bed, [slot(), slot({ plantingId: 's2', posY: 70 })]);
    const rapat = r.issues.find((i) => i.kind === 'terlalu-rapat')!;
    expect(rapat.plantingIds).toEqual(['s1', 's2']);
  });

  it('memakai jarak tanam masing-masing, bukan rata-rata', () => {
    // Bayam radius 5, cabai radius 20 → butuh 25 cm. Jarak 30 cm cukup.
    const r = inspectBed(bed, [
      slot({ plantingId: 'cabai', spacingCm: 40 }),
      slot({ plantingId: 'bayam', name: 'Bayam', posY: 80, spacingCm: 10 }),
    ]);
    expect(r.issues).toHaveLength(0);
  });

  it('mengunci pemakaian ruang di 100 persen', () => {
    const crowded = Array.from({ length: 40 }, (_, i) =>
      slot({ plantingId: `s${i}`, posX: 50, posY: 100, spacingCm: 60 })
    );
    expect(inspectBed(bed, crowded).usedPercent).toBe(100);
  });
});

describe('suggestSlot', () => {
  it('menemukan titik kosong di bedengan lapang', () => {
    const pos = suggestSlot(bed, [], 40);
    expect(pos).not.toBeNull();
    expect(pos!.posX).toBeGreaterThanOrEqual(20);
  });

  it('menghindari tanaman yang sudah ada', () => {
    const existing = [slot({ posX: 20, posY: 20, spacingCm: 40 })];
    const pos = suggestSlot(bed, existing, 40)!;
    const dx = pos.posX - 20;
    const dy = pos.posY - 20;
    expect(Math.sqrt(dx * dx + dy * dy)).toBeGreaterThanOrEqual(40);
  });

  it('mengembalikan null saat tanaman tidak mungkin muat', () => {
    expect(suggestSlot(bed, [], 500)).toBeNull();
  });

  it('menghindari penanda seperti pot kompos, bukan hanya tanaman', () => {
    const markers = [marker({ posX: 20, posY: 20, radiusCm: 20 })];
    const pos = suggestSlot(bed, [], 40, 5, markers)!;
    const dx = pos.posX - 20;
    const dy = pos.posY - 20;
    expect(Math.sqrt(dx * dx + dy * dy)).toBeGreaterThanOrEqual(40);
  });
});

function marker(over: Partial<BedMarker> = {}): BedMarker {
  return { id: 'm1', label: 'Pot kompos', posX: 50, posY: 50, radiusCm: 20, ...over };
}

describe('inspectBed dengan penanda', () => {
  it('penanda yang melewati tepi ikut ditandai, dengan markerIds bukan plantingIds', () => {
    const r = inspectBed(bed, [], [marker({ posX: 5 })]);
    expect(r.issues[0].kind).toBe('keluar-batas');
    expect(r.issues[0].markerIds).toEqual(['m1']);
    expect(r.issues[0].plantingIds).toEqual([]);
  });

  it('tanaman yang menumpuk dengan penanda ditandai terlalu rapat', () => {
    const r = inspectBed(bed, [slot()], [marker()]); // sama-sama di (50, 50)
    const rapat = r.issues.find((i) => i.kind === 'terlalu-rapat')!;
    expect(rapat.plantingIds).toEqual(['s1']);
    expect(rapat.markerIds).toEqual(['m1']);
  });

  it('penanda ikut dihitung ke pemakaian ruang', () => {
    const kosong = inspectBed(bed, []).usedPercent;
    const denganPenanda = inspectBed(bed, [], [marker({ radiusCm: 30 })]).usedPercent;
    expect(denganPenanda).toBeGreaterThan(kosong);
  });

  it('tetap menerima pemanggilan lama tanpa argumen penanda', () => {
    // Situs panggilan yang belum diperbarui tidak boleh rusak.
    expect(() => inspectBed(bed, [slot()])).not.toThrow();
  });
});

// ──────────────────── #4 DARI KEBUN KE PIRING ────────────────────

function harvest(over: Partial<HarvestEntry> = {}): HarvestEntry {
  return { key: 'cabai', name: 'Cabai', amount: 2, unit: 'kg', date: '2026-01-05', ...over };
}

describe('buildKitchenReport', () => {
  it('menilai panen dari harga yang dicatat', () => {
    const prices = new Map([['cabai', 30000]]);
    const r = buildKitchenReport([harvest()], prices, 500000, '2026-01-01', '2026-01-31');
    expect(r.harvestValueIdr).toBe(60000);
    expect(r.selfSufficiencyPercent).toBe(12);
  });

  it('melaporkan panen tanpa harga apa adanya', () => {
    const r = buildKitchenReport([harvest()], new Map(), 500000, '2026-01-01', '2026-01-31');
    expect(r.harvestValueIdr).toBe(0);
    expect(r.unpricedHarvests).toEqual(['Cabai']);
    expect(r.items[0].valueIdr).toBeNull();
  });

  it('tidak membagi dengan nol saat belanja makanan kosong', () => {
    const r = buildKitchenReport([harvest()], new Map([['cabai', 30000]]), 0, '2026-01-01', '2026-01-31');
    expect(r.selfSufficiencyPercent).toBeNull();
  });

  it('tidak menjumlahkan satuan yang berbeda', () => {
    const r = buildKitchenReport(
      [harvest({ amount: 2, unit: 'kg' }), harvest({ amount: 3, unit: 'ikat' })],
      new Map(), 0, '2026-01-01', '2026-01-31'
    );
    expect(r.items).toHaveLength(2);
  });

  it('menjumlahkan panen tanaman dan satuan yang sama', () => {
    const r = buildKitchenReport(
      [harvest({ amount: 2 }), harvest({ amount: 3 })],
      new Map(), 0, '2026-01-01', '2026-01-31'
    );
    expect(r.items).toHaveLength(1);
    expect(r.items[0].amount).toBe(5);
  });

  it('memakai nama kustom sebagai kunci harga untuk tanaman di luar katalog', () => {
    expect(priceKey(null, '  Kemangi ')).toBe('kemangi');
    expect(priceKey('cabai', null)).toBe('cabai');
  });

  it('memisahkan kunci harga dari nama tampilan', () => {
    // Julukan tidak boleh membuat harga yang sudah dicatat jadi tidak ketemu.
    const prices = new Map([['cabai', 30000]]);
    const r = buildKitchenReport(
      [harvest({ key: 'cabai', name: 'Si Merah' })],
      prices, 0, '2026-01-01', '2026-01-31'
    );
    expect(r.items[0].name).toBe('Si Merah');
    expect(r.items[0].valueIdr).toBe(60000);
  });
});
