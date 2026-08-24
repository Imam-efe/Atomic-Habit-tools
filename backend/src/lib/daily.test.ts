import { describe, it, expect } from 'vitest';
import { dayName, shiftDate, getBillRadar, getKidsFor, getMissedYesterday, getExpiringItems } from './daily';

/** Stub D1 yang mengembalikan baris berdasarkan tabel yang disebut di SQL. */
function stubDb(tables: Record<string, unknown[]>): D1Database {
  return {
    prepare(sql: string) {
      const table = Object.keys(tables).find((name) => sql.includes(name));
      return {
        bind() {
          return {
            all: async () => ({ results: table ? tables[table] : [] }),
          };
        },
      };
    },
  } as unknown as D1Database;
}

describe('dayName', () => {
  it('memberi nama hari Indonesia yang cocok dengan kids_schedules', () => {
    expect(dayName('2026-08-24')).toBe('Senin');
    expect(dayName('2026-08-30')).toBe('Minggu');
  });
});

describe('shiftDate', () => {
  it('menggeser maju dan mundur', () => {
    expect(shiftDate('2026-08-24', 3)).toBe('2026-08-27');
    expect(shiftDate('2026-08-24', -1)).toBe('2026-08-23');
  });

  it('melintasi batas bulan dan tahun', () => {
    expect(shiftDate('2026-08-31', 1)).toBe('2026-09-01');
    expect(shiftDate('2026-01-01', -1)).toBe('2025-12-31');
  });
});

describe('getBillRadar', () => {
  const bills = [
    { id: 'b1', person_name: 'Listrik', amount_idr: 400_000, due_date: '2026-08-25' },
    { id: 'b2', person_name: 'Budi', amount_idr: 600_000, due_date: '2026-08-23' },
  ];

  it('menghitung sisa hari, termasuk negatif untuk yang telat', async () => {
    const radar = await getBillRadar(stubDb({ debts: bills, bank_accounts: [] }), 'u', '2026-08-24');

    expect(radar.bills.map((b) => b.daysUntil)).toEqual([1, -1]);
    expect(radar.total).toBe(1_000_000);
  });

  it('memilih rekening bersaldo cukup untuk seluruh total', async () => {
    const accounts = [
      { id: 'a1', name: 'BCA', balance: 2_000_000 },
      { id: 'a2', name: 'Dompet', balance: 300_000 },
    ];
    const radar = await getBillRadar(stubDb({ debts: bills, bank_accounts: accounts }), 'u', '2026-08-24');

    expect(radar.coveringAccount?.name).toBe('BCA');
    expect(radar.totalBalance).toBe(2_300_000);
  });

  it('tidak menyarankan rekening bila tak satu pun cukup', async () => {
    const accounts = [
      { id: 'a1', name: 'BCA', balance: 400_000 },
      { id: 'a2', name: 'Dompet', balance: 300_000 },
    ];
    const radar = await getBillRadar(stubDb({ debts: bills, bank_accounts: accounts }), 'u', '2026-08-24');

    // Gabungannya cukup, tapi tidak ada satu rekening yang menutup — jangan
    // menyarankan rekening yang sebetulnya akan gagal saat dibayar.
    expect(radar.coveringAccount).toBeNull();
    expect(radar.totalBalance).toBe(700_000);
  });

  it('kosong bila tidak ada tagihan', async () => {
    const radar = await getBillRadar(stubDb({ debts: [], bank_accounts: [] }), 'u', '2026-08-24');

    expect(radar.bills).toEqual([]);
    expect(radar.total).toBe(0);
    expect(radar.coveringAccount).toBeNull();
  });
});

describe('getKidsFor', () => {
  it('memetakan baris jadwal ke bentuk yang dipakai UI', async () => {
    const rows = [
      { kid_name: 'Aisyah', title: 'Matematika', type: 'pelajaran', schedule_time: '07:00', note: 'bawa penggaris' },
      { kid_name: 'Aisyah', title: 'Renang', type: 'aktivitas', schedule_time: null, note: null },
    ];
    const items = await getKidsFor(stubDb({ kids_schedules: rows }), 'u', '2026-08-24');

    expect(items).toEqual([
      { kidName: 'Aisyah', title: 'Matematika', type: 'pelajaran', time: '07:00', note: 'bawa penggaris' },
      { kidName: 'Aisyah', title: 'Renang', type: 'aktivitas', time: null, note: null },
    ]);
  });
});

describe('getMissedYesterday', () => {
  it('menyertakan versi dua menit bila sudah ditulis', async () => {
    const rows = [
      { id: 'h1', name: 'Olahraga', streak: 12, two_min: 'Pakai sepatu lari' },
      { id: 'h2', name: 'Baca', streak: 3, two_min: null },
    ];
    const missed = await getMissedYesterday(stubDb({ habits: rows }), 'u', '2026-08-24');

    expect(missed[0]).toEqual({ id: 'h1', name: 'Olahraga', streak: 12, twoMin: 'Pakai sepatu lari' });
    expect(missed[1].twoMin).toBeNull();
  });

  it('kosong bila tidak ada yang terlewat', async () => {
    expect(await getMissedYesterday(stubDb({ habits: [] }), 'u', '2026-08-24')).toEqual([]);
  });
});

describe('getExpiringItems', () => {
  it('menghitung sisa hari, nol untuk hari ini dan negatif untuk yang lewat', async () => {
    const rows = [
      { id: 'i1', name: 'Bayam', quantity: 1, unit: 'ikat', expiry_date: '2026-08-24' },
      { id: 'i2', name: 'Susu', quantity: 2, unit: 'kotak', expiry_date: '2026-08-22' },
      { id: 'i3', name: 'Tahu', quantity: 3, unit: 'buah', expiry_date: '2026-08-26' },
    ];
    const items = await getExpiringItems(stubDb({ inventory_items: rows }), 'u', '2026-08-24');

    expect(items.map((i) => i.daysLeft)).toEqual([0, -2, 2]);
    expect(items[0].name).toBe('Bayam');
  });
});
