import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { springs, collapse, press } from '@/tokens/motion';
import { apiFetch } from '@/lib/api';
import {
  DAY_INITIALS, MONTH_NAMES, monthGrid, todayISO, fromISO, toISO,
  formatLong, formatShort, daysBetween, isWeekend, wetonOf, toHijri,
} from '@/lib/calendar';
import { holidayOn, holidaysInYear, hasOfficialData, nextHoliday } from '@/data/holidays';
import { observancesOn } from '@/data/observances';

interface CalendarEvent {
  id: string;
  title: string;
  note: string | null;
  kind: string;
  date: string;
  event_date: string;
  event_time: string | null;
  end_time: string | null;
  priority: string;
  is_done: number;
  repeat_rule: string;
  is_repeat: boolean;
}

interface AgendaItem {
  source: string;
  id: string;
  title: string;
  detail?: string | null;
  time?: string | null;
}

const KIND_LABEL: Record<string, string> = {
  task: 'Tugas',
  event: 'Acara',
  reminder: 'Pengingat',
  milestone: 'Tonggak',
};

const KIND_ICON: Record<string, string> = {
  task: '✓', event: '◆', reminder: '◔', milestone: '★',
};

/** Where a cross-module agenda item came from, in words the user recognises. */
const SOURCE_LABEL: Record<string, string> = {
  debt: 'Utang',
  debt_payment: 'Pelunasan',
  inventory: 'Stok',
  kids: 'Anak',
  habit: 'Kebiasaan',
};

export function Calendar() {
  const today = todayISO();
  const [cursor, setCursor] = useState(() => {
    const d = fromISO(today);
    return { year: d.getFullYear(), month: d.getMonth() };
  });
  const [selected, setSelected] = useState(today);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [agenda, setAgenda] = useState<AgendaItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Form state
  const [showAdd, setShowAdd] = useState(false);
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [kind, setKind] = useState('task');
  const [time, setTime] = useState('');
  const [priority, setPriority] = useState('normal');
  const [repeat, setRepeat] = useState('none');
  const [saving, setSaving] = useState(false);

  const grid = useMemo(() => monthGrid(cursor.year, cursor.month), [cursor]);
  const rangeFrom = grid[0].iso;
  const rangeTo = grid[grid.length - 1].iso;

  const loadEvents = async () => {
    setLoading(true);
    try {
      const res = await apiFetch<CalendarEvent[]>(`/calendar?from=${rangeFrom}&to=${rangeTo}`);
      setEvents(Array.isArray(res) ? res : []);
    } catch { setEvents([]); }
    setLoading(false);
  };

  const loadAgenda = async (date: string) => {
    try {
      const res = await apiFetch<{ items: AgendaItem[] }>(`/calendar/agenda?date=${date}`);
      setAgenda(res?.items ?? []);
    } catch { setAgenda([]); }
  };

  useEffect(() => { loadEvents(); }, [rangeFrom, rangeTo]);
  useEffect(() => { loadAgenda(selected); }, [selected]);

  /** Events keyed by date, so a grid cell is a map lookup rather than a filter. */
  const byDate = useMemo(() => {
    const m = new Map<string, CalendarEvent[]>();
    for (const e of events) {
      const list = m.get(e.date);
      if (list) list.push(e);
      else m.set(e.date, [e]);
    }
    return m;
  }, [events]);

  const monthHolidays = useMemo(
    () => holidaysInYear(cursor.year).filter((h) => Number(h.date.slice(5, 7)) === cursor.month + 1),
    [cursor]
  );

  const upcoming = useMemo(() => nextHoliday(today), [today]);

  const selectedHoliday = holidayOn(selected);
  const selectedObservances = observancesOn(selected);
  const selectedEvents = byDate.get(selected) ?? [];
  const hijri = toHijri(selected);

  const shiftMonth = (delta: number) => {
    setCursor((c) => {
      const d = new Date(c.year, c.month + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  };

  const goToday = () => {
    const d = fromISO(today);
    setCursor({ year: d.getFullYear(), month: d.getMonth() });
    setSelected(today);
  };

  const resetForm = () => {
    setTitle(''); setNote(''); setKind('task'); setTime('');
    setPriority('normal'); setRepeat('none');
  };

  const addEvent = async () => {
    if (!title.trim()) return;
    setSaving(true);
    try {
      await apiFetch('/calendar', {
        method: 'POST',
        body: JSON.stringify({
          title: title.trim(),
          note: note.trim() || undefined,
          kind,
          event_date: selected,
          event_time: time || undefined,
          priority,
          repeat_rule: repeat,
        }),
      });
      resetForm();
      setShowAdd(false);
      loadEvents();
    } catch {}
    setSaving(false);
  };

  const toggleEvent = async (ev: CalendarEvent) => {
    // Optimistic: the checkbox should not wait for a round trip.
    setEvents((prev) => prev.map((e) => e.id === ev.id ? { ...e, is_done: e.is_done ? 0 : 1 } : e));
    await apiFetch(`/calendar/${ev.id}/toggle`, { method: 'POST' }).catch(() => loadEvents());
  };

  const deleteEvent = async (id: string) => {
    setEvents((prev) => prev.filter((e) => e.id !== id));
    await apiFetch(`/calendar/${id}`, { method: 'DELETE' }).catch(() => loadEvents());
  };

  const monthTaskCount = events.filter((e) => e.kind === 'task').length;
  const monthDoneCount = events.filter((e) => e.kind === 'task' && e.is_done).length;

  return (
    <div className="min-h-screen px-5 pt-16 pb-28" style={{ background: 'var(--bg)' }}>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-3xl font-extrabold tracking-tight" style={{ color: 'var(--text)', letterSpacing: '-0.6px' }}>
          Kalender
        </h1>
        <motion.button
          onClick={goToday}
          className="px-3 py-1.5 rounded-xl text-xs font-bold"
          style={{ background: 'var(--surface)', color: 'var(--accent)', boxShadow: 'var(--neu-raised-sm)' }}
          whileTap={press.control}
          transition={springs.snappy}
        >
          Hari ini
        </motion.button>
      </div>
      <p className="text-xs mb-5" style={{ color: 'var(--text3)' }}>
        {formatLong(today)}
      </p>

      {/* Month switcher */}
      <div className="flex items-center justify-between mb-3">
        <motion.button
          onClick={() => shiftMonth(-1)}
          aria-label="Bulan sebelumnya"
          className="w-9 h-9 rounded-full flex items-center justify-center"
          style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised-sm)' }}
          whileTap={press.control}
          transition={springs.snappy}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text2)" strokeWidth="2.5" strokeLinecap="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </motion.button>

        <p className="text-base font-bold" style={{ color: 'var(--text)' }}>
          {MONTH_NAMES[cursor.month]} {cursor.year}
        </p>

        <motion.button
          onClick={() => shiftMonth(1)}
          aria-label="Bulan berikutnya"
          className="w-9 h-9 rounded-full flex items-center justify-center"
          style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised-sm)' }}
          whileTap={press.control}
          transition={springs.snappy}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text2)" strokeWidth="2.5" strokeLinecap="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </motion.button>
      </div>

      {/* Grid */}
      <div className="rounded-[20px] p-3 mb-4" style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}>
        <div className="grid grid-cols-7 mb-1">
          {DAY_INITIALS.map((d, i) => (
            <span
              key={d}
              className="text-[10px] font-bold text-center py-1"
              // Sunday is the last column in a Monday-first grid.
              style={{ color: i === 6 ? 'var(--neg)' : 'var(--text3)' }}
            >
              {d}
            </span>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-y-0.5">
          {grid.map((cell) => {
            const hol = holidayOn(cell.iso);
            const isLibur = hol?.kind === 'libur';
            const isCuti = hol?.kind === 'cuti';
            const sunday = fromISO(cell.iso).getDay() === 0;
            const isToday = cell.iso === today;
            const isSelected = cell.iso === selected;
            const dayEvents = byDate.get(cell.iso) ?? [];

            // Red for a red date, red for Sunday — the convention every printed
            // Indonesian calendar uses. Out-of-month days stay muted so the
            // current month still reads as a block.
            let color = 'var(--text)';
            if (!cell.inMonth) color = 'var(--text3)';
            else if (isLibur || sunday) color = 'var(--neg)';

            return (
              <button
                key={cell.iso}
                onClick={() => setSelected(cell.iso)}
                aria-label={`${formatLong(cell.iso)}${hol ? ` — ${hol.name}` : ''}`}
                aria-current={isToday ? 'date' : undefined}
                className="relative flex flex-col items-center justify-center rounded-xl py-1.5"
                style={{
                  opacity: cell.inMonth ? 1 : 0.45,
                  boxShadow: isSelected
                    ? 'var(--neu-pressed)'
                    : isToday ? 'var(--neu-raised-sm)' : 'none',
                  transition: 'box-shadow 180ms var(--ease-depth)',
                }}
              >
                <span
                  className="text-[13px]"
                  style={{ color, fontWeight: isToday || isSelected ? 800 : 500 }}
                >
                  {cell.day}
                </span>

                {/* Markers: a bar for a holiday, dots for entries. */}
                <span className="flex items-center gap-0.5 h-1.5 mt-0.5">
                  {isLibur && <span className="w-3 h-[3px] rounded-full" style={{ background: 'var(--neg)' }} />}
                  {isCuti && <span className="w-3 h-[3px] rounded-full" style={{ background: 'var(--warn)' }} />}
                  {dayEvents.slice(0, 3).map((e) => (
                    <span
                      key={e.id}
                      className="w-1 h-1 rounded-full"
                      style={{ background: e.is_done ? 'var(--text3)' : 'var(--accent)' }}
                    />
                  ))}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Month summary */}
      <div className="flex gap-2 mb-4">
        <div className="flex-1 rounded-[14px] px-3 py-2.5" style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised-sm)' }}>
          <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text3)' }}>Tanggal merah</p>
          <p className="text-lg font-extrabold" style={{ color: 'var(--neg)' }}>
            {monthHolidays.filter((h) => h.kind === 'libur').length}
          </p>
        </div>
        <div className="flex-1 rounded-[14px] px-3 py-2.5" style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised-sm)' }}>
          <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text3)' }}>Cuti bersama</p>
          <p className="text-lg font-extrabold" style={{ color: 'var(--warn)' }}>
            {monthHolidays.filter((h) => h.kind === 'cuti').length}
          </p>
        </div>
        <div className="flex-1 rounded-[14px] px-3 py-2.5" style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised-sm)' }}>
          <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text3)' }}>Tugas</p>
          <p className="text-lg font-extrabold" style={{ color: 'var(--text)' }}>
            {monthDoneCount}/{monthTaskCount}
          </p>
        </div>
      </div>

      {!hasOfficialData(cursor.year) && (
        <div
          className="rounded-[14px] px-4 py-3 mb-4"
          style={{ background: 'var(--surface)', border: '1px solid var(--warnBorder)', boxShadow: 'var(--neu-raised-sm)' }}
        >
          <p className="text-xs font-semibold" style={{ color: 'var(--warn)' }}>
            Belum ada data libur resmi untuk {cursor.year}
          </p>
          <p className="text-[11px] mt-0.5" style={{ color: 'var(--text2)' }}>
            Tanggal merah ditetapkan lewat SKB 3 Menteri, biasanya terbit sekitar setahun sebelumnya. Tanggal
            di bulan ini tidak ditandai agar tidak menyesatkan.
          </p>
        </div>
      )}

      {upcoming && (
        <div className="rounded-[14px] px-4 py-3 mb-4" style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised-sm)' }}>
          <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text3)' }}>Libur berikutnya</p>
          <p className="text-sm font-bold mt-0.5" style={{ color: 'var(--text)' }}>{upcoming.name}</p>
          <p className="text-[11px] mt-0.5" style={{ color: 'var(--neg)' }}>
            {formatShort(upcoming.date)} · {daysBetween(today, upcoming.date)} hari lagi
          </p>
        </div>
      )}

      {/* ---- Selected day ---- */}
      <div className="rounded-[20px] p-4 mb-4" style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}>
        <p className="text-sm font-bold" style={{ color: 'var(--text)' }}>{formatLong(selected)}</p>
        <p className="text-[11px] mt-0.5" style={{ color: 'var(--text3)' }}>
          {wetonOf(selected)} · {hijri.label} (hisab)
        </p>

        {selectedHoliday && (
          <div
            className="mt-3 rounded-xl px-3 py-2.5"
            style={{
              background: selectedHoliday.kind === 'libur' ? 'rgba(192,40,26,0.12)' : 'rgba(138,83,0,0.12)',
            }}
          >
            <p
              className="text-[10px] font-bold uppercase tracking-wider"
              style={{ color: selectedHoliday.kind === 'libur' ? 'var(--neg)' : 'var(--warn)' }}
            >
              {selectedHoliday.kind === 'libur' ? 'Libur Nasional' : 'Cuti Bersama'}
            </p>
            <p className="text-sm font-bold mt-0.5" style={{ color: 'var(--text)' }}>{selectedHoliday.name}</p>
          </div>
        )}

        {selectedObservances.length > 0 && (
          <div className="mt-3 flex flex-col gap-2">
            <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text3)' }}>
              Diperingati hari ini
            </p>
            {selectedObservances.map((o) => (
              <div key={o.name} className="rounded-xl px-3 py-2" style={{ background: 'var(--bg)', boxShadow: 'var(--neu-inset)' }}>
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs font-bold flex-1" style={{ color: 'var(--text)' }}>{o.name}</p>
                  <span
                    className="text-[9px] font-bold px-1.5 py-0.5 rounded flex-shrink-0"
                    style={{
                      background: o.scope === 'nasional' ? 'var(--accentSoft)' : 'var(--track)',
                      color: o.scope === 'nasional' ? 'var(--accent)' : 'var(--text2)',
                    }}
                  >
                    {o.scope === 'nasional' ? 'Nasional' : 'Internasional'}
                  </span>
                </div>
                {o.note && <p className="text-[11px] mt-1" style={{ color: 'var(--text2)' }}>{o.note}</p>}
              </div>
            ))}
          </div>
        )}

        {!selectedHoliday && selectedObservances.length === 0 && (
          <p className="text-[11px] mt-3" style={{ color: 'var(--text3)' }}>
            {isWeekend(selected)
              ? 'Akhir pekan. Tidak ada peringatan khusus pada tanggal ini.'
              : 'Tidak ada peringatan khusus pada tanggal ini.'}
          </p>
        )}
      </div>

      {/* ---- Entries + agenda ---- */}
      <div className="flex items-center justify-between mb-2">
        <p className="text-[11px] font-bold tracking-wider uppercase" style={{ color: 'var(--text2)' }}>
          Agenda {formatShort(selected)}
        </p>
        <motion.button
          onClick={() => setShowAdd((s) => !s)}
          className="neu-cta px-3 py-1.5 rounded-lg text-xs font-bold text-white"
          style={{ background: 'var(--accentFill)' }}
          whileTap={press.control}
          transition={springs.snappy}
        >
          {showAdd ? 'Tutup' : '+ Tambah'}
        </motion.button>
      </div>

      <AnimatePresence>
        {showAdd && (
          <motion.div
            className="rounded-[18px] p-4 mb-3 flex flex-col gap-3"
            style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={collapse}
          >
            <input
              className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
              style={{ background: 'var(--bg)', color: 'var(--text)', boxShadow: 'var(--neu-inset)' }}
              placeholder="Judul... misal Rapat RT"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
            />

            <div className="flex gap-2">
              {(['task', 'event', 'reminder', 'milestone'] as const).map((k) => (
                <button
                  key={k}
                  onClick={() => setKind(k)}
                  className="flex-1 py-2 rounded-xl text-[11px] font-bold"
                  style={{
                    background: kind === k ? 'var(--accentFill)' : 'var(--surface)',
                    color: kind === k ? '#FFFFFF' : 'var(--text2)',
                    boxShadow: kind === k ? 'var(--neu-pressed)' : 'var(--neu-raised-sm)',
                  }}
                >
                  {KIND_LABEL[k]}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1">
                <span className="text-[10px] uppercase font-bold" style={{ color: 'var(--text2)' }}>Jam</span>
                <input
                  type="time"
                  className="px-3 py-2 rounded-xl text-sm outline-none"
                  style={{ background: 'var(--bg)', color: 'var(--text)', boxShadow: 'var(--neu-inset)' }}
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-[10px] uppercase font-bold" style={{ color: 'var(--text2)' }}>Prioritas</span>
                <select
                  className="px-3 py-2 rounded-xl text-sm outline-none"
                  style={{ background: 'var(--bg)', color: 'var(--text)', boxShadow: 'var(--neu-inset)' }}
                  value={priority}
                  onChange={(e) => setPriority(e.target.value)}
                >
                  <option value="low">Rendah</option>
                  <option value="normal">Normal</option>
                  <option value="high">Tinggi</option>
                </select>
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-[10px] uppercase font-bold" style={{ color: 'var(--text2)' }}>Ulangi</span>
              <select
                className="px-3 py-2 rounded-xl text-sm outline-none"
                style={{ background: 'var(--bg)', color: 'var(--text)', boxShadow: 'var(--neu-inset)' }}
                value={repeat}
                onChange={(e) => setRepeat(e.target.value)}
              >
                <option value="none">Tidak berulang</option>
                <option value="daily">Setiap hari</option>
                <option value="weekly">Setiap minggu</option>
                <option value="monthly">Setiap bulan</option>
                <option value="yearly">Setiap tahun</option>
              </select>
            </div>

            <input
              className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
              style={{ background: 'var(--bg)', color: 'var(--text)', boxShadow: 'var(--neu-inset)' }}
              placeholder="Catatan (opsional)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />

            <motion.button
              className="neu-cta w-full py-2.5 rounded-xl text-sm font-semibold text-white"
              style={{ background: 'var(--accentFill)', opacity: saving ? 0.6 : 1 }}
              onClick={addEvent}
              disabled={saving}
              whileTap={press.surface}
              transition={springs.snappy}
            >
              {saving ? 'Menyimpan...' : `Simpan ke ${formatShort(selected)}`}
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>

      {loading ? (
        <div className="flex items-center justify-center py-10">
          <div
            className="w-6 h-6 rounded-full border-2 animate-spin"
            style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }}
          />
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {selectedEvents.map((ev) => (
            <div
              key={`${ev.id}-${ev.date}`}
              className="rounded-[14px] px-4 py-3 flex items-center gap-3"
              style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised-sm)' }}
            >
              {ev.kind === 'task' ? (
                <button
                  onClick={() => toggleEvent(ev)}
                  aria-label={ev.is_done ? 'Tandai belum selesai' : 'Tandai selesai'}
                  className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 text-xs font-bold"
                  style={{
                    background: ev.is_done ? 'var(--accentFill)' : 'var(--bg)',
                    color: '#FFFFFF',
                    boxShadow: ev.is_done ? 'var(--neu-pressed)' : 'var(--neu-inset)',
                  }}
                >
                  {ev.is_done ? '✓' : ''}
                </button>
              ) : (
                <span
                  className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 text-xs"
                  style={{ background: 'var(--accentSoft)', color: 'var(--accent)' }}
                >
                  {KIND_ICON[ev.kind] ?? '◆'}
                </span>
              )}

              <div className="flex-1 min-w-0">
                <p
                  className="text-sm font-semibold truncate"
                  style={{
                    color: ev.is_done ? 'var(--text3)' : 'var(--text)',
                    textDecoration: ev.is_done ? 'line-through' : 'none',
                  }}
                >
                  {ev.title}
                </p>
                <p className="text-[11px] mt-0.5" style={{ color: 'var(--text3)' }}>
                  {[
                    ev.event_time,
                    KIND_LABEL[ev.kind],
                    ev.priority === 'high' ? 'Prioritas tinggi' : null,
                    ev.repeat_rule !== 'none' ? 'Berulang' : null,
                  ].filter(Boolean).join(' · ')}
                </p>
                {ev.note && <p className="text-[11px] mt-0.5" style={{ color: 'var(--text2)' }}>{ev.note}</p>}
              </div>

              <button
                onClick={() => deleteEvent(ev.id)}
                aria-label="Hapus"
                className="w-6 h-6 flex items-center justify-center flex-shrink-0"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text3)" strokeWidth="2.5">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          ))}

          {/*
            Items owned by other modules. Read-only here on purpose: a due debt
            is edited where it lives, and a calendar that half-edits another
            module's row is how the two drift apart.
          */}
          {agenda.map((a) => (
            <div
              key={`${a.source}-${a.id}`}
              className="rounded-[14px] px-4 py-3 flex items-center gap-3"
              style={{ background: 'var(--bg)', boxShadow: 'var(--neu-inset)' }}
            >
              <span
                className="text-[9px] font-bold px-1.5 py-0.5 rounded flex-shrink-0"
                style={{ background: 'var(--track)', color: 'var(--text2)' }}
              >
                {SOURCE_LABEL[a.source] ?? a.source}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate" style={{ color: 'var(--text)' }}>{a.title}</p>
                {(a.detail || a.time) && (
                  <p className="text-[11px] mt-0.5" style={{ color: 'var(--text3)' }}>
                    {[a.time, a.detail].filter(Boolean).join(' · ')}
                  </p>
                )}
              </div>
            </div>
          ))}

          {selectedEvents.length === 0 && agenda.length === 0 && (
            <div className="py-8 text-center text-sm" style={{ color: 'var(--text3)' }}>
              Belum ada agenda pada tanggal ini
            </div>
          )}
        </div>
      )}
    </div>
  );
}
