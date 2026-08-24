/**
 * "Geser Otomatis" — mendeteksi kebiasaan yang bentrok dengan agenda, lalu
 * menyarankan jam pengganti atau menurunkannya ke versi dua menit.
 *
 * Murni aritmetika jam, tanpa AI: aturannya bisa ditulis persis, dan saran
 * jadwal yang tidak bisa diprediksi justru bikin orang berhenti percaya.
 */

export interface TimedEvent {
  title: string;
  time: string;      // HH:MM
  durationMin: number;
}

export interface TimedHabit {
  id: string;
  name: string;
  time: string;      // HH:MM
  twoMin: string | null;
}

export interface Suggestion {
  habitId: string;
  habitName: string;
  currentTime: string;
  clashesWith: string;
  /** Jam kosong terdekat, atau null kalau harinya benar-benar penuh. */
  suggestedTime: string | null;
  /** Dipakai saat tidak ada jam kosong yang masuk akal. */
  fallbackTwoMin: string | null;
}

/** Anggapan durasi satu kebiasaan saat mengecek bentrok. */
const HABIT_MINUTES = 30;

/** Jendela hari yang wajar untuk menaruh kebiasaan: 05:00–22:00. */
const DAY_START = 5 * 60;
const DAY_END = 22 * 60;

export function toMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

export function toClock(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function overlaps(aStart: number, aLen: number, bStart: number, bLen: number): boolean {
  return aStart < bStart + bLen && bStart < aStart + aLen;
}

/**
 * Cari jam kosong terdekat dari `preferred`, melebar ke dua arah.
 *
 * Melebar simetris supaya jam 06:00 yang bentrok bisa bergeser ke 05:30
 * maupun 06:30 — mana yang lebih dekat menang, bukan selalu didorong ke sore.
 */
export function findFreeSlot(
  preferred: number,
  busy: Array<{ start: number; len: number }>,
  stepMin = 30
): number | null {
  const isFree = (start: number) =>
    start >= DAY_START &&
    start + HABIT_MINUTES <= DAY_END &&
    !busy.some((b) => overlaps(start, HABIT_MINUTES, b.start, b.len));

  for (let delta = stepMin; delta <= DAY_END - DAY_START; delta += stepMin) {
    if (isFree(preferred - delta)) return preferred - delta;
    if (isFree(preferred + delta)) return preferred + delta;
  }
  return null;
}

/** Kebiasaan berjadwal yang bertabrakan dengan agenda, beserta usulannya. */
export function findClashes(habits: TimedHabit[], events: TimedEvent[]): Suggestion[] {
  const busy = events.map((e) => ({ start: toMinutes(e.time), len: e.durationMin }));

  const suggestions: Suggestion[] = [];
  for (const habit of habits) {
    const start = toMinutes(habit.time);
    const clash = events.find((e) =>
      overlaps(start, HABIT_MINUTES, toMinutes(e.time), e.durationMin)
    );
    if (!clash) continue;

    // Kebiasaan lain yang tidak bentrok tetap dihitung sibuk, supaya usulannya
    // tidak sekadar memindahkan tabrakan ke kebiasaan berikutnya.
    const otherHabits = habits
      .filter((h) => h.id !== habit.id)
      .map((h) => ({ start: toMinutes(h.time), len: HABIT_MINUTES }));

    const slot = findFreeSlot(start, [...busy, ...otherHabits]);

    suggestions.push({
      habitId: habit.id,
      habitName: habit.name,
      currentTime: habit.time,
      clashesWith: clash.title,
      suggestedTime: slot === null ? null : toClock(slot),
      fallbackTwoMin: habit.twoMin,
    });
  }

  return suggestions;
}
