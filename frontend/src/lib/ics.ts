import { todayISO } from './date';
interface HabitReminder {
  id: string;
  name: string;
  reminderTime: string; // "HH:MM"
}

function icsEscape(text: string) {
  return text.replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\n/g, '\\n');
}

function todayStamp() {
  return new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}

/**
 * Builds a daily-recurring .ics calendar for habit reminders. DTSTART/DTEND
 * are floating local time (no TZID, no Z) — the calendar app reads them in
 * whatever timezone the device is set to, which is exactly "same time every
 * day" for a habit reminder and needs no timezone plumbing to get there.
 */
export function buildHabitReminderIcs(habits: HabitReminder[]): string {
  const stamp = todayStamp();
  // WIB, seperti sisa aplikasi: dini hari toISOString() memberi tanggal
  // kemarin dan deret pengingatnya mulai sehari lebih awal.
  const today = todayISO().replace(/-/g, '');

  const events = habits.map((h) => {
    const [hh, mm] = h.reminderTime.split(':');
    const start = `${today}T${hh}${mm}00`;
    const endMinute = String((parseInt(mm, 10) + 15) % 60).padStart(2, '0');
    const endHour = String((parseInt(hh, 10) + (parseInt(mm, 10) + 15 >= 60 ? 1 : 0)) % 24).padStart(2, '0');
    const end = `${today}T${endHour}${endMinute}00`;

    return [
      'BEGIN:VEVENT',
      `UID:habit-${h.id}@fayolla.app`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${start}`,
      `DTEND:${end}`,
      'RRULE:FREQ=DAILY',
      `SUMMARY:${icsEscape(h.name)}`,
      'DESCRIPTION:Pengingat kebiasaan dari Fayolla',
      'END:VEVENT',
    ].join('\r\n');
  });

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Fayolla//Habit Reminders//ID',
    'CALSCALE:GREGORIAN',
    ...events,
    'END:VCALENDAR',
  ].join('\r\n');
}

export function downloadIcs(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
