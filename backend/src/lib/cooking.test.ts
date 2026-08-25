import { describe, it, expect } from 'vitest';
import {
  normalkan, cocok, pilahBahan, hitungKesiapan, bacaResep, urutkanStok, ringkasStok,
  bacaRencana, type StockItem,
} from './cooking';

const stok = (name: string, quantity = 1, unit: string | null = 'pcs', daysLeft: number | null = null): StockItem =>
  ({ name, quantity, unit, daysLeft });

describe('normalkan', () => {
  it('menyamakan huruf besar dan spasi berlebih', () => {
    expect(normalkan('  Bawang   Merah ')).toBe('bawang merah');
  });

  it('membuang tanda baca yang dipakai orang saat mencatat stok', () => {
    expect(normalkan('Telur (ayam)')).toBe('telur ayam');
  });
});

describe('cocok', () => {
  it('mencocokkan nama yang sama persis', () => {
    expect(cocok('telur', 'Telur')).toBe(true);
  });

  it('mencocokkan stok yang lebih spesifik dari yang diminta', () => {
    // Resep minta "telur", kulkas berisi "Telur ayam".
    expect(cocok('telur', 'Telur ayam')).toBe(true);
  });

  it('mencocokkan permintaan yang lebih spesifik dari stok', () => {
    expect(cocok('telur ayam', 'Telur')).toBe(true);
  });

  it('tidak mencocokkan bahan berbeda yang berbagi satu kata', () => {
    // Ini kesalahan yang paling mengganggu: disuruh masak tanpa daun bawang
    // karena aplikasi mengira bawang merah sudah cukup.
    expect(cocok('daun bawang', 'bawang merah')).toBe(false);
  });

  it('tidak mencocokkan string kosong', () => {
    expect(cocok('', 'telur')).toBe(false);
    expect(cocok('telur', '   ')).toBe(false);
  });
});

describe('pilahBahan', () => {
  it('memisahkan yang ada dari yang kurang', () => {
    const { have, missing } = pilahBahan(
      ['telur', 'bawang merah', 'keju'],
      [stok('Telur ayam'), stok('Bawang merah')]
    );
    expect(have).toEqual(['Telur ayam', 'Bawang merah']);
    expect(missing).toEqual(['keju']);
  });

  it('memakai nama seperti tertulis di inventaris, bukan seperti ditulis model', () => {
    // Nama inventaris yang dipakai supaya bisa dicocokkan lagi saat stok
    // dikurangi setelah masak.
    const { have } = pilahBahan(['telur'], [stok('Telur ayam kampung')]);
    expect(have).toEqual(['Telur ayam kampung']);
  });

  it('tidak menggandakan bahan yang disebut dua kali', () => {
    const { have, missing } = pilahBahan(
      ['telur', 'Telur', 'garam', 'garam'],
      [stok('Telur')]
    );
    expect(have).toEqual(['Telur']);
    expect(missing).toEqual(['garam']);
  });

  it('mengabaikan entri kosong', () => {
    const { have, missing } = pilahBahan(['  ', 'telur'], [stok('Telur')]);
    expect(have).toEqual(['Telur']);
    expect(missing).toEqual([]);
  });

  it('menganggap semua kurang saat inventaris kosong', () => {
    const { have, missing } = pilahBahan(['telur', 'garam'], []);
    expect(have).toEqual([]);
    expect(missing).toEqual(['telur', 'garam']);
  });
});

describe('hitungKesiapan', () => {
  it('menghitung persentase bahan yang dimiliki', () => {
    expect(hitungKesiapan(3, 1)).toBe(75);
    expect(hitungKesiapan(4, 0)).toBe(100);
    expect(hitungKesiapan(0, 2)).toBe(0);
  });

  it('tidak membagi nol saat resep tanpa bahan', () => {
    expect(hitungKesiapan(0, 0)).toBe(0);
  });
});

describe('bacaResep', () => {
  const inventory = [stok('Telur'), stok('Nasi'), stok('Bawang merah')];

  it('memilah bahan tiap resep terhadap stok nyata', () => {
    const out = bacaResep({
      resep: [{ nama: 'Nasi goreng', bahan: ['nasi', 'telur', 'kecap'], langkah: ['tumis', 'aduk'], menit: 15, porsi: 2 }],
    }, inventory);

    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      name: 'Nasi goreng', have: ['Nasi', 'Telur'], missing: ['kecap'],
      minutes: 15, servings: 2, readiness: 67,
    });
  });

  it('mengurutkan yang paling siap dimasak lebih dulu', () => {
    const out = bacaResep({
      resep: [
        { nama: 'Butuh belanja', bahan: ['keju', 'susu', 'tepung'] },
        { nama: 'Bisa sekarang', bahan: ['nasi', 'telur'] },
      ],
    }, inventory);

    expect(out.map((r) => r.name)).toEqual(['Bisa sekarang', 'Butuh belanja']);
  });

  it('membuang resep tanpa nama atau tanpa bahan', () => {
    const out = bacaResep({
      resep: [
        { nama: '', bahan: ['telur'] },
        { nama: 'Tanpa bahan', bahan: [] },
        { nama: 'Sah', bahan: ['telur'] },
      ],
    }, inventory);

    expect(out.map((r) => r.name)).toEqual(['Sah']);
  });

  it('tidak percaya klaim model soal bahan yang dimiliki', () => {
    // Model bebas mengarang resep; pemilahan ada/kurang tetap ditentukan
    // dengan membandingkan ke inventaris.
    const out = bacaResep({
      resep: [{ nama: 'Klaim palsu', bahan: ['wagyu'], have: ['wagyu'] }],
    }, inventory);

    expect(out[0].have).toEqual([]);
    expect(out[0].missing).toEqual(['wagyu']);
  });

  it('mengembalikan daftar kosong untuk jawaban yang tidak berbentuk', () => {
    expect(bacaResep(null, inventory)).toEqual([]);
    expect(bacaResep({}, inventory)).toEqual([]);
    expect(bacaResep({ resep: 'bukan array' }, inventory)).toEqual([]);
  });

  it('menolak menit dan porsi yang tidak masuk akal', () => {
    const out = bacaResep({
      resep: [{ nama: 'Aneh', bahan: ['telur'], menit: -5, porsi: 0 }],
    }, inventory);

    expect(out[0].minutes).toBeNull();
    expect(out[0].servings).toBeNull();
  });
});

describe('bacaRencana', () => {
  const inventory = [stok('Telur'), stok('Nasi'), stok('Bawang merah')];

  const rencana = {
    rencana: [
      { nama: 'Nasi goreng', bahan: ['nasi', 'telur', 'kecap'] },
      { nama: 'Telur balado', bahan: ['telur', 'bawang merah', 'cabai'] },
      { nama: 'Tumis kangkung', bahan: ['kangkung', 'bawang merah'] },
    ],
  };

  it('memberi tanggal berurutan mulai dari hari pertama', () => {
    const { days } = bacaRencana(rencana, inventory, '2026-09-01');
    expect(days.map((d) => d.date)).toEqual(['2026-09-01', '2026-09-02', '2026-09-03']);
  });

  it('menyatukan bahan kurang jadi satu daftar tanpa pengulangan', () => {
    // Inilah gunanya merencanakan seminggu sekaligus: bawang yang kurang di
    // tiga resep adalah satu baris di daftar belanja, bukan tiga.
    const { shoppingList } = bacaRencana(rencana, inventory, '2026-09-01');
    expect(shoppingList).toEqual(['kecap', 'cabai', 'kangkung']);
  });

  it('memilah tiap hari terhadap stok yang sama', () => {
    const { days } = bacaRencana(rencana, inventory, '2026-09-01');
    expect(days[0].recipe.have.sort()).toEqual(['Nasi', 'Telur']);
    expect(days[0].recipe.missing).toEqual(['kecap']);
  });

  it('membatasi rencana pada tujuh hari', () => {
    const banyak = { rencana: Array.from({ length: 12 }, (_, i) => ({ nama: `Hari ${i}`, bahan: ['telur'] })) };
    expect(bacaRencana(banyak, inventory, '2026-09-01').days).toHaveLength(7);
  });

  it('melewati entri yang tidak bisa dibaca tanpa membuang sisanya', () => {
    const campur = { rencana: [null, { nama: '', bahan: ['telur'] }, { nama: 'Sah', bahan: ['telur'] }] };
    const { days } = bacaRencana(campur, inventory, '2026-09-01');
    expect(days.map((d) => d.recipe.name)).toEqual(['Sah']);
  });

  it('mengembalikan kosong untuk jawaban tak berbentuk', () => {
    for (const raw of [null, {}, { rencana: 'bukan array' }]) {
      expect(bacaRencana(raw, inventory, '2026-09-01')).toEqual({ days: [], shoppingList: [] });
    }
  });

  it('menyeberangi pergantian bulan', () => {
    const { days } = bacaRencana(rencana, inventory, '2026-08-30');
    expect(days.map((d) => d.date)).toEqual(['2026-08-30', '2026-08-31', '2026-09-01']);
  });
});

describe('urutkanStok', () => {
  it('mendahulukan yang paling dekat kedaluwarsa', () => {
    const out = urutkanStok([
      stok('Beras', 1, 'kg', null),
      stok('Bayam', 1, 'ikat', 1),
      stok('Tahu', 1, 'pcs', 5),
    ]);
    expect(out.map((s) => s.name)).toEqual(['Bayam', 'Tahu', 'Beras']);
  });

  it('tidak mengubah daftar aslinya', () => {
    const asli = [stok('Beras', 1, 'kg', 9), stok('Bayam', 1, 'ikat', 1)];
    urutkanStok(asli);
    expect(asli.map((s) => s.name)).toEqual(['Beras', 'Bayam']);
  });
});

describe('ringkasStok', () => {
  it('menandai bahan yang mendesak', () => {
    const teks = ringkasStok([stok('Bayam', 2, 'ikat', 1), stok('Susu', 1, 'liter', -2)]);
    expect(teks).toContain('Susu (1 liter, sudah kedaluwarsa)');
    expect(teks).toContain('Bayam (2 ikat, sisa 1 hari)');
  });

  it('membatasi panjang daftar supaya prompt tidak membengkak', () => {
    const banyak = Array.from({ length: 60 }, (_, i) => stok(`Bahan ${i}`));
    expect(ringkasStok(banyak).split('\n')).toHaveLength(40);
  });
});
