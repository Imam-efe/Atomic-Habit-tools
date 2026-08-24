import { describe, it, expect } from 'vitest';
import { SETTINGS, SETTING_BY_KEY, SETTING_GROUPS, coerceSetting } from './settings_schema';
import { defaultSettings, num, bool } from './settings';

describe('registry pengaturan', () => {
  it('tidak punya kunci ganda', () => {
    const keys = SETTINGS.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('setiap pengaturan masuk grup yang terdaftar', () => {
    const known = new Set(SETTING_GROUPS.map((g) => g.id));
    for (const def of SETTINGS) {
      expect(known.has(def.group), `grup tidak dikenal pada ${def.key}: ${def.group}`).toBe(true);
    }
  });

  it('nilai bawaannya sendiri lolos validasi', () => {
    // Bawaan yang ditolak validasinya sendiri akan membuat pengaturan itu
    // mustahil disimpan kembali setelah diubah.
    for (const def of SETTINGS) {
      expect(coerceSetting(def, def.default), `bawaan ditolak: ${def.key}`).not.toBeNull();
    }
  });

  it('setiap angka punya batas bawah dan atas', () => {
    for (const def of SETTINGS) {
      if (def.type === 'number' || def.type === 'hour') {
        expect(def.min, `min hilang: ${def.key}`).toBeTypeOf('number');
        expect(def.max, `max hilang: ${def.key}`).toBeTypeOf('number');
      }
    }
  });

  it('setiap jam berada dalam rentang 0 sampai 23', () => {
    // Batas bawahnya boleh lebih ketat — "akhir hari" tidak masuk akal di jam
    // 0 — tapi tidak boleh keluar dari rentang jam yang sah.
    for (const def of SETTINGS.filter((s) => s.type === 'hour')) {
      expect(def.min, `min di luar rentang: ${def.key}`).toBeGreaterThanOrEqual(0);
      expect(def.max, `max di luar rentang: ${def.key}`).toBeLessThanOrEqual(23);
    }
  });

  it('jam kirim notifikasi selalu boleh diisi 0 sampai 23 penuh', () => {
    for (const def of SETTINGS.filter((s) => s.type === 'hour' && s.group === 'notifikasi')) {
      expect(def.min).toBe(0);
      expect(def.max).toBe(23);
    }
  });

  it('tiap sakelar notifikasi punya pasangan yang jelas', () => {
    // Kunci jam harus selalu punya sakelar induk; jam tanpa sakelar berarti
    // alert yang tidak bisa dimatikan sama sekali.
    for (const def of SETTINGS.filter((s) => s.key.endsWith('.hour'))) {
      const parent = def.key.replace(/\.hour$/, '');
      expect(SETTING_BY_KEY.has(parent), `sakelar induk hilang untuk ${def.key}`).toBe(true);
    }
  });
});

describe('coerceSetting', () => {
  const hourDef = SETTING_BY_KEY.get('notify.morning_brief.hour')!;
  const toggleDef = SETTING_BY_KEY.get('notify.morning_brief')!;
  const numDef = SETTING_BY_KEY.get('money.bill_horizon_days')!;

  it('menerima angka dalam batas', () => {
    expect(coerceSetting(hourDef, 6)).toBe(6);
    expect(coerceSetting(hourDef, 0)).toBe(0);
    expect(coerceSetting(hourDef, 23)).toBe(23);
  });

  it('menolak angka di luar batas, bukan memotongnya diam-diam', () => {
    // Memotong jam 99 jadi 23 akan menyimpan sesuatu yang tidak diminta
    // pengguna; menolak membuat kesalahannya terlihat.
    expect(coerceSetting(hourDef, 24)).toBeNull();
    expect(coerceSetting(hourDef, -1)).toBeNull();
    expect(coerceSetting(numDef, 0)).toBeNull();
  });

  it('menolak yang bukan angka', () => {
    expect(coerceSetting(hourDef, 'pagi')).toBeNull();
    expect(coerceSetting(hourDef, NaN)).toBeNull();
    expect(coerceSetting(hourDef, null)).toBeNull();
  });

  it('membulatkan jam pecahan', () => {
    expect(coerceSetting(hourDef, 6.4)).toBe(6);
  });

  it('menerima boolean dalam beberapa bentuk', () => {
    expect(coerceSetting(toggleDef, true)).toBe(true);
    expect(coerceSetting(toggleDef, 'false')).toBe(false);
    expect(coerceSetting(toggleDef, 1)).toBe(true);
    expect(coerceSetting(toggleDef, 0)).toBe(false);
  });

  it('menolak boolean yang tidak jelas', () => {
    expect(coerceSetting(toggleDef, 'mungkin')).toBeNull();
    expect(coerceSetting(toggleDef, 2)).toBeNull();
  });

  it('menerima angka dalam bentuk string', () => {
    expect(coerceSetting(numDef, '7')).toBe(7);
  });
});

describe('defaultSettings', () => {
  it('memuat setiap kunci di registry', () => {
    const defaults = defaultSettings();
    expect(Object.keys(defaults).length).toBe(SETTINGS.length);
  });

  it('cocok dengan jam yang selama ini dipakai cron', () => {
    // Bawaan harus meniru perilaku sebelum ada pengaturan, supaya pengguna
    // lama tidak mendadak menerima push di jam berbeda.
    const d = defaultSettings();
    expect(d['notify.morning_brief.hour']).toBe(6);
    expect(d['notify.garden_care.hour']).toBe(7);
    expect(d['notify.bill_radar.hour']).toBe(8);
    expect(d['notify.miss_twice.hour']).toBe(9);
    expect(d['notify.kids_prep.hour']).toBe(19);
    expect(d['notify.streak_at_risk.hour']).toBe(20);
  });

  it('cocok dengan ambang yang selama ini tertanam di kode', () => {
    const d = defaultSettings();
    expect(d['garden.rain_skip_mm']).toBe(5);
    expect(d['garden.rain_soaked_mm']).toBe(20);
    expect(d['patterns.min_days']).toBe(5);
    expect(d['patterns.min_gap']).toBe(15);
    expect(d['inventory.expiry_days']).toBe(3);
    expect(d['money.bill_horizon_days']).toBe(3);
    expect(d['calendar.default_event_minutes']).toBe(60);
    expect(d['habit.slot_minutes']).toBe(30);
  });

  it('semua notifikasi menyala secara bawaan', () => {
    const d = defaultSettings();
    for (const def of SETTINGS.filter((s) => s.group === 'notifikasi' && s.type === 'boolean')) {
      expect(d[def.key], `${def.key} harus aktif secara bawaan`).toBe(true);
    }
  });
});

describe('pembaca bertipe', () => {
  it('mengembalikan nilai yang tersimpan', () => {
    expect(num({ 'patterns.min_days': 12 }, 'patterns.min_days')).toBe(12);
    expect(bool({ 'notify.morning_brief': false }, 'notify.morning_brief')).toBe(false);
  });

  it('jatuh ke bawaan saat tipenya salah', () => {
    // Baris database rusak tidak boleh menjatuhkan fitur; bawaan yang menang.
    expect(num({ 'patterns.min_days': 'dua belas' as never }, 'patterns.min_days')).toBe(5);
    expect(bool({ 'notify.morning_brief': 'ya' as never }, 'notify.morning_brief')).toBe(true);
  });

  it('jatuh ke bawaan saat kuncinya tidak ada', () => {
    expect(num({}, 'patterns.min_days')).toBe(5);
    expect(bool({}, 'notify.morning_brief')).toBe(true);
  });
});
