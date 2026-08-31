import { describe, it, expect } from 'vitest';
import {
  speciesKey, bersihkanKode, kodeBerikutnya, ringkasKode, rencanaUbahKode,
  MAX_CODE_LEN,
} from './garden_unit';

describe('speciesKey', () => {
  it('memakai plant_id kalau tanamannya ada di katalog', () => {
    expect(speciesKey('cabai-rawit', null)).toBe('cabai-rawit');
  });

  it('memakai nama yang dinormalkan kalau di luar katalog', () => {
    expect(speciesKey(null, '  Cabai Gendot  ')).toBe('nama:cabai gendot');
  });

  it('nama beda huruf besar-kecil tetap satu deret', () => {
    expect(speciesKey(null, 'Cabai')).toBe(speciesKey(null, 'CABAI'));
  });

  it('nama kustom tidak pernah bentrok dengan slug katalog', () => {
    // Tanpa awalan, tanaman kustom bernama "tomat" akan ikut ke deret slug
    // `tomat` dan nomornya bercampur dengan tomat katalog.
    expect(speciesKey(null, 'tomat')).not.toBe(speciesKey('tomat', null));
  });

  it('tanpa keduanya tetap menghasilkan kunci, bukan string kosong', () => {
    // Kunci kosong akan menyatukan semua tanaman tak bernama jadi satu deret.
    expect(speciesKey(null, null)).toBe('nama:tanaman');
    expect(speciesKey('', '   ')).toBe('nama:tanaman');
  });
});

describe('bersihkanKode', () => {
  it('menerima angka dan teks pendek', () => {
    expect(bersihkanKode('3')).toBe('3');
    expect(bersihkanKode(3)).toBe('3');
    expect(bersihkanKode('A1')).toBe('A1');
  });

  it('merapikan spasi', () => {
    expect(bersihkanKode('  B2  ')).toBe('B2');
  });

  it('menolak yang kosong', () => {
    expect(bersihkanKode('')).toBeNull();
    expect(bersihkanKode('   ')).toBeNull();
    expect(bersihkanKode(null)).toBeNull();
    expect(bersihkanKode(undefined)).toBeNull();
  });

  it('menolak yang terlalu panjang untuk muat di label', () => {
    expect(bersihkanKode('A'.repeat(MAX_CODE_LEN))).toBe('A'.repeat(MAX_CODE_LEN));
    expect(bersihkanKode('A'.repeat(MAX_CODE_LEN + 1))).toBeNull();
  });

  it('menolak karakter yang tidak terbaca di label cetak', () => {
    // Font helvetica bawaan jsPDF hanya mengerti Latin-1; emoji tercetak
    // sebagai karakter acak dan lebarnya salah dihitung.
    expect(bersihkanKode('🌶')).toBeNull();
    expect(bersihkanKode('A/B')).toBeNull();
    expect(bersihkanKode('A B')).toBeNull();
    expect(bersihkanKode('A-1')).toBe('A-1');
  });
});

describe('kodeBerikutnya', () => {
  it('mulai dari 1 kalau belum ada apa-apa', () => {
    expect(kodeBerikutnya([])).toBe('1');
  });

  it('melanjutkan dari angka tertinggi', () => {
    expect(kodeBerikutnya(['1', '2', '3'])).toBe('4');
  });

  it('tidak memakai ulang nomor yang bolong', () => {
    // #2 sudah pensiun tapi labelnya bisa saja masih ada di gudang. Nomor
    // otomatis tidak boleh menabraknya.
    expect(kodeBerikutnya(['1', '3'])).toBe('4');
  });

  it('mengabaikan kode non-angka saat mencari yang tertinggi', () => {
    expect(kodeBerikutnya(['1', 'A1', '2'])).toBe('3');
  });

  it('kode non-angka saja tetap menghasilkan angka', () => {
    expect(kodeBerikutnya(['A1', 'B2'])).toBe('1');
  });
});

describe('ringkasKode', () => {
  it('satu pot tampil apa adanya', () => {
    expect(ringkasKode([{ unitNo: 1, code: '3', retired: false }])).toBe('#3');
  });

  it('deret rapat dipendekkan jadi rentang', () => {
    expect(ringkasKode([
      { unitNo: 1, code: '1', retired: false },
      { unitNo: 2, code: '2', retired: false },
      { unitNo: 3, code: '3', retired: false },
    ])).toBe('#1–#3');
  });

  it('deret berlubang disebut satu per satu, bukan dipaksa jadi rentang', () => {
    // '#1–#7' untuk pot yang sebenarnya cuma tiga adalah kebohongan yang baru
    // ketahuan saat pengguna berdiri di kebun menghitung pot.
    expect(ringkasKode([
      { unitNo: 1, code: '1', retired: false },
      { unitNo: 2, code: '3', retired: false },
      { unitNo: 3, code: '7', retired: false },
    ])).toBe('#1, #3, #7');
  });

  it('pot pensiun tidak ikut diringkas', () => {
    expect(ringkasKode([
      { unitNo: 1, code: '1', retired: false },
      { unitNo: 2, code: '2', retired: true },
      { unitNo: 3, code: '3', retired: false },
    ])).toBe('#1, #3');
  });

  it('kode non-angka tidak pernah dijadikan rentang', () => {
    expect(ringkasKode([
      { unitNo: 1, code: 'A1', retired: false },
      { unitNo: 2, code: 'A2', retired: false },
    ])).toBe('#A1, #A2');
  });

  it('daftar panjang dipotong dengan keterangan jumlah', () => {
    const banyak = Array.from({ length: 9 }, (_, i) => ({
      unitNo: i + 1, code: String((i + 1) * 2), retired: false,
    }));
    expect(ringkasKode(banyak)).toBe('9 pot');
  });

  it('semua pensiun menghasilkan keterangan, bukan string kosong', () => {
    expect(ringkasKode([{ unitNo: 1, code: '1', retired: true }])).toBe('tidak ada pot aktif');
  });

  it('daftar kosong tidak melempar galat', () => {
    expect(ringkasKode([])).toBe('tidak ada pot aktif');
  });
});

describe('rencanaUbahKode', () => {
  const sendiri = { plantingId: 'p1', unitNo: 2 };

  it('kode yang belum dipakai boleh langsung', () => {
    expect(rencanaUbahKode('9', sendiri, [
      { plantingId: 'p1', unitNo: 1, code: '1', retired: false },
    ])).toEqual({ jenis: 'bebas' });
  });

  it('kode milik unit aktif lain ditawarkan sebagai tukar', () => {
    // Dua label tertukar tempel di pot yang salah — menukar nomornya jauh
    // lebih masuk akal daripada memaksa mencetak ulang keduanya.
    expect(rencanaUbahKode('1', sendiri, [
      { plantingId: 'p1', unitNo: 1, code: '1', retired: false },
    ])).toEqual({ jenis: 'tukar', denganUnitNo: 1, denganPlantingId: 'p1' });
  });

  it('tukar juga berlaku lintas catatan tanaman', () => {
    expect(rencanaUbahKode('5', sendiri, [
      { plantingId: 'p9', unitNo: 1, code: '5', retired: false },
    ])).toEqual({ jenis: 'tukar', denganUnitNo: 1, denganPlantingId: 'p9' });
  });

  it('kode milik unit yang sudah pensiun boleh dipakai ulang', () => {
    // Justru kasus yang diminta: pot lama mati, labelnya masih bagus,
    // dipasang ke pot baru.
    expect(rencanaUbahKode('4', sendiri, [
      { plantingId: 'p1', unitNo: 1, code: '4', retired: true },
    ])).toEqual({ jenis: 'bebas' });
  });

  it('mengubah ke kode sendiri bukan tukar, melainkan tidak berubah', () => {
    expect(rencanaUbahKode('2', sendiri, [
      { plantingId: 'p1', unitNo: 2, code: '2', retired: false },
    ])).toEqual({ jenis: 'bebas' });
  });

  it('kode tidak sah ditolak dengan alasan yang bisa dibaca', () => {
    const hasil = rencanaUbahKode('', sendiri, []);
    expect(hasil.jenis).toBe('ditolak');
    if (hasil.jenis === 'ditolak') expect(hasil.alasan.length).toBeGreaterThan(20);
  });

  it('kode kepanjangan ditolak, bukan dipotong diam-diam', () => {
    // Memotong akan menghasilkan kode yang bukan yang diketik pengguna, dan
    // bisa menabrak kode lain tanpa mereka sadari.
    expect(rencanaUbahKode('A'.repeat(MAX_CODE_LEN + 1), sendiri, []).jenis).toBe('ditolak');
  });
});
