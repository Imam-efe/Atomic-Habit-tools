/**
 * Uji waktu salat.
 *
 * Yang diuji sifat yang harus benar, bukan menit yang dicocokkan ke satu
 * jadwal cetak: jadwal resmi menambahkan menit ihtiyat yang besarnya berbeda
 * antar daerah, jadi menuliskan angka Kemenag sebagai kebenaran di sini
 * hanya akan mengunci kesalahan pengukuran orang lain ke dalam uji ini.
 *
 * Sifat yang dipilih adalah yang akan langsung rusak kalau rumusnya salah:
 * urutan waktu, perilaku matahari di khatulistiwa, arah pergeseran musim, dan
 * arah selisih antar zona waktu.
 */

import { describe, it, expect } from 'vitest';
import {
  hitungJadwalSalat, salatBerikutnya, formatJam, geserMenit, julianDay, sunPosition,
  hourAngle, PRAYER_ORDER, METHODS, type PrayerTimes,
} from './prayer';

const JAKARTA = { latitude: -6.2088, longitude: 106.8456, timezone: 7 };
const menit = (jam: string) => {
  const [h, m] = jam.split(':').map(Number);
  return h * 60 + m;
};

const jadwal = (date: string, over: Partial<Parameters<typeof hitungJadwalSalat>[0]> = {}) =>
  hitungJadwalSalat({ date, ...JAKARTA, ...over });

describe('julianDay', () => {
  it('cocok dengan nilai acuan J2000', () => {
    // 1 Januari 2000 pukul 12:00 UT = JD 2451545,0; tengah malamnya 0,5 lebih awal.
    expect(julianDay(2000, 1, 1)).toBe(2451544.5);
  });

  it('menangani Januari dan Februari yang dihitung sebagai bulan tahun sebelumnya', () => {
    expect(julianDay(2026, 3, 1) - julianDay(2026, 2, 1)).toBe(28);
    expect(julianDay(2024, 3, 1) - julianDay(2024, 2, 1)).toBe(29);
  });
});

describe('sunPosition', () => {
  it('deklinasi nol di sekitar ekuinoks', () => {
    // 20 Maret 2026 — matahari melintasi khatulistiwa.
    const { declination } = sunPosition(julianDay(2026, 3, 20));
    expect(Math.abs(declination)).toBeLessThan(1);
  });

  it('deklinasi positif di titik balik utara, negatif di selatan', () => {
    expect(sunPosition(julianDay(2026, 6, 21)).declination).toBeGreaterThan(23);
    expect(sunPosition(julianDay(2026, 12, 21)).declination).toBeLessThan(-23);
  });

  it('persamaan waktu tetap dalam rentang yang mungkin', () => {
    // Nilainya tidak pernah melewati ±17 menit sepanjang tahun.
    for (let bulan = 1; bulan <= 12; bulan++) {
      const { equationOfTime } = sunPosition(julianDay(2026, bulan, 15));
      expect(Math.abs(equationOfTime)).toBeLessThan(17);
    }
  });
});

describe('hourAngle', () => {
  it('enam jam saat matahari di ufuk dan deklinasi nol', () => {
    // Khatulistiwa, ekuinoks: matahari terbit 6 jam sebelum tengah hari.
    expect(hourAngle(0, 0, 0)).toBeCloseTo(6, 5);
  });

  it('NaN saat matahari tidak pernah mencapai ketinggian itu', () => {
    // Kutub di musim dingin: matahari tidak pernah naik.
    expect(Number.isNaN(hourAngle(89, -23, -18))).toBe(true);
  });
});

describe('formatJam', () => {
  it('membulatkan ke menit terdekat', () => {
    expect(formatJam(5.51)).toBe('05:31');
    expect(formatJam(17.999)).toBe('18:00');
  });

  it('tidak pernah menghasilkan 24:00', () => {
    expect(formatJam(23.9999)).toBe('00:00');
  });

  it('menandai waktu yang tidak terhitung', () => {
    expect(formatJam(NaN)).toBe('--:--');
  });
});

describe('geserMenit', () => {
  it('menggeser maju dan mundur', () => {
    expect(geserMenit('05:30', 2)).toBe('05:32');
    expect(geserMenit('05:30', -35)).toBe('04:55');
  });

  it('membiarkan waktu yang tidak terhitung apa adanya', () => {
    expect(geserMenit('--:--', 5)).toBe('--:--');
  });
});

describe('hitungJadwalSalat', () => {
  it('mengembalikan keenam waktu dalam format jam', () => {
    const t = jadwal('2026-08-25');
    for (const nama of PRAYER_ORDER) expect(t[nama]).toMatch(/^\d{2}:\d{2}$/);
  });

  it('waktunya berurutan sepanjang hari', () => {
    // Urutan yang salah adalah tanda rumus yang salah, dan ini yang paling
    // cepat menangkapnya.
    for (const d of ['2026-01-15', '2026-03-20', '2026-06-21', '2026-09-23', '2026-12-21']) {
      const t = jadwal(d);
      const urut = PRAYER_ORDER.map((n) => menit(t[n]));
      for (let i = 1; i < urut.length; i++) {
        expect(urut[i], `${d} ${PRAYER_ORDER[i]}`).toBeGreaterThan(urut[i - 1]);
      }
    }
  });

  it('terbit dan maghrib simetris terhadap dzuhur', () => {
    // Matahari naik dan turun dengan kecepatan yang sama; tengah hari ada di
    // tengah keduanya.
    const t = jadwal('2026-08-25');
    const sebelum = menit(t.dzuhur) - menit(t.terbit);
    const sesudah = menit(t.maghrib) - menit(t.dzuhur);
    expect(Math.abs(sebelum - sesudah)).toBeLessThanOrEqual(1);
  });

  it('siang hampir dua belas jam di khatulistiwa saat ekuinoks', () => {
    const t = hitungJadwalSalat({
      date: '2026-03-20', latitude: 0, longitude: 106.8456, timezone: 7,
    });
    const panjangSiang = menit(t.maghrib) - menit(t.terbit);
    expect(Math.abs(panjangSiang - 720)).toBeLessThan(10);
  });

  it('siang lebih panjang di bulan Desember daripada Juni untuk lintang selatan', () => {
    // Jakarta ada di selatan khatulistiwa, jadi musimnya terbalik dari Eropa.
    const desember = jadwal('2026-12-21');
    const juni = jadwal('2026-06-21');
    expect(menit(desember.maghrib) - menit(desember.terbit))
      .toBeGreaterThan(menit(juni.maghrib) - menit(juni.terbit));
  });

  it('kota yang lebih barat dalam satu zona waktu punya dzuhur lebih siang', () => {
    // Banda Aceh jauh di barat Jakarta tapi sama-sama WIB, jadi mataharinya
    // mencapai puncak lebih lambat menurut jam dinding.
    const aceh = hitungJadwalSalat({ date: '2026-08-25', latitude: 5.55, longitude: 95.32, timezone: 7 });
    const jkt = jadwal('2026-08-25');
    expect(menit(aceh.dzuhur)).toBeGreaterThan(menit(jkt.dzuhur));
  });

  it('metode MWL memberi Subuh lebih siang dan Isya lebih awal', () => {
    // Sudutnya lebih kecil (18° vs 20°, 17° vs 18°), jadi malamnya lebih pendek.
    const kemenag = jadwal('2026-08-25', { method: 'kemenag' });
    const mwl = jadwal('2026-08-25', { method: 'mwl' });

    expect(METHODS.mwl.fajr).toBeLessThan(METHODS.kemenag.fajr);
    expect(menit(mwl.subuh)).toBeGreaterThan(menit(kemenag.subuh));
    expect(menit(mwl.isya)).toBeLessThan(menit(kemenag.isya));
  });

  it('Ashar Hanafi selalu setelah Ashar Syafii', () => {
    // Bayangan dua kali tinggi benda tercapai belakangan.
    const syafii = jadwal('2026-08-25', { asrMethod: 'syafii' });
    const hanafi = jadwal('2026-08-25', { asrMethod: 'hanafi' });
    expect(menit(hanafi.ashar)).toBeGreaterThan(menit(syafii.ashar));
  });

  it('Ashar Hanafi tetap sebelum Maghrib', () => {
    const t = jadwal('2026-12-21', { asrMethod: 'hanafi' });
    expect(menit(t.ashar)).toBeLessThan(menit(t.maghrib));
  });

  it('menerapkan penyesuaian menit per waktu', () => {
    // Ini yang dipakai menyamakan dengan masjid di depan rumah.
    const asli = jadwal('2026-08-25');
    const geser = jadwal('2026-08-25', { adjust: { subuh: 2, terbit: -2 } });

    expect(menit(geser.subuh)).toBe(menit(asli.subuh) + 2);
    expect(menit(geser.terbit)).toBe(menit(asli.terbit) - 2);
    // Yang tidak disebut tidak ikut bergeser.
    expect(geser.dzuhur).toBe(asli.dzuhur);
  });

  it('mengabaikan penyesuaian yang bukan angka', () => {
    const asli = jadwal('2026-08-25');
    const geser = jadwal('2026-08-25', { adjust: { subuh: NaN } });
    expect(geser.subuh).toBe(asli.subuh);
  });

  it('memakai Kemenag saat metodenya tidak dikenal', () => {
    const t = jadwal('2026-08-25', { method: 'ngawur' as never });
    expect(t).toEqual(jadwal('2026-08-25', { method: 'kemenag' }));
  });
});

describe('salatBerikutnya', () => {
  const times: PrayerTimes = {
    subuh: '04:38', terbit: '05:56', dzuhur: '11:55',
    ashar: '15:15', maghrib: '17:53', isya: '19:04',
  };

  it('menemukan waktu berikutnya beserta sisa menitnya', () => {
    const n = salatBerikutnya(times, '11:00');
    expect(n).toMatchObject({ name: 'dzuhur', time: '11:55', inMinutes: 55, besok: false });
  });

  it('melewati terbit — itu batas akhir Subuh, bukan waktu salat', () => {
    expect(salatBerikutnya(times, '05:00')?.name).toBe('dzuhur');
  });

  it('menunjuk Subuh besok setelah Isya lewat', () => {
    const n = salatBerikutnya(times, '20:00');
    expect(n).toMatchObject({ name: 'subuh', besok: true });
    // 4 jam sampai tengah malam, lalu 4 jam 38 menit lagi.
    expect(n?.inMinutes).toBe(240 + 278);
  });

  it('menunjuk waktu itu sendiri hanya kalau belum lewat', () => {
    // Tepat pada menitnya sudah dianggap masuk, jadi yang berikutnya Ashar.
    expect(salatBerikutnya(times, '11:55')?.name).toBe('ashar');
  });

  it('menolak jam yang bentuknya salah', () => {
    expect(salatBerikutnya(times, 'besok')).toBeNull();
  });

  it('mengabaikan waktu yang tidak terhitung', () => {
    const rusak: PrayerTimes = { ...times, subuh: '--:--' };
    expect(salatBerikutnya(rusak, '03:00')?.name).toBe('dzuhur');
  });
});
