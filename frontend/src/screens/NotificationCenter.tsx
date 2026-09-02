import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { springs } from '@/tokens/motion';
import { apiFetch } from '@/lib/api';
import { useUIStore } from '@/stores/uiStore';

type ScheduleType = 'once' | 'interval' | 'daily' | 'weekly';

interface ScheduledNotification {
  id: string;
  title: string;
  body: string;
  url: string | null;
  scheduleType: ScheduleType;
  timeOfDay: string | null;
  daysOfWeek: string | null;
  intervalMinutes: number | null;
  runAt: number | null;
  quietFrom: string | null;
  quietTo: string | null;
  maxOccurrences: number | null;
  firedCount: number;
  nextRunAt: number | null;
  lastFiredAt: number | null;
  isActive: boolean;
  createdAt: number;
  summary: string;
}

interface Delivery {
  id: string;
  notificationId: string | null;
  title: string;
  body: string;
  status: string;
  detail: string | null;
  firedAt: number;
}

const JAKARTA_OFFSET = 7 * 3600;

const DAY_LABELS = [
  { value: 1, label: 'Sen' },
  { value: 2, label: 'Sel' },
  { value: 3, label: 'Rab' },
  { value: 4, label: 'Kam' },
  { value: 5, label: 'Jum' },
  { value: 6, label: 'Sab' },
  { value: 7, label: 'Min' },
];

const SCHEDULE_TABS: { value: ScheduleType; label: string }[] = [
  { value: 'interval', label: 'Interval' },
  { value: 'daily', label: 'Harian' },
  { value: 'weekly', label: 'Mingguan' },
  { value: 'once', label: 'Sekali' },
];

/** Deep-link targets a notification tap can open */
const URL_OPTIONS = [
  { value: '', label: 'Beranda' },
  { value: '/kebiasaan', label: 'Kebiasaan' },
  { value: '/kalender', label: 'Kalender' },
  { value: '/kebun', label: 'Kebun' },
  { value: '/ternak', label: 'Ternak' },
  { value: '/uang', label: 'Uang' },
  { value: '/lainnya', label: 'Lainnya' },
];

interface Preset {
  label: string;
  title: string;
  body: string;
  intervalMinutes: number;
  quietFrom: string;
  quietTo: string;
}

const PRESETS: Preset[] = [
  { label: '💧 Minum air', title: 'Waktunya Minum Air', body: 'Ambil segelas air sekarang. Target 2L hari ini!', intervalMinutes: 120, quietFrom: '22:00', quietTo: '06:00' },
  { label: '🧘 Peregangan', title: 'Waktunya Peregangan', body: 'Berdiri, regangkan badan 2 menit.', intervalMinutes: 60, quietFrom: '22:00', quietTo: '07:00' },
  { label: '👁 Istirahat mata', title: 'Istirahatkan Mata', body: 'Lihat objek jauh 20 detik (aturan 20-20-20).', intervalMinutes: 45, quietFrom: '22:00', quietTo: '07:00' },
];

/** Format a unix timestamp as Jakarta wall time, e.g. "21/08 14:30" */
function formatJakarta(unix: number): string {
  const iso = new Date((unix + JAKARTA_OFFSET) * 1000).toISOString();
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)} ${iso.slice(11, 16)}`;
}

/** Relative countdown to a future timestamp, in Indonesian */
function formatCountdown(unix: number): string {
  const diff = unix - Math.floor(Date.now() / 1000);
  if (diff <= 0) return 'segera';
  const minutes = Math.round(diff / 60);
  if (minutes < 60) return `${minutes} menit lagi`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} jam lagi`;
  return `${Math.round(hours / 24)} hari lagi`;
}

/** "YYYY-MM-DDTHH:MM" from a datetime-local input, read as Jakarta wall time */
function jakartaLocalToUnix(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [, y, m, d, h, min] = match.map(Number) as unknown as number[];
  return Math.floor(Date.UTC(y, m - 1, d, h, min) / 1000) - JAKARTA_OFFSET;
}

/** Default value for the datetime-local input: one hour from now, Jakarta time */
function defaultRunAtInput(): string {
  const target = Math.floor(Date.now() / 1000) + 3600;
  return new Date((target + JAKARTA_OFFSET) * 1000).toISOString().slice(0, 16);
}

export function NotificationCenter() {
  const { goBack } = useUIStore();

  const [items, setItems] = useState<ScheduledNotification[]>([]);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Form state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [url, setUrl] = useState('');
  const [scheduleType, setScheduleType] = useState<ScheduleType>('interval');
  const [intervalValue, setIntervalValue] = useState('60');
  const [timeOfDay, setTimeOfDay] = useState('07:00');
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [runAtInput, setRunAtInput] = useState(defaultRunAtInput);
  const [useQuiet, setUseQuiet] = useState(true);
  const [quietFrom, setQuietFrom] = useState('22:00');
  const [quietTo, setQuietTo] = useState('06:00');
  const [maxOccurrences, setMaxOccurrences] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const [list, history] = await Promise.all([
        apiFetch<ScheduledNotification[]>('/scheduled-notifications'),
        apiFetch<Delivery[]>('/scheduled-notifications/deliveries?limit=30'),
      ]);
      setItems(list);
      setDeliveries(history);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'gagal memuat pengingat');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const flash = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 2600);
  };

  const resetForm = () => {
    setEditingId(null);
    setTitle('');
    setBody('');
    setUrl('');
    setScheduleType('interval');
    setIntervalValue('60');
    setTimeOfDay('07:00');
    setDays([1, 2, 3, 4, 5]);
    setRunAtInput(defaultRunAtInput());
    setUseQuiet(true);
    setQuietFrom('22:00');
    setQuietTo('06:00');
    setMaxOccurrences('');
  };

  const openCreate = () => {
    resetForm();
    setShowForm(true);
  };

  const openEdit = (item: ScheduledNotification) => {
    setEditingId(item.id);
    setTitle(item.title);
    setBody(item.body);
    setUrl(item.url ?? '');
    setScheduleType(item.scheduleType);
    setIntervalValue(String(item.intervalMinutes ?? 60));
    setTimeOfDay(item.timeOfDay ?? '07:00');
    setDays(item.daysOfWeek ? item.daysOfWeek.split(',').map(Number) : [1, 2, 3, 4, 5]);
    setRunAtInput(
      item.runAt
        ? new Date((item.runAt + JAKARTA_OFFSET) * 1000).toISOString().slice(0, 16)
        : defaultRunAtInput()
    );
    setUseQuiet(Boolean(item.quietFrom && item.quietTo));
    setQuietFrom(item.quietFrom ?? '22:00');
    setQuietTo(item.quietTo ?? '06:00');
    setMaxOccurrences(item.maxOccurrences ? String(item.maxOccurrences) : '');
    setShowForm(true);
  };

  const applyPreset = (preset: Preset) => {
    resetForm();
    setTitle(preset.title);
    setBody(preset.body);
    setScheduleType('interval');
    setIntervalValue(String(preset.intervalMinutes));
    setUseQuiet(true);
    setQuietFrom(preset.quietFrom);
    setQuietTo(preset.quietTo);
    setShowForm(true);
  };

  const toggleDay = (day: number) => {
    setDays(prev => prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day].sort());
  };

  const save = async () => {
    if (!title.trim() || !body.trim()) {
      setError('Judul dan isi pesan wajib diisi');
      return;
    }
    if (scheduleType === 'weekly' && days.length === 0) {
      setError('Pilih minimal satu hari');
      return;
    }

    const payload: Record<string, unknown> = {
      title: title.trim(),
      body: body.trim(),
      url: url || null,
      schedule_type: scheduleType,
      quiet_from: useQuiet && scheduleType === 'interval' ? quietFrom : null,
      quiet_to: useQuiet && scheduleType === 'interval' ? quietTo : null,
      max_occurrences: maxOccurrences ? Number(maxOccurrences) : null,
    };

    if (scheduleType === 'interval') {
      const minutes = Number(intervalValue);
      if (!Number.isInteger(minutes) || minutes < 1) {
        setError('Interval minimal 1 menit');
        return;
      }
      payload.interval_minutes = minutes;
    }
    if (scheduleType === 'daily' || scheduleType === 'weekly') {
      payload.time_of_day = timeOfDay;
    }
    if (scheduleType === 'weekly') {
      payload.days_of_week = days.join(',');
    }
    if (scheduleType === 'once') {
      const unix = jakartaLocalToUnix(runAtInput);
      if (unix === null) {
        setError('Waktu tidak valid');
        return;
      }
      payload.run_at = unix;
    }

    setSaving(true);
    setError(null);
    try {
      if (editingId) {
        await apiFetch(`/scheduled-notifications/${editingId}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
      } else {
        await apiFetch('/scheduled-notifications', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }
      setShowForm(false);
      resetForm();
      await load();
      flash(editingId ? 'Pengingat diperbarui' : 'Pengingat dibuat');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'gagal menyimpan');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (item: ScheduledNotification) => {
    setBusyId(item.id);
    try {
      await apiFetch(`/scheduled-notifications/${item.id}/toggle`, { method: 'POST' });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'gagal mengubah status');
    } finally {
      setBusyId(null);
    }
  };

  const sendNow = async (item: ScheduledNotification) => {
    setBusyId(item.id);
    try {
      const res = await apiFetch<{ sent: number; subscriptions: number }>(
        `/scheduled-notifications/${item.id}/send-now`,
        { method: 'POST' }
      );
      flash(`Terkirim ke ${res.sent}/${res.subscriptions} perangkat`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'gagal mengirim');
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (item: ScheduledNotification) => {
    if (!confirm(`Hapus pengingat "${item.title}"?`)) return;
    setBusyId(item.id);
    try {
      await apiFetch(`/scheduled-notifications/${item.id}`, { method: 'DELETE' });
      await load();
      flash('Pengingat dihapus');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'gagal menghapus');
    } finally {
      setBusyId(null);
    }
  };

  const inputStyle = {
    background: 'var(--bg)',
    color: 'var(--text)',
    border: '1px solid var(--sep)',
  };

  return (
    <div
      className="min-h-screen px-5 pt-14 pb-tab-safe"
      style={{ background: 'var(--bg)' }}
    >
      <div className="flex items-center gap-3 mb-2">
        <motion.button
          className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
          style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}
          whileTap={{ scale: 0.9 }}
          transition={springs.snappy}
          onClick={goBack}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text2)" strokeWidth="2.5" strokeLinecap="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </motion.button>
        <h1 className="text-2xl font-extrabold tracking-tight" style={{ color: 'var(--text)', letterSpacing: '-0.5px' }}>
          Pusat Notifikasi
        </h1>
      </div>
      <p className="text-xs mb-5 ml-12" style={{ color: 'var(--text2)' }}>
        Pesan custom ke iPhone, jam & interval bebas
      </p>

      <AnimatePresence>
        {toast && (
          <motion.div
            className="rounded-xl px-4 py-3 mb-4 text-sm font-semibold"
            style={{ background: 'var(--accentSoft)', color: 'var(--accent)' }}
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={springs.snappy}
          >
            {toast}
          </motion.div>
        )}
      </AnimatePresence>

      {error && (
        <div
          className="rounded-xl px-4 py-3 mb-4 text-sm"
          style={{ background: 'rgba(255,69,58,0.12)', color: 'var(--neg)', border: '1px solid rgba(255,69,58,0.3)' }}
        >
          {error}
        </div>
      )}

      {/* Quick presets */}
      {!showForm && (
        <div className="mb-5">
          <p className="text-[11px] font-bold uppercase tracking-widest mb-2" style={{ color: 'var(--text3)' }}>
            Preset cepat
          </p>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {PRESETS.map(preset => (
              <motion.button
                key={preset.label}
                className="px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap flex-shrink-0"
                style={{ background: 'var(--surface)', color: 'var(--text)', boxShadow: 'var(--neu-raised)' }}
                whileTap={{ scale: 0.95 }}
                transition={springs.snappy}
                onClick={() => applyPreset(preset)}
              >
                {preset.label}
              </motion.button>
            ))}
          </div>
        </div>
      )}

      {/* Create / edit form */}
      <AnimatePresence>
        {showForm && (
          <motion.div
            className="rounded-[22px] p-5 mb-5 flex flex-col gap-3"
            style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={springs.snappy}
          >
            <h3 className="text-base font-bold" style={{ color: 'var(--text)' }}>
              {editingId ? 'Ubah Pengingat' : 'Pengingat Baru'}
            </h3>

            <input
              className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
              style={inputStyle}
              value={title}
              placeholder="Judul notifikasi"
              maxLength={120}
              onChange={e => setTitle(e.target.value)}
            />
            <textarea
              className="w-full px-3 py-2.5 rounded-xl text-sm outline-none resize-none"
              style={inputStyle}
              value={body}
              placeholder="Isi pesan..."
              rows={2}
              maxLength={500}
              onChange={e => setBody(e.target.value)}
            />

            {/* Schedule type selector */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-bold uppercase tracking-wider px-1" style={{ color: 'var(--text3)' }}>
                Jadwal
              </label>
              <div className="grid grid-cols-4 gap-1.5">
                {SCHEDULE_TABS.map(tab => (
                  <motion.button
                    key={tab.value}
                    className="py-2 rounded-lg text-xs font-semibold"
                    style={{
                      background: scheduleType === tab.value ? 'var(--accentFill)' : 'var(--bg)',
                      color: scheduleType === tab.value ? '#fff' : 'var(--text2)',
                      border: '1px solid var(--sep)',
                    }}
                    whileTap={{ scale: 0.95 }}
                    transition={springs.snappy}
                    onClick={() => setScheduleType(tab.value)}
                  >
                    {tab.label}
                  </motion.button>
                ))}
              </div>
            </div>

            {scheduleType === 'interval' && (
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold uppercase tracking-wider px-1" style={{ color: 'var(--text3)' }}>
                  Setiap berapa menit
                </label>
                <input
                  type="number"
                  min={1}
                  className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
                  style={inputStyle}
                  value={intervalValue}
                  onChange={e => setIntervalValue(e.target.value)}
                />
                <div className="flex gap-1.5 flex-wrap">
                  {[15, 30, 60, 120, 240].map(m => (
                    <button
                      key={m}
                      className="px-2.5 py-1 rounded-lg text-[11px] font-semibold"
                      style={{ background: 'var(--bg)', color: 'var(--text2)', boxShadow: 'var(--neu-inset)' }}
                      onClick={() => setIntervalValue(String(m))}
                    >
                      {m >= 60 ? `${m / 60} jam` : `${m} mnt`}
                    </button>
                  ))}
                </div>
                {Number(intervalValue) < 5 && Number(intervalValue) >= 1 && (
                  <p className="text-[11px] px-1" style={{ color: 'var(--warn)' }}>
                    Interval di bawah 5 menit berisiko dibatasi Apple — sebagian notifikasi bisa tidak sampai.
                  </p>
                )}
              </div>
            )}

            {(scheduleType === 'daily' || scheduleType === 'weekly') && (
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold uppercase tracking-wider px-1" style={{ color: 'var(--text3)' }}>
                  Pukul (WIB)
                </label>
                <input
                  type="time"
                  className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
                  style={inputStyle}
                  value={timeOfDay}
                  onChange={e => setTimeOfDay(e.target.value)}
                />
              </div>
            )}

            {scheduleType === 'weekly' && (
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold uppercase tracking-wider px-1" style={{ color: 'var(--text3)' }}>
                  Hari
                </label>
                <div className="grid grid-cols-7 gap-1">
                  {DAY_LABELS.map(day => (
                    <motion.button
                      key={day.value}
                      className="py-2 rounded-lg text-[11px] font-bold"
                      style={{
                        background: days.includes(day.value) ? 'var(--accentFill)' : 'var(--bg)',
                        color: days.includes(day.value) ? '#fff' : 'var(--text3)',
                        border: '1px solid var(--sep)',
                      }}
                      whileTap={{ scale: 0.9 }}
                      transition={springs.snappy}
                      onClick={() => toggleDay(day.value)}
                    >
                      {day.label}
                    </motion.button>
                  ))}
                </div>
              </div>
            )}

            {scheduleType === 'once' && (
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold uppercase tracking-wider px-1" style={{ color: 'var(--text3)' }}>
                  Kapan (WIB)
                </label>
                <input
                  type="datetime-local"
                  className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
                  style={inputStyle}
                  value={runAtInput}
                  onChange={e => setRunAtInput(e.target.value)}
                />
              </div>
            )}

            {/* Quiet hours — only meaningful for interval schedules */}
            {scheduleType === 'interval' && (
              <div className="flex flex-col gap-2">
                <button
                  className="flex items-center gap-2.5 text-left"
                  onClick={() => setUseQuiet(v => !v)}
                >
                  <div
                    className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0"
                    style={{
                      border: `1px solid ${useQuiet ? 'var(--accent)' : 'var(--text3)'}`,
                      background: useQuiet ? 'var(--accentFill)' : 'transparent',
                    }}
                  >
                    {useQuiet && <span className="text-[9px] text-white">✓</span>}
                  </div>
                  <span className="text-xs font-semibold" style={{ color: 'var(--text)' }}>
                    Jam senyap (jangan bunyi saat tidur)
                  </span>
                </button>
                {useQuiet && (
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="time"
                      className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
                      style={inputStyle}
                      value={quietFrom}
                      onChange={e => setQuietFrom(e.target.value)}
                    />
                    <input
                      type="time"
                      className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
                      style={inputStyle}
                      value={quietTo}
                      onChange={e => setQuietTo(e.target.value)}
                    />
                  </div>
                )}
              </div>
            )}

            {/* Deep link target */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-bold uppercase tracking-wider px-1" style={{ color: 'var(--text3)' }}>
                Buka layar saat notifikasi ditap
              </label>
              <select
                className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
                style={inputStyle}
                value={url}
                onChange={e => setUrl(e.target.value)}
              >
                {URL_OPTIONS.map(option => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>

            {/* Occurrence cap */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-bold uppercase tracking-wider px-1" style={{ color: 'var(--text3)' }}>
                Berhenti setelah N kali (opsional)
              </label>
              <input
                type="number"
                min={1}
                className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
                style={inputStyle}
                value={maxOccurrences}
                placeholder="Kosongkan = tanpa batas"
                onChange={e => setMaxOccurrences(e.target.value)}
              />
            </div>

            <div className="flex gap-2 mt-1">
              <motion.button
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white"
                style={{ background: 'var(--accentFill)', opacity: saving ? 0.6 : 1 }}
                whileTap={{ scale: 0.97 }}
                transition={springs.snappy}
                disabled={saving}
                onClick={save}
              >
                {saving ? 'Menyimpan...' : editingId ? 'Perbarui' : 'Simpan'}
              </motion.button>
              <motion.button
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold"
                style={{ background: 'var(--bg)', color: 'var(--text2)', boxShadow: 'var(--neu-inset)' }}
                whileTap={{ scale: 0.97 }}
                transition={springs.snappy}
                onClick={() => { setShowForm(false); resetForm(); setError(null); }}
              >
                Batal
              </motion.button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {!showForm && (
        <motion.button
          className="neu-cta w-full py-3 rounded-[18px] text-sm font-semibold text-white mb-5"
          style={{ background: 'var(--accentFill)' }}
          whileTap={{ scale: 0.98 }}
          transition={springs.snappy}
          onClick={openCreate}
        >
          + Buat Pengingat
        </motion.button>
      )}

      {/* Reminder list */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div
            className="w-6 h-6 rounded-full border-2 animate-spin"
            style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }}
          />
        </div>
      ) : items.length === 0 ? (
        <div
          className="rounded-[22px] p-8 text-center animate-[fyBreathe_3.5s_ease-in-out_infinite]"
          style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}
        >
          <p className="text-sm font-semibold mb-1" style={{ color: 'var(--text)' }}>Belum ada pengingat</p>
          <p className="text-xs" style={{ color: 'var(--text2)' }}>
            Pakai preset di atas, atau buat pesan sendiri.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {items.map(item => (
            <motion.div
              key={item.id}
              className="rounded-[18px] p-4"
              style={{
                background: 'var(--surface)',
                boxShadow: item.isActive ? 'var(--neu-raised)' : 'var(--neu-raised-sm)',
                opacity: item.isActive ? 1 : 0.55,
              }}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: item.isActive ? 1 : 0.55, y: 0 }}
              transition={springs.gentle}
            >
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold truncate" style={{ color: 'var(--text)' }}>{item.title}</p>
                  <p className="text-xs mt-0.5 line-clamp-2" style={{ color: 'var(--text2)' }}>{item.body}</p>
                </div>
                <motion.button
                  className="px-2.5 py-1 rounded-lg text-[10px] font-bold flex-shrink-0"
                  style={{
                    background: item.isActive ? 'var(--accentSoft)' : 'var(--bg)',
                    color: item.isActive ? 'var(--accent)' : 'var(--text3)',
                    border: '1px solid var(--sep)',
                  }}
                  whileTap={{ scale: 0.92 }}
                  transition={springs.snappy}
                  disabled={busyId === item.id}
                  onClick={() => toggleActive(item)}
                >
                  {item.isActive ? 'AKTIF' : 'JEDA'}
                </motion.button>
              </div>

              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 mb-3">
                <span className="text-[11px] font-semibold" style={{ color: 'var(--accent)' }}>
                  {item.summary}
                </span>
                {item.isActive && item.nextRunAt && (
                  <span className="text-[11px]" style={{ color: 'var(--text3)' }}>
                    · {formatJakarta(item.nextRunAt)} ({formatCountdown(item.nextRunAt)})
                  </span>
                )}
                {item.maxOccurrences && (
                  <span className="text-[11px]" style={{ color: 'var(--text3)' }}>
                    · {item.firedCount}/{item.maxOccurrences}×
                  </span>
                )}
              </div>

              <div className="flex gap-2">
                <motion.button
                  className="flex-1 py-2 rounded-lg text-[11px] font-semibold"
                  style={{ background: 'var(--bg)', color: 'var(--text)', boxShadow: 'var(--neu-inset)' }}
                  whileTap={{ scale: 0.95 }}
                  transition={springs.snappy}
                  disabled={busyId === item.id}
                  onClick={() => sendNow(item)}
                >
                  {busyId === item.id ? '...' : 'Kirim Sekarang'}
                </motion.button>
                <motion.button
                  className="flex-1 py-2 rounded-lg text-[11px] font-semibold"
                  style={{ background: 'var(--bg)', color: 'var(--text)', boxShadow: 'var(--neu-inset)' }}
                  whileTap={{ scale: 0.95 }}
                  transition={springs.snappy}
                  onClick={() => openEdit(item)}
                >
                  Ubah
                </motion.button>
                <motion.button
                  className="px-3 py-2 rounded-lg text-[11px] font-semibold"
                  style={{ background: 'var(--bg)', color: 'var(--neg)', boxShadow: 'var(--neu-inset)' }}
                  whileTap={{ scale: 0.95 }}
                  transition={springs.snappy}
                  disabled={busyId === item.id}
                  onClick={() => remove(item)}
                >
                  Hapus
                </motion.button>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Delivery history */}
      {deliveries.length > 0 && (
        <div className="mt-6">
          <button
            className="w-full flex items-center justify-between px-1 py-2"
            onClick={() => setShowHistory(v => !v)}
          >
            <span className="text-[11px] font-bold uppercase tracking-widest" style={{ color: 'var(--text3)' }}>
              Riwayat pengiriman ({deliveries.length})
            </span>
            <span style={{ color: 'var(--text3)' }}>{showHistory ? '▾' : '▸'}</span>
          </button>

          {showHistory && (
            <div
              className="rounded-[18px] overflow-hidden mt-1"
              style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}
            >
              {deliveries.map((delivery, index) => (
                <div key={delivery.id}>
                  {index > 0 && <div className="h-px mx-4" style={{ background: 'var(--sep)' }} />}
                  <div className="px-4 py-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold truncate" style={{ color: 'var(--text)' }}>
                        {delivery.title}
                      </p>
                      <p className="text-[11px]" style={{ color: 'var(--text3)' }}>
                        {formatJakarta(delivery.firedAt)}{delivery.detail ? ` · ${delivery.detail}` : ''}
                      </p>
                    </div>
                    <span
                      className="text-[10px] font-bold px-2 py-0.5 rounded flex-shrink-0"
                      style={{
                        color: delivery.status === 'sent' ? 'var(--pos)' : 'var(--warn)',
                        background: delivery.status === 'sent' ? 'rgba(52,199,89,0.15)' : 'rgba(255,159,10,0.15)',
                      }}
                    >
                      {delivery.status === 'sent' ? 'TERKIRIM' : delivery.status === 'no_subscription' ? 'NO DEVICE' : 'GAGAL'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <p className="text-[11px] mt-6 px-1 leading-relaxed" style={{ color: 'var(--text3)' }}>
        Setiap pengingat juga masuk antrian Shortcut iPhone (tipe <code>custom_reminder</code>),
        jadi bisa dipakai memicu automation di app Shortcuts.
      </p>
    </div>
  );
}
