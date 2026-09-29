/**
 * Uji periode pelaporan yang bisa diatur.
 *
 * Yang dijaga di sini semuanya kesalahan yang mengembalikan tanggal yang tampak
 * wajar, jadi tidak satu pun akan muncul sebagai galat:
 *
 * 1. `hariMulai = 1` HARUS runtuh tepat jadi bulan kalender. Kalau menyimpang
 *    satu hari saja, seluruh pengguna yang tidak pernah menyentuh pengaturan
 *    ini akan melihat angka laporannya berubah setelah deploy — dan
 *    `budget_limits.month` yang sudah ada di produksi akan menunjuk periode
 *    yang salah.
 * 2. Tidak boleh ada celah atau tumpang tindih antar periode berurutan. Satu
 *    hari yang jatuh di dua periode dihitung dua kali; satu hari yang tidak
 *    masuk periode mana pun hilang dari semua laporan.
 * 3. Label harus bulan tempat periode BERAKHIR, konsisten di kedua arah
 *    (`periodeUntuk` dan `periodeDariLabel`).
 * 4. Februari, tahun kabisat, dan ganti tahun.
 */

import { describe, it, expect } from 'vitest';
import {
  periodeUntuk,
  periodeDariLabel,
  geserPeriode,
  labelPeriodeBerjalan,
  sisaHariPeriode,
  bersihkanHariMulai,
  HARI_MULAI_MAX,
} from './finance_periode';

/** Hari terakhir bulan kalender, dihitung terpisah dari kode yang diuji. */
function hariTerakhir(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${ym}-${String(d).padStart(2, '0')}`;
}

describe('hariMulai = 1 runtuh jadi bulan kalender', () => {
  it('sama persis dengan rumus lama sepanjang dua tahun', () => {
    // Penjaga terpenting di seluruh berkas ini. Rumus lama di delapan tempat
    // adalah `${month}-01` sampai hari terakhir bulan itu; kalau periode baru
    // tidak identik pada hariMulai = 1, angka setiap pengguna lama berubah.
    for (let tahun = 2026; tahun <= 2027; tahun++) {
      for (let bulan = 1; bulan <= 12; bulan++) {
        const ym = `${tahun}-${String(bulan).padStart(2, '0')}`;
        for (const hari of ['01', '15', hariTerakhir(ym).slice(-2)]) {
          const p = periodeUntuk(`${ym}-${hari}`, 1);
          expect(p.mulai, `${ym}-${hari}`).toBe(`${ym}-01`);
          expect(p.selesai, `${ym}-${hari}`).toBe(hariTerakhir(ym));
          expect(p.label, `${ym}-${hari}`).toBe(ym);
        }
      }
    }
  });

  it('Februari tahun kabisat berakhir tanggal 29', () => {
    expect(periodeUntuk('2028-02-10', 1).selesai).toBe('2028-02-29');
  });

  it('Februari tahun biasa berakhir tanggal 28', () => {
    expect(periodeUntuk('2026-02-10', 1).selesai).toBe('2026-02-28');
  });
});

describe('periode dengan cut-off tanggal 25', () => {
  it('tanggal 25 memulai periode yang berakhir 24 bulan depan', () => {
    const p = periodeUntuk('2026-09-25', 25);
    expect(p.mulai).toBe('2026-09-25');
    expect(p.selesai).toBe('2026-10-24');
    // Disebut Oktober, sesuai cara orang menyebutnya: "gajian Oktober".
    expect(p.label).toBe('2026-10');
  });

  it('tanggal 24 masih di periode yang dimulai bulan lalu', () => {
    const p = periodeUntuk('2026-09-24', 25);
    expect(p.mulai).toBe('2026-08-25');
    expect(p.selesai).toBe('2026-09-24');
    expect(p.label).toBe('2026-09');
  });

  it('tanggal di tengah periode tidak menggeser batasnya', () => {
    for (const hari of ['2026-09-25', '2026-10-01', '2026-10-15', '2026-10-24']) {
      const p = periodeUntuk(hari, 25);
      expect(p.mulai, hari).toBe('2026-09-25');
      expect(p.selesai, hari).toBe('2026-10-24');
    }
  });

  it('melewati ganti tahun', () => {
    const p = periodeUntuk('2026-12-28', 25);
    expect(p.mulai).toBe('2026-12-25');
    expect(p.selesai).toBe('2027-01-24');
    expect(p.label).toBe('2027-01');
  });

  it('periode yang melewati Februari tetap berakhir tanggal 24', () => {
    const p = periodeUntuk('2026-02-01', 25);
    expect(p.mulai).toBe('2026-01-25');
    expect(p.selesai).toBe('2026-02-24');
  });
});

describe('tidak ada celah maupun tumpang tindih', () => {
  it('periode berurutan bersambung tepat, untuk setiap hari mulai', () => {
    // Satu hari yang jatuh di dua periode dihitung dua kali; satu hari yang
    // tidak masuk periode mana pun hilang dari semua laporan. Keduanya tidak
    // memunculkan galat apa pun.
    for (const hariMulai of [1, 2, 15, 25, 28]) {
      let p = periodeUntuk('2026-01-10', hariMulai);
      for (let i = 0; i < 26; i++) {
        const berikut = geserPeriode(p, 1);
        const setelahSelesai = new Date(`${p.selesai}T00:00:00Z`);
        setelahSelesai.setUTCDate(setelahSelesai.getUTCDate() + 1);
        expect(berikut.mulai, `hariMulai ${hariMulai}, putaran ${i}`)
          .toBe(setelahSelesai.toISOString().slice(0, 10));
        p = berikut;
      }
    }
  });

  it('setiap hari dalam dua tahun jatuh di dalam periodenya sendiri', () => {
    for (const hariMulai of [1, 25, 28]) {
      let tanggal = '2026-01-01';
      for (let i = 0; i < 730; i++) {
        const p = periodeUntuk(tanggal, hariMulai);
        expect(p.mulai <= tanggal, `${tanggal} hariMulai ${hariMulai}`).toBe(true);
        expect(tanggal <= p.selesai, `${tanggal} hariMulai ${hariMulai}`).toBe(true);
        const d = new Date(`${tanggal}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() + 1);
        tanggal = d.toISOString().slice(0, 10);
      }
    }
  });
});

describe('periodeDariLabel', () => {
  it('membalik periodeUntuk dengan tepat', () => {
    for (const hariMulai of [1, 10, 25, 28]) {
      for (const tanggal of ['2026-01-05', '2026-06-26', '2026-12-31', '2027-02-14']) {
        const maju = periodeUntuk(tanggal, hariMulai);
        const balik = periodeDariLabel(maju.label, hariMulai);
        expect(balik, `${tanggal} hariMulai ${hariMulai}`).toEqual(maju);
      }
    }
  });

  it('label bulan kalender menghasilkan bulan kalender pada hari mulai 1', () => {
    const p = periodeDariLabel('2026-10', 1);
    expect(p.mulai).toBe('2026-10-01');
    expect(p.selesai).toBe('2026-10-31');
  });

  it('label 2026-10 dengan cut-off 25 berarti 25 Sep sampai 24 Okt', () => {
    const p = periodeDariLabel('2026-10', 25);
    expect(p.mulai).toBe('2026-09-25');
    expect(p.selesai).toBe('2026-10-24');
  });
});

describe('geserPeriode', () => {
  it('mundur satu periode', () => {
    const p = geserPeriode(periodeUntuk('2026-10-10', 25), -1);
    expect(p.mulai).toBe('2026-08-25');
    expect(p.selesai).toBe('2026-09-24');
  });

  it('maju dan mundur saling membalik', () => {
    const awal = periodeUntuk('2026-10-10', 25);
    expect(geserPeriode(geserPeriode(awal, 3), -3)).toEqual(awal);
  });

  it('melewati Februari tanpa kehilangan hari mulainya', () => {
    const p = geserPeriode(periodeUntuk('2026-03-10', 28), -1);
    expect(p.mulai).toBe('2026-01-28');
    expect(p.selesai).toBe('2026-02-27');
  });
});

describe('bersihkanHariMulai', () => {
  it('menjepit ke rentang yang sah', () => {
    expect(bersihkanHariMulai(0)).toBe(1);
    expect(bersihkanHariMulai(31)).toBe(HARI_MULAI_MAX);
    expect(bersihkanHariMulai(-5)).toBe(1);
    expect(bersihkanHariMulai(25)).toBe(25);
  });

  it('nilai yang bukan angka jatuh ke 1, bukan NaN', () => {
    // NaN di sini akan melahirkan tanggal 'NaN' yang lolos ke SQL sebagai
    // string, dan kueri BETWEEN-nya mengembalikan nol baris tanpa galat.
    expect(bersihkanHariMulai('bukan angka')).toBe(1);
    expect(bersihkanHariMulai(null)).toBe(1);
    expect(bersihkanHariMulai(undefined)).toBe(1);
  });

  it('membulatkan nilai pecahan', () => {
    expect(bersihkanHariMulai(25.4)).toBe(25);
  });
});

describe('sisaHariPeriode', () => {
  it('menghitung hari ini sebagai bagian dari sisa', () => {
    const p = periodeUntuk('2026-10-01', 1);
    expect(sisaHariPeriode('2026-10-31', p)).toBe(1);
    expect(sisaHariPeriode('2026-10-30', p)).toBe(2);
    expect(sisaHariPeriode('2026-10-01', p)).toBe(31);
  });

  it('tidak pernah nol, supaya pembagian sisa harian tidak jadi Infinity', () => {
    const p = periodeUntuk('2026-10-01', 1);
    // Tanggal di luar periode bisa terjadi kalau pengaturannya baru diubah.
    expect(sisaHariPeriode('2026-11-15', p)).toBe(1);
  });

  it('benar untuk periode ber-cut-off', () => {
    const p = periodeUntuk('2026-10-01', 25);
    expect(p.selesai).toBe('2026-10-24');
    expect(sisaHariPeriode('2026-10-20', p)).toBe(5);
  });
});

describe('labelPeriodeBerjalan', () => {
  it('sama dengan bulan kalender pada hari mulai 1', () => {
    expect(labelPeriodeBerjalan('2026-10-15', 1)).toBe('2026-10');
  });

  it('sudah pindah ke bulan berikutnya begitu melewati cut-off', () => {
    expect(labelPeriodeBerjalan('2026-09-24', 25)).toBe('2026-09');
    expect(labelPeriodeBerjalan('2026-09-25', 25)).toBe('2026-10');
  });
});
