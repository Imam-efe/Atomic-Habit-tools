import { describe, it, expect } from 'vitest';
import { findClashes, findFreeSlot, toClock, toMinutes } from './reschedule';

describe('toMinutes / toClock', () => {
  it('bolak-balik tanpa berubah', () => {
    expect(toMinutes('06:30')).toBe(390);
    expect(toClock(390)).toBe('06:30');
    expect(toClock(toMinutes('22:00'))).toBe('22:00');
  });
});

describe('findFreeSlot', () => {
  it('memilih jam terdekat, termasuk lebih awal dari jam semula', () => {
    // 06:00 terpakai; 05:30 dan 06:30 sama-sama kosong, yang lebih awal
    // diperiksa lebih dulu pada jarak yang sama.
    expect(toClock(findFreeSlot(toMinutes('06:00'), [{ start: toMinutes('06:00'), len: 30 }])!)).toBe('05:30');
  });

  it('melebar sampai menemukan celah', () => {
    const busy = [
      { start: toMinutes('05:00'), len: 120 },
      { start: toMinutes('07:30'), len: 60 },
    ];
    expect(toClock(findFreeSlot(toMinutes('06:00'), busy)!)).toBe('07:00');
  });

  it('mengembalikan null saat harinya penuh', () => {
    const busy = [{ start: 5 * 60, len: 17 * 60 }]; // 05:00–22:00 penuh
    expect(findFreeSlot(toMinutes('06:00'), busy)).toBeNull();
  });

  it('tidak menyarankan jam di luar 05:00–22:00', () => {
    const busy = [{ start: 5 * 60, len: 16 * 60 + 30 }]; // sisa cuma 21:30
    const slot = findFreeSlot(toMinutes('06:00'), busy);
    expect(slot).not.toBeNull();
    expect(slot! + 30).toBeLessThanOrEqual(22 * 60);
  });
});

describe('findClashes', () => {
  const habit = { id: 'h1', name: 'Olahraga', time: '06:00', twoMin: 'Pakai sepatu lari' };

  it('tidak melaporkan apa-apa saat tidak ada bentrok', () => {
    const events = [{ title: 'Rapat', time: '09:00', durationMin: 60 }];
    expect(findClashes([habit], events)).toEqual([]);
  });

  it('mendeteksi bentrok dan menyarankan jam pengganti', () => {
    const events = [{ title: 'Antar sekolah', time: '06:00', durationMin: 60 }];
    const [suggestion] = findClashes([habit], events);

    expect(suggestion.clashesWith).toBe('Antar sekolah');
    expect(suggestion.currentTime).toBe('06:00');
    expect(suggestion.suggestedTime).toBe('05:30');
    expect(suggestion.fallbackTwoMin).toBe('Pakai sepatu lari');
  });

  it('mendeteksi tumpang tindih sebagian, bukan hanya jam yang sama persis', () => {
    // Agenda 05:45–06:45 menutupi awal kebiasaan 06:00.
    const events = [{ title: 'Telepon', time: '05:45', durationMin: 60 }];
    expect(findClashes([habit], events)).toHaveLength(1);
  });

  it('tidak memindahkan kebiasaan ke jam kebiasaan lain', () => {
    const habits = [
      habit,
      { id: 'h2', name: 'Baca', time: '05:30', twoMin: null },
    ];
    const events = [{ title: 'Antar sekolah', time: '06:00', durationMin: 60 }];
    const [suggestion] = findClashes(habits, events);

    // 05:30 sudah dipakai Baca, jadi jam itu harus dilewati. Yang dipilih
    // 05:00: sama-sama 60 menit dari 06:00 seperti 07:00, dan pada jarak yang
    // sama sisi lebih awal diperiksa lebih dulu.
    expect(suggestion.suggestedTime).not.toBe('05:30');
    expect(suggestion.suggestedTime).toBe('05:00');
  });

  it('mengembalikan versi dua menit saat tidak ada jam kosong sama sekali', () => {
    const events = [{ title: 'Acara seharian', time: '05:00', durationMin: 17 * 60 }];
    const [suggestion] = findClashes([habit], events);

    expect(suggestion.suggestedTime).toBeNull();
    expect(suggestion.fallbackTwoMin).toBe('Pakai sepatu lari');
  });
});
