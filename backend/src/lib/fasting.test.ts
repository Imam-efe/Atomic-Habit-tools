import { describe, it, expect } from 'vitest';
import { toHijri, puasaPada, puasaMendatang, ringkasPuasa, hariKe } from './fasting';

describe('toHijri', () => {
  it('menghitung tanggal Hijriah yang masuk akal', () => {
    const h = toHijri('2026-08-25');
    expect(h.year).toBeGreaterThan(1440);
    expect(h.month).toBeGreaterThanOrEqual(1);
    expect(h.month).toBeLessThanOrEqual(12);
    expect(h.day).toBeGreaterThanOrEqual(1);
    expect(h.day).toBeLessThanOrEqual(30);
  });

  it('maju satu hari Hijriah untuk tiap hari Masehi', () => {
    const a = toHijri('2026-08-25');
    const b = toHijri('2026-08-26');
    // Entah harinya bertambah satu, atau bulannya berganti dan harinya jadi 1.
    expect(b.day === a.day + 1 || b.day === 1).toBe(true);
  });

  it('menghasilkan nama bulan yang dikenal', () => {
    expect(toHijri('2026-08-25').monthName).toMatch(/^[A-Za-z ]+$/);
  });
});

describe('hariKe', () => {
  it('tidak bergantung zona waktu perangkat', () => {
    // 25 Agustus 2026 adalah hari Selasa.
    expect(hariKe('2026-08-25')).toBe(2);
  });
});

describe('puasaPada', () => {
  it('menandai Senin dan Kamis', () => {
    // 24 Agustus 2026 Senin, 27 Agustus Kamis.
    expect(puasaPada('2026-08-24')).toContain('senin-kamis');
    expect(puasaPada('2026-08-27')).toContain('senin-kamis');
  });

  it('tidak menandai hari lain sebagai Senin-Kamis', () => {
    expect(puasaPada('2026-08-25')).not.toContain('senin-kamis');
  });

  it('menandai Ayyamul Bidh pada 13, 14, 15 Hijriah', () => {
    // Cari tanggal Masehi yang jatuh pada 14 Hijriah dalam sebulan ke depan.
    let ketemu = false;
    for (let i = 0; i < 40; i++) {
      const iso = new Date(Date.parse('2026-08-01T00:00:00Z') + i * 86400000)
        .toISOString().slice(0, 10);
      if (toHijri(iso).day === 14) {
        expect(puasaPada(iso)).toContain('ayyamul-bidh');
        ketemu = true;
        break;
      }
    }
    expect(ketemu).toBe(true);
  });

  it('bisa menandai lebih dari satu jenis pada tanggal yang sama', () => {
    // 13 Hijriah yang jatuh Senin atau Kamis adalah keduanya sekaligus;
    // menyembunyikan salah satunya membuat daftar terasa keliru.
    let ketemu = false;
    for (let i = 0; i < 400; i++) {
      const iso = new Date(Date.parse('2026-01-01T00:00:00Z') + i * 86400000)
        .toISOString().slice(0, 10);
      const kinds = puasaPada(iso);
      if (kinds.length > 1) {
        expect(kinds).toContain('senin-kamis');
        expect(kinds).toContain('ayyamul-bidh');
        ketemu = true;
        break;
      }
    }
    expect(ketemu).toBe(true);
  });

  it('tidak pernah menyarankan puasa di hari yang dilarang', () => {
    // Idulfitri, Iduladha, dan tasyrik. Menyarankan puasa di hari itu bukan
    // sekadar salah jadwal — itu menyarankan sesuatu yang dilarang.
    for (let i = 0; i < 800; i++) {
      const iso = new Date(Date.parse('2026-01-01T00:00:00Z') + i * 86400000)
        .toISOString().slice(0, 10);
      const h = toHijri(iso);

      const terlarang =
        (h.month === 10 && h.day === 1) || (h.month === 12 && h.day >= 10 && h.day <= 13);

      if (terlarang) expect(puasaPada(iso), iso).toEqual([]);
    }
  });

  it('menandai Arafah dan Asyura', () => {
    let arafah = false;
    let asyura = false;
    for (let i = 0; i < 800; i++) {
      const iso = new Date(Date.parse('2026-01-01T00:00:00Z') + i * 86400000)
        .toISOString().slice(0, 10);
      const h = toHijri(iso);
      if (h.month === 12 && h.day === 9) {
        expect(puasaPada(iso)).toContain('arafah');
        arafah = true;
      }
      if (h.month === 1 && h.day === 10) {
        expect(puasaPada(iso)).toContain('asyura');
        asyura = true;
      }
    }
    expect(arafah && asyura).toBe(true);
  });

  it('menandai enam hari Syawal mulai tanggal dua, bukan tanggal satu', () => {
    for (let i = 0; i < 800; i++) {
      const iso = new Date(Date.parse('2026-01-01T00:00:00Z') + i * 86400000)
        .toISOString().slice(0, 10);
      const h = toHijri(iso);
      if (h.month !== 10) continue;
      if (h.day === 1) expect(puasaPada(iso)).toEqual([]);
      if (h.day >= 2 && h.day <= 7) expect(puasaPada(iso)).toContain('syawal');
    }
  });
});

describe('puasaMendatang', () => {
  it('hanya mengembalikan hari yang ada puasanya', () => {
    const hasil = puasaMendatang('2026-08-25', 30);
    expect(hasil.length).toBeGreaterThan(0);
    for (const h of hasil) expect(h.kinds.length).toBeGreaterThan(0);
  });

  it('urut menaik dan tidak melewati batas hari', () => {
    const hasil = puasaMendatang('2026-08-25', 14);
    const terakhir = new Date(Date.parse('2026-08-25T00:00:00Z') + 13 * 86400000)
      .toISOString().slice(0, 10);

    for (let i = 1; i < hasil.length; i++) {
      expect(hasil[i].date > hasil[i - 1].date).toBe(true);
    }
    expect(hasil[hasil.length - 1].date <= terakhir).toBe(true);
  });

  it('menyertakan nama hari dan tanggal Hijriah', () => {
    const [pertama] = puasaMendatang('2026-08-25', 30);
    expect(pertama.dayName).toMatch(/Senin|Selasa|Rabu|Kamis|Jumat|Sabtu|Minggu/);
    expect(pertama.hijri).toMatch(/\d+ .+ \d+ H/);
  });

  it('membatasi rentang yang terlalu panjang', () => {
    // Daftar sepanjang tahun tidak dibaca siapa pun.
    const hasil = puasaMendatang('2026-01-01', 9999);
    const terakhir = new Date(Date.parse('2026-01-01T00:00:00Z') + 119 * 86400000)
      .toISOString().slice(0, 10);
    expect(hasil[hasil.length - 1].date <= terakhir).toBe(true);
  });
});

describe('ringkasPuasa', () => {
  it('menghitung total dan memilah per jenis', () => {
    const r = ringkasPuasa(
      [
        { date: '2026-08-24', kind: 'senin-kamis' },
        { date: '2026-08-27', kind: 'senin-kamis' },
        { date: '2026-08-28', kind: 'ayyamul-bidh' },
      ],
      '2026-08-29'
    );

    expect(r.total).toBe(3);
    expect(r.perJenis[0]).toMatchObject({ kind: 'senin-kamis', jumlah: 2 });
  });

  it('menghitung rentetan dalam pekan, bukan hari', () => {
    // Puasa Senin lalu Kamis bukan dua hari berturut-turut; menghitungnya
    // sebagai rentetan harian akan selalu menunjukkan angka satu.
    const r = ringkasPuasa(
      [
        { date: '2026-08-24', kind: 'senin-kamis' }, // pekan ini
        { date: '2026-08-17', kind: 'senin-kamis' }, // pekan lalu
        { date: '2026-08-10', kind: 'senin-kamis' }, // dua pekan lalu
      ],
      '2026-08-25'
    );
    expect(r.seninKamisBerturut).toBe(3);
  });

  it('rentetan putus di pekan yang benar-benar terlewat', () => {
    const r = ringkasPuasa(
      [
        { date: '2026-08-24', kind: 'senin-kamis' },
        // 17 Agustus dilewati.
        { date: '2026-08-10', kind: 'senin-kamis' },
      ],
      '2026-08-25'
    );
    expect(r.seninKamisBerturut).toBe(1);
  });

  it('pekan berjalan yang harinya belum tiba tidak memutus rentetan', () => {
    // Minggu pagi, Senin belum datang: itu bukan bolos.
    const r = ringkasPuasa(
      [{ date: '2026-08-17', kind: 'senin-kamis' }],
      '2026-08-23'
    );
    expect(r.seninKamisBerturut).toBeGreaterThanOrEqual(1);
  });

  it('menampung jenis yang tidak dikenal sebagai lainnya', () => {
    const r = ringkasPuasa([{ date: '2026-08-24', kind: 'entah-apa' }], '2026-08-25');
    expect(r.perJenis[0].kind).toBe('lainnya');
  });

  it('mengembalikan nol untuk catatan kosong', () => {
    const r = ringkasPuasa([], '2026-08-25');
    expect(r).toMatchObject({ total: 0, seninKamisBerturut: 0, perJenis: [] });
  });
});
