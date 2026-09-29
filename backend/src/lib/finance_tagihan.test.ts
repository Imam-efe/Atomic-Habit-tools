/**
 * Uji kemunculan tagihan dan proyeksi saldo.
 *
 * Semua yang dijaga di sini adalah kesalahan yang tetap mengembalikan angka:
 *
 * 1. Kemunculan bulanan yang meleset sehari di akhir bulan. Tagihan tanggal 31
 *    tidak boleh melompat ke tanggal 3 bulan berikutnya.
 * 2. Kemunculan terakhir yang terlewat tepat di ujung horizon.
 * 3. Arah tanda utang versus piutang. Tabel `debts` menyimpan dua hal
 *    berlawanan di baris yang bentuknya sama, dan modul ini punya riwayat
 *    kesalahan arah uang.
 * 4. `tanggalMinus` yang tertutup oleh saldo akhir yang positif. Minus seminggu
 *    di tengah horizon itulah masalahnya, bukan angka di ujungnya.
 * 5. Urutan dalam satu hari. Saldo yang dihitung dengan uang masuk lebih dulu
 *    akan menjanjikan dana cukup untuk pendebetan yang bisa datang lebih awal.
 */

import { describe, it, expect } from 'vitest';
import {
  kemunculan,
  kemunculanBerulang,
  bulanKe,
  proyeksikanSaldo,
  barisDariTagihan,
  barisDariBerulang,
  barisDariHutang,
  type BarisProyeksi,
} from './finance_tagihan';
import { advanceDate } from './validate';

describe('kemunculan', () => {
  it('tagihan sekali hanya muncul sekali', () => {
    expect(kemunculan('2026-10-05', null, '2026-12-31')).toEqual(['2026-10-05']);
  });

  it('tagihan sekali yang di luar horizon tidak muncul', () => {
    expect(kemunculan('2027-01-05', null, '2026-12-31')).toEqual([]);
  });

  it('menjepit akhir bulan, lalu KEMBALI ke tanggal asalnya', () => {
    // Dua hal sekaligus. Tanpa penjepitan, 31 Januari + 1 bulan jadi 3 Maret
    // dan tagihan Februari hilang dari proyeksi. Tapi menjepit saja tidak
    // cukup: kalau bulan berikutnya dihitung dari tanggal yang sudah dijepit,
    // tagihannya hanyut ke tanggal 28 SELAMANYA. Hari asalnya yang jadi acuan
    // tiap bulan, jadi Maret kembali ke 31.
    expect(kemunculan('2026-01-31', 'monthly', '2026-05-31')).toEqual([
      '2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31',
    ]);
  });

  it('tanggal 30 kembali ke 30 setelah Februari', () => {
    expect(kemunculan('2026-01-30', 'monthly', '2026-04-30')).toEqual([
      '2026-01-30', '2026-02-28', '2026-03-30', '2026-04-30',
    ]);
  });

  it('hari asal bisa diberikan terpisah, untuk tagihan yang sudah maju', () => {
    // Setelah dibayar, `jatuh_tempo` tersimpan sebagai tanggal yang mungkin
    // sudah terjepit. Anchornya dibawa terpisah supaya hari asalnya tidak
    // hilang dari perhitungan.
    expect(kemunculan('2026-02-28', 'monthly', '2026-04-30', 31)).toEqual([
      '2026-02-28', '2026-03-31', '2026-04-30',
    ]);
  });

  it('menjepit ke 29 Februari pada tahun kabisat', () => {
    expect(kemunculan('2028-01-31', 'monthly', '2028-02-29')).toEqual([
      '2028-01-31', '2028-02-29',
    ]);
  });

  it('melewati ganti tahun dengan anchor tetap utuh', () => {
    expect(kemunculan('2026-12-31', 'monthly', '2027-03-31')).toEqual([
      '2026-12-31', '2027-01-31', '2027-02-28', '2027-03-31',
    ]);
  });

  it('menyertakan kemunculan yang jatuh tepat di ujung horizon', () => {
    // Batas inklusif. Kalau eksklusif, tagihan hari terakhir hilang dan
    // proyeksinya terlihat lebih aman daripada kenyataan.
    expect(kemunculan('2026-10-01', 'monthly', '2026-12-01')).toContain('2026-12-01');
  });

  it('melewati ganti tahun', () => {
    expect(kemunculan('2026-11-15', 'monthly', '2027-02-15')).toEqual([
      '2026-11-15', '2026-12-15', '2027-01-15', '2027-02-15',
    ]);
  });

  it('mingguan berjalan tiap tujuh hari', () => {
    expect(kemunculan('2026-10-01', 'weekly', '2026-10-22')).toEqual([
      '2026-10-01', '2026-10-08', '2026-10-15', '2026-10-22',
    ]);
  });

  it('harian mengisi tiap hari, ujungnya ikut', () => {
    expect(kemunculan('2026-10-01', 'daily', '2026-10-04')).toEqual([
      '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04',
    ]);
  });

  it('tetap memunculkan yang sudah telat', () => {
    // Tagihan yang jatuh tempo minggu lalu dan belum dibayar masih harus
    // dibayar; menyembunyikannya memproyeksikan saldo lebih besar dari nyata.
    expect(kemunculan('2026-09-01', 'monthly', '2026-10-15')).toEqual([
      '2026-09-01', '2026-10-01',
    ]);
  });

  it('tidak berputar selamanya pada horizon yang jauh', () => {
    const hasil = kemunculan('1970-01-01', 'daily', '2030-01-01');
    // Dibatasi, bukan menggantung permintaannya sampai habis waktu.
    expect(hasil.length).toBeLessThanOrEqual(500);
    expect(hasil.length).toBeGreaterThan(0);
  });
});

describe('kemunculanBerulang', () => {
  it('meniru persis apa yang dilakukan mesin transaksi berulang', () => {
    // Penjaga terpenting untuk proyeksi autodebet. `processRecurringBudget`
    // memanggil `advanceDate` atas tanggal SEBELUMNYA, jadi ia hanyut di akhir
    // bulan. Proyeksi yang memakai versi ber-anchor akan memperkirakan tanggal
    // yang tidak pernah terjadi. Kalau kelak mesinnya diperbaiki, uji inilah
    // yang gagal dan mengingatkan bahwa proyeksinya harus ikut berubah.
    let tanggal = '2026-01-31';
    const dariMesin = [tanggal];
    for (let i = 0; i < 4; i++) {
      tanggal = advanceDate(tanggal, 'monthly');
      dariMesin.push(tanggal);
    }

    expect(kemunculanBerulang('2026-01-31', 'monthly', dariMesin[dariMesin.length - 1]))
      .toEqual(dariMesin);
  });

  it('hanyut di akhir bulan, berbeda dari tagihan', () => {
    // Perbedaan yang disengaja, ditulis terang-terangan supaya tidak ada yang
    // "merapikannya" jadi sama.
    const berulang = kemunculanBerulang('2026-01-31', 'monthly', '2026-04-30');
    const tagihan = kemunculan('2026-01-31', 'monthly', '2026-04-30');
    expect(berulang).toEqual(['2026-01-31', '2026-02-28', '2026-03-28', '2026-04-28']);
    expect(tagihan).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
  });
});

describe('bulanKe', () => {
  it('menjepit ke hari terakhir bulan yang lebih pendek', () => {
    expect(bulanKe('2026-01-31', 1, 31)).toBe('2026-02-28');
    expect(bulanKe('2026-01-31', 3, 31)).toBe('2026-04-30');
  });

  it('melewati batas tahun ke depan maupun ke belakang', () => {
    expect(bulanKe('2026-11-15', 3, 15)).toBe('2027-02-15');
    expect(bulanKe('2026-02-15', -3, 15)).toBe('2025-11-15');
  });

  it('langkah nol mengembalikan bulannya sendiri pada hari anchor', () => {
    expect(bulanKe('2026-02-28', 0, 31)).toBe('2026-02-28');
  });
});

describe('arah tanda', () => {
  it('tagihan keluar bertanda negatif, tagihan masuk positif', () => {
    const keluar = barisDariTagihan(
      { id: 't1', nama: 'Listrik', jumlah_idr: 300_000, jatuh_tempo: '2026-10-05', ulang: null, jenis: 'expense' },
      '2026-10-31'
    );
    const masuk = barisDariTagihan(
      { id: 't2', nama: 'Gaji', jumlah_idr: 5_000_000, jatuh_tempo: '2026-10-25', ulang: null, jenis: 'income' },
      '2026-10-31'
    );
    expect(keluar[0].jumlah).toBe(-300_000);
    expect(masuk[0].jumlah).toBe(5_000_000);
  });

  it('jumlah negatif di basis data tidak membalik arahnya', () => {
    // Tandanya ditentukan `jenis`, bukan tanda angkanya. Baris dengan jumlah
    // negatif tidak boleh diam-diam berubah jadi pemasukan.
    const baris = barisDariTagihan(
      { id: 't1', nama: 'Listrik', jumlah_idr: -300_000, jatuh_tempo: '2026-10-05', ulang: null, jenis: 'expense' },
      '2026-10-31'
    );
    expect(baris[0].jumlah).toBe(-300_000);
  });

  it('utang mengurangi, piutang menambah', () => {
    const utang = barisDariHutang({
      id: 'd1', type: 'debt', person_name: 'Pak Budi', amount_idr: 500_000, due_date: '2026-10-10',
    });
    const piutang = barisDariHutang({
      id: 'd2', type: 'receivable', person_name: 'Bu Sri', amount_idr: 200_000, due_date: '2026-10-12',
    });
    expect(utang[0].jumlah).toBe(-500_000);
    expect(utang[0].sumber).toBe('hutang');
    expect(piutang[0].jumlah).toBe(200_000);
    expect(piutang[0].sumber).toBe('piutang');
  });

  it('transaksi berulang ikut terproyeksi dengan tandanya', () => {
    const baris = barisDariBerulang(
      {
        id: 'b1', type: 'expense', amount_idr: 150_000, category: 'Tagihan & Utilitas',
        note: 'Internet', recurrence: 'monthly', next_recurrence_date: '2026-10-03',
      },
      '2026-12-03'
    );
    expect(baris).toHaveLength(3);
    expect(baris.every((b) => b.jumlah === -150_000)).toBe(true);
    expect(baris[0].label).toBe('Internet');
    expect(baris[0].sumber).toBe('berulang');
  });

  it('proyeksi autodebet akhir bulan memakai tanggal yang mesinnya benar-benar pakai', () => {
    // Uji ini memeriksa `barisDariBerulang`, bukan fungsi dalamnya — versi
    // sebelumnya lolos meski fungsinya ditukar, karena tanggal ujinya (tanggal
    // 3) tidak pernah perlu dijepit sehingga kedua versi kebetulan sama.
    //
    // Autodebet tanggal 31 dihitung mesinnya secara hanyut: 31 Jan, 28 Feb,
    // lalu 28 Mar. Proyeksi yang memakai aturan tagihan akan menjanjikan
    // pendebetan 31 Maret — tanggal yang tidak akan pernah terjadi.
    const baris = barisDariBerulang(
      {
        id: 'b1', type: 'expense', amount_idr: 100_000, category: 'Cicilan & Utang',
        note: 'Cicilan', recurrence: 'monthly', next_recurrence_date: '2026-01-31',
      },
      '2026-04-30'
    );

    expect(baris.map((b) => b.tanggal)).toEqual([
      '2026-01-31', '2026-02-28', '2026-03-28', '2026-04-28',
    ]);
  });

  it('proyeksi tagihan akhir bulan kembali ke tanggal asalnya', () => {
    // Pasangan uji di atas, arah sebaliknya: tagihan manual TIDAK hanyut.
    const baris = barisDariTagihan(
      {
        id: 't1', nama: 'Listrik', jumlah_idr: 100_000, jatuh_tempo: '2026-01-31',
        ulang: 'monthly', jenis: 'expense',
      },
      '2026-04-30'
    );

    expect(baris.map((b) => b.tanggal)).toEqual([
      '2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30',
    ]);
  });

  it('tagihan yang sudah maju memakai hari anchor tersimpan', () => {
    const baris = barisDariTagihan(
      {
        id: 't1', nama: 'Listrik', jumlah_idr: 100_000, jatuh_tempo: '2026-02-28',
        ulang: 'monthly', jenis: 'expense', hari_anchor: 31,
      },
      '2026-04-30'
    );

    expect(baris.map((b) => b.tanggal)).toEqual(['2026-02-28', '2026-03-31', '2026-04-30']);
  });

  it('transaksi berulang tanpa catatan memakai kategorinya sebagai label', () => {
    const baris = barisDariBerulang(
      {
        id: 'b1', type: 'expense', amount_idr: 50_000, category: 'Bensin',
        note: null, recurrence: 'weekly', next_recurrence_date: '2026-10-01',
      },
      '2026-10-08'
    );
    expect(baris[0].label).toBe('Bensin');
  });
});

describe('proyeksikanSaldo', () => {
  const baris = (tanggal: string, jumlah: number, label = 'x'): BarisProyeksi => ({
    tanggal, jumlah, label, sumber: 'tagihan',
  });

  it('menjalankan saldo melewati tiap pergerakan', () => {
    const p = proyeksikanSaldo(1_000_000, [
      baris('2026-10-05', -300_000),
      baris('2026-10-25', 5_000_000),
    ], '2026-10-01', '2026-10-31');

    expect(p.titik).toEqual([
      { tanggal: '2026-10-05', saldo: 700_000 },
      { tanggal: '2026-10-25', saldo: 5_700_000 },
    ]);
    expect(p.saldoAkhir).toBe(5_700_000);
    expect(p.totalKeluar).toBe(300_000);
    expect(p.totalMasuk).toBe(5_000_000);
  });

  it('menemukan hari minus meski saldo akhirnya positif', () => {
    // Inti dari fitur ini. Saldo akhir 4,7 juta menyembunyikan seminggu minus
    // di tengah — dan tagihan yang ditolak karena dana kurang tidak peduli
    // bahwa gaji datang tiga hari kemudian.
    const p = proyeksikanSaldo(200_000, [
      baris('2026-10-05', -500_000, 'Listrik'),
      baris('2026-10-25', 5_000_000, 'Gaji'),
    ], '2026-10-01', '2026-10-31');

    expect(p.tanggalMinus).toBe('2026-10-05');
    expect(p.saldoAkhir).toBe(4_700_000);
  });

  it('tidak melaporkan hari minus saat saldonya selalu cukup', () => {
    const p = proyeksikanSaldo(1_000_000, [baris('2026-10-05', -300_000)], '2026-10-01', '2026-10-31');
    expect(p.tanggalMinus).toBeNull();
  });

  it('melaporkan hari minus PERTAMA, bukan yang terakhir', () => {
    const p = proyeksikanSaldo(100_000, [
      baris('2026-10-05', -200_000),
      baris('2026-10-06', -200_000),
    ], '2026-10-01', '2026-10-31');
    expect(p.tanggalMinus).toBe('2026-10-05');
  });

  it('menghitung uang keluar lebih dulu dalam satu hari', () => {
    // Saldo 100rb, tagihan 300rb dan gaji 500rb pada hari yang sama. Dihitung
    // masuk-dulu, harinya terlihat aman; dihitung keluar-dulu, terlihat minus.
    // Yang kedua yang jujur: pendebetan bisa datang sebelum transfernya masuk.
    const p = proyeksikanSaldo(100_000, [
      baris('2026-10-05', 500_000, 'Gaji'),
      baris('2026-10-05', -300_000, 'Listrik'),
    ], '2026-10-01', '2026-10-31');

    expect(p.tanggalMinus).toBe('2026-10-05');
    expect(p.saldoAkhir).toBe(300_000);
  });

  it('meringkas beberapa pergerakan sehari jadi satu titik', () => {
    const p = proyeksikanSaldo(1_000_000, [
      baris('2026-10-05', -100_000),
      baris('2026-10-05', -200_000),
    ], '2026-10-01', '2026-10-31');

    expect(p.titik).toEqual([{ tanggal: '2026-10-05', saldo: 700_000 }]);
  });

  it('mengabaikan pergerakan di luar horizon', () => {
    const p = proyeksikanSaldo(1_000_000, [
      baris('2026-10-05', -100_000),
      baris('2026-11-30', -900_000),
    ], '2026-10-01', '2026-10-31');

    expect(p.saldoAkhir).toBe(900_000);
    expect(p.baris).toHaveLength(1);
  });

  it('menjepit yang sudah telat ke hari ini, tidak membuangnya', () => {
    const p = proyeksikanSaldo(1_000_000, [
      baris('2026-09-01', -400_000, 'Listrik telat'),
    ], '2026-10-01', '2026-10-31');

    // Uangnya masih terutang, jadi tetap dihitung — tapi tanggalnya bisa
    // ditindaklanjuti, bukan menunjuk masa lalu.
    expect(p.saldoAkhir).toBe(600_000);
    expect(p.baris[0].tanggal).toBe('2026-10-01');
  });

  it('hari minus dari tagihan telat menunjuk hari ini, bukan tanggal lamanya', () => {
    const p = proyeksikanSaldo(100_000, [
      baris('2026-08-15', -400_000, 'Telat jauh'),
    ], '2026-10-01', '2026-10-31');

    expect(p.tanggalMinus).toBe('2026-10-01');
  });

  it('horizon kosong menghasilkan proyeksi yang tetap terbaca', () => {
    const p = proyeksikanSaldo(1_000_000, [], '2026-10-01', '2026-10-31');
    expect(p.titik).toEqual([]);
    expect(p.saldoAkhir).toBe(1_000_000);
    expect(p.tanggalMinus).toBeNull();
    expect(p.totalKeluar).toBe(0);
  });

  it('saldo awal yang sudah minus langsung dilaporkan pada pergerakan pertama', () => {
    const p = proyeksikanSaldo(-50_000, [baris('2026-10-05', -10_000)], '2026-10-01', '2026-10-31');
    expect(p.tanggalMinus).toBe('2026-10-05');
  });
});
