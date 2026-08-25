import { describe, it, expect } from 'vitest';
import {
  hartaBersih, nisabRupiah, hitungZakatMaal, hitungZakatPenghasilan, statusHaul,
  NISAB_GRAM_EMAS, NISAB_GRAM_PERAK, KADAR_ZAKAT, HAUL_HARI,
} from './zakat';

const harta = (over: Partial<Parameters<typeof hartaBersih>[0]> = {}) => ({
  kas: 0, logamMulia: 0, investasi: 0, utangJatuhTempo: 0, ...over,
});

/** Harga emas contoh: Rp1.500.000/gram → nisab Rp127.500.000. */
const HARGA_EMAS = 1_500_000;

describe('hartaBersih', () => {
  it('menjumlahkan kas, logam mulia, dan investasi', () => {
    expect(hartaBersih(harta({ kas: 50e6, logamMulia: 30e6, investasi: 20e6 }))).toBe(100e6);
  });

  it('mengurangi utang jatuh tempo', () => {
    expect(hartaBersih(harta({ kas: 100e6, utangJatuhTempo: 30e6 }))).toBe(70e6);
  });

  it('tidak pernah negatif walau utangnya lebih besar', () => {
    expect(hartaBersih(harta({ kas: 10e6, utangJatuhTempo: 50e6 }))).toBe(0);
  });

  it('mengabaikan angka negatif yang salah masuk', () => {
    expect(hartaBersih(harta({ kas: -5e6, logamMulia: 20e6 }))).toBe(20e6);
  });
});

describe('nisabRupiah', () => {
  it('memakai 85 gram untuk emas', () => {
    expect(nisabRupiah(HARGA_EMAS, 'emas')).toBe(HARGA_EMAS * NISAB_GRAM_EMAS);
  });

  it('memakai 595 gram untuk perak', () => {
    // Nisab perak jauh lebih rendah nilainya — itu sebabnya sebagian pendapat
    // memakainya, dan itu keputusan pengguna, bukan aplikasi.
    expect(nisabRupiah(20_000, 'perak')).toBe(20_000 * NISAB_GRAM_PERAK);
  });

  it('nol untuk harga yang belum diisi', () => {
    expect(nisabRupiah(0, 'emas')).toBe(0);
  });
});

describe('hitungZakatMaal', () => {
  it('menghitung 2,5% saat harta melewati nisab', () => {
    const hasil = hitungZakatMaal(harta({ kas: 200e6 }), HARGA_EMAS);
    expect(hasil.wajib).toBe(true);
    expect(hasil.zakat).toBe(Math.ceil(200e6 * KADAR_ZAKAT));
  });

  it('tidak wajib saat harta di bawah nisab, dan menyebut kurangnya berapa', () => {
    const hasil = hitungZakatMaal(harta({ kas: 100e6 }), HARGA_EMAS);
    expect(hasil.wajib).toBe(false);
    expect(hasil.zakat).toBe(0);
    expect(hasil.kurang).toBe(127_500_000 - 100e6);
  });

  it('wajib tepat saat harta sama dengan nisab', () => {
    const hasil = hitungZakatMaal(harta({ kas: 127_500_000 }), HARGA_EMAS);
    expect(hasil.wajib).toBe(true);
    expect(hasil.kurang).toBe(0);
  });

  it('membulatkan ke atas, bukan ke bawah', () => {
    // Membulatkan ke bawah berarti membayar kurang dari yang terhitung.
    const hasil = hitungZakatMaal(harta({ kas: 130_000_001 }), HARGA_EMAS);
    expect(hasil.zakat).toBe(Math.ceil(130_000_001 * KADAR_ZAKAT));
  });

  it('memperhitungkan utang sebelum membandingkan dengan nisab', () => {
    // Harta kotor lewat nisab, tapi setelah utang tidak.
    const hasil = hitungZakatMaal(harta({ kas: 130e6, utangJatuhTempo: 10e6 }), HARGA_EMAS);
    expect(hasil.hartaBersih).toBe(120e6);
    expect(hasil.wajib).toBe(false);
  });

  it('tidak mewajibkan apa pun saat harga logam belum diisi', () => {
    // Nisab nol akan membuat semua orang wajib zakat — kesalahan yang harus
    // dijaga, bukan dibiarkan lewat.
    const hasil = hitungZakatMaal(harta({ kas: 1000 }), 0);
    expect(hasil.wajib).toBe(false);
    expect(hasil.kurang).toBe(0);
  });
});

describe('hitungZakatPenghasilan', () => {
  it('membandingkan dengan nisab bulanan, bukan tahunan', () => {
    // Nisab tahunan Rp127,5 juta; bulanannya Rp10,625 juta.
    const hasil = hitungZakatPenghasilan(11e6, HARGA_EMAS);
    expect(hasil.nisabBulanan).toBe(Math.ceil(127_500_000 / 12));
    expect(hasil.wajib).toBe(true);
    expect(hasil.zakat).toBe(Math.ceil(11e6 * KADAR_ZAKAT));
  });

  it('tidak wajib untuk penghasilan di bawah nisab bulanan', () => {
    const hasil = hitungZakatPenghasilan(8e6, HARGA_EMAS);
    expect(hasil.wajib).toBe(false);
    expect(hasil.zakat).toBe(0);
  });

  it('menghitung dari penghasilan bersih kalau pengurang diisi', () => {
    // Dua pendapat sama-sama dipakai luas; pilihannya milik pengguna.
    const hasil = hitungZakatPenghasilan(15e6, HARGA_EMAS, 6e6);
    expect(hasil.dasar).toBe(9e6);
    expect(hasil.wajib).toBe(false);
  });

  it('tidak membuat dasar negatif saat pengurang melebihi penghasilan', () => {
    expect(hitungZakatPenghasilan(5e6, HARGA_EMAS, 9e6).dasar).toBe(0);
  });
});

describe('statusHaul', () => {
  it('memakai tahun Hijriah, bukan Masehi', () => {
    // 365 hari menggeser jatuh tempo sebelas hari tiap tahun, dan setelah
    // beberapa tahun zakatnya jatuh di bulan yang berbeda dari yang dimaksud.
    expect(HAUL_HARI).toBe(354);
    const s = statusHaul('2026-01-01', '2026-01-01');
    expect(s.jatuhTempo).toBe('2026-12-21');
  });

  it('menghitung sisa hari sampai haul genap', () => {
    const s = statusHaul('2026-01-01', '2026-06-01');
    expect(s.sisaHari).toBe(354 - 151);
    expect(s.sudahLewat).toBe(false);
  });

  it('menandai hari jatuh tempo', () => {
    const s = statusHaul('2026-01-01', '2026-12-21');
    expect(s.jatuhTempoHariIni).toBe(true);
    expect(s.sisaHari).toBe(0);
  });

  it('menandai haul yang sudah lewat', () => {
    const s = statusHaul('2026-01-01', '2027-01-01');
    expect(s.sudahLewat).toBe(true);
    expect(s.sisaHari).toBeLessThan(0);
  });

  it('menyeberangi pergantian tahun dengan benar', () => {
    expect(statusHaul('2026-08-25', '2026-08-25').jatuhTempo).toBe('2027-08-14');
  });
});
