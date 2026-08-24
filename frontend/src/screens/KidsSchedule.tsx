import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { springs, collapse } from '@/tokens/motion';
import { apiFetch } from '@/lib/api';
import { useUIStore } from '@/stores/uiStore';

interface KidSchedule {
  id: string;
  kid_name: string;
  title: string;
  type: 'pelajaran' | 'aktivitas' | 'rutinitas';
  day_of_week: string | null;
  schedule_time: string | null;
  schedule_date: string | null;
  note: string | null;
}

const DAYS = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu'];
const TYPES = [
  { value: 'pelajaran', label: '📖 Pelajaran' },
  { value: 'aktivitas', label: '🎨 Aktivitas' },
  { value: 'rutinitas', label: '⏰ Rutinitas' }
];

export function KidsSchedule() {
  const { setSubScreen } = useUIStore();
  const [schedules, setSchedules] = useState<KidSchedule[]>([]);
  const [loading, setLoading] = useState(true);

  // Filter state
  const [selectedKid, setSelectedKid] = useState<string>('Semua');
  const [selectedType, setSelectedType] = useState<string>('Semua');

  // Form state
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [kidName, setKidName] = useState('');
  const [title, setTitle] = useState('');
  const [type, setType] = useState<'pelajaran' | 'aktivitas' | 'rutinitas'>('pelajaran');
  const [scheduleType, setScheduleType] = useState<'weekly' | 'date'>('weekly');
  const [dayOfWeek, setDayOfWeek] = useState('Senin');
  const [scheduleDate, setScheduleDate] = useState('');
  const [scheduleTime, setScheduleTime] = useState('08:00');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  // Extract unique kid names from schedules to build the filter options
  const uniqueKids = ['Semua', ...Array.from(new Set(schedules.map(s => s.kid_name)))];

  const load = () => {
    setLoading(true);
    apiFetch<KidSchedule[]>('/kids-schedule')
      .then(setSchedules)
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const handleSave = async () => {
    if (!kidName.trim() || !title.trim()) return;
    setSaving(true);

    const payload = {
      kid_name: kidName.trim(),
      title: title.trim(),
      type,
      day_of_week: scheduleType === 'weekly' ? dayOfWeek : null,
      schedule_date: scheduleType === 'date' ? (scheduleDate || null) : null,
      schedule_time: scheduleTime || null,
      note: note.trim() || null
    };

    try {
      if (editingId) {
        await apiFetch(`/kids-schedule/${editingId}`, {
          method: 'PUT',
          body: JSON.stringify(payload)
        });
      } else {
        await apiFetch('/kids-schedule', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
      }
      load();
      resetForm();
    } catch {}
    setSaving(false);
  };

  const handleEdit = (s: KidSchedule) => {
    setEditingId(s.id);
    setKidName(s.kid_name);
    setTitle(s.title);
    setType(s.type);
    if (s.schedule_date) {
      setScheduleType('date');
      setScheduleDate(s.schedule_date);
    } else {
      setScheduleType('weekly');
      setDayOfWeek(s.day_of_week || 'Senin');
    }
    setScheduleTime(s.schedule_time || '08:00');
    setNote(s.note || '');
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Apakah Anda yakin ingin menghapus jadwal ini?')) return;
    setSchedules(prev => prev.filter(s => s.id !== id));
    try {
      await apiFetch(`/kids-schedule/${id}`, { method: 'DELETE' });
    } catch {
      load();
    }
  };

  const resetForm = () => {
    setEditingId(null);
    setKidName('');
    setTitle('');
    setType('pelajaran');
    setScheduleType('weekly');
    setDayOfWeek('Senin');
    setScheduleDate('');
    setScheduleTime('08:00');
    setNote('');
    setShowForm(false);
  };

  const getFilteredSchedules = () => {
    return schedules.filter(s => {
      const matchKid = selectedKid === 'Semua' || s.kid_name === selectedKid;
      const matchType = selectedType === 'Semua' || s.type === selectedType;
      return matchKid && matchType;
    });
  };

  const filteredSchedules = getFilteredSchedules();

  // Group schedules by day of week or specific dates
  const groupedSchedules: Record<string, KidSchedule[]> = {};

  filteredSchedules.forEach(s => {
    const key = s.schedule_date 
      ? new Date(s.schedule_date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })
      : (s.day_of_week || 'Lainnya');
    
    if (!groupedSchedules[key]) {
      groupedSchedules[key] = [];
    }
    groupedSchedules[key].push(s);
  });

  // Sort groups: Weekly days first, then specific dates
  const sortedGroupKeys = Object.keys(groupedSchedules).sort((a, b) => {
    const aIndex = DAYS.indexOf(a);
    const bIndex = DAYS.indexOf(b);

    if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
    if (aIndex !== -1) return -1;
    if (bIndex !== -1) return 1;
    return a.localeCompare(b);
  });

  return (
    <div className="min-h-screen px-5 pt-16 pb-tab-safe" style={{ background: 'var(--bg)' }}>
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => setSubScreen(null)}
          className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
          style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}
        >
          <span style={{ color: 'var(--accent)' }} className="text-xl">‹</span>
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-extrabold tracking-tight" style={{ color: 'var(--text)', letterSpacing: '-0.5px' }}>
            Jadwal Anak
          </h1>
          <p className="text-xs" style={{ color: 'var(--text2)' }}>
            Atur rutinitas, aktivitas, & pelajaran anak
          </p>
        </div>
        <motion.button
          className="neu-cta w-10 h-10 rounded-full flex items-center justify-center"
          style={{ background: 'var(--accentFill)' }}
          whileTap={{ scale: 0.9 }}
          transition={springs.snappy}
          onClick={() => { if (showForm) resetForm(); else setShowForm(true); }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </motion.button>
      </div>

      {/* Add / Edit Form Panel */}
      <AnimatePresence>
        {showForm && (
          <motion.div
            className="rounded-[20px] p-4 mb-5"
            style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={collapse}
          >
            <p className="text-sm font-bold mb-3" style={{ color: 'var(--text)' }}>
              {editingId ? 'Edit Jadwal' : 'Tambah Jadwal Baru'}
            </p>

            <div className="flex flex-col gap-2.5">
              <input
                className="w-full px-3.5 py-2.5 rounded-xl text-sm outline-none"
                style={{ background: 'var(--bg)', color: 'var(--text)', boxShadow: 'var(--neu-inset)' }}
                placeholder="Nama Anak (contoh: Arya, Nadia)"
                value={kidName}
                onChange={e => setKidName(e.target.value)}
              />

              <input
                className="w-full px-3.5 py-2.5 rounded-xl text-sm outline-none"
                style={{ background: 'var(--bg)', color: 'var(--text)', boxShadow: 'var(--neu-inset)' }}
                placeholder="Nama Kegiatan (contoh: Matematika, Les Piano, Tidur)"
                value={title}
                onChange={e => setTitle(e.target.value)}
              />

              <div className="flex gap-2">
                {TYPES.map(t => (
                  <button
                    key={t.value}
                    type="button"
                    className="flex-1 py-2 rounded-xl text-xs font-semibold"
                    style={{
                      background: type === t.value ? 'var(--accentSoft)' : 'var(--bg)',
                      color: type === t.value ? 'var(--accent)' : 'var(--text2)',
                      border: `1px solid ${type === t.value ? 'var(--accent)' : 'var(--sep)'}`,
                    }}
                    onClick={() => setType(t.value as any)}
                  >
                    {t.label.split(' ')[1]}
                  </button>
                ))}
              </div>

              {/* Schedule Type Selection: Weekly vs Specific Date */}
              <div className="grid grid-cols-2 gap-2 p-1 rounded-xl" style={{ background: 'var(--bg)', boxShadow: 'var(--neu-inset)' }}>
                <button
                  type="button"
                  className="py-1.5 rounded-lg text-xs font-semibold"
                  style={{
                    background: scheduleType === 'weekly' ? 'var(--surface)' : 'transparent',
                    color: scheduleType === 'weekly' ? 'var(--text)' : 'var(--text3)',
                    // The well is inset, so the selected segment rises out of it.
                    boxShadow: scheduleType === 'weekly' ? 'var(--neu-raised-sm)' : 'none',
                  }}
                  onClick={() => setScheduleType('weekly')}
                >
                  Mingguan
                </button>
                <button
                  type="button"
                  className="py-1.5 rounded-lg text-xs font-semibold"
                  style={{
                    background: scheduleType === 'date' ? 'var(--surface)' : 'transparent',
                    color: scheduleType === 'date' ? 'var(--text)' : 'var(--text3)',
                    boxShadow: scheduleType === 'date' ? 'var(--neu-raised-sm)' : 'none',
                  }}
                  onClick={() => setScheduleType('date')}
                >
                  Tanggal Spesifik
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {scheduleType === 'weekly' ? (
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text3)' }}>
                      Hari
                    </label>
                    <select
                      className="w-full px-3 py-2.5 rounded-xl text-xs outline-none"
                      style={{ background: 'var(--bg)', color: 'var(--text)', boxShadow: 'var(--neu-inset)' }}
                      value={dayOfWeek}
                      onChange={e => setDayOfWeek(e.target.value)}
                    >
                      {DAYS.map(d => <option key={d} value={d}>{d}</option>)}
                    </select>
                  </div>
                ) : (
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text3)' }}>
                      Tanggal
                    </label>
                    <input
                      type="date"
                      className="w-full px-3 py-2.5 rounded-xl text-xs outline-none"
                      style={{ background: 'var(--bg)', color: 'var(--text)', boxShadow: 'var(--neu-inset)' }}
                      value={scheduleDate}
                      onChange={e => setScheduleDate(e.target.value)}
                    />
                  </div>
                )}
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text3)' }}>
                    Jam
                  </label>
                  <input
                    type="time"
                    className="w-full px-3 py-2.5 rounded-xl text-xs outline-none"
                    style={{ background: 'var(--bg)', color: 'var(--text)', boxShadow: 'var(--neu-inset)' }}
                    value={scheduleTime}
                    onChange={e => setScheduleTime(e.target.value)}
                  />
                </div>
              </div>

              <input
                className="w-full px-3.5 py-2.5 rounded-xl text-sm outline-none"
                style={{ background: 'var(--bg)', color: 'var(--text)', boxShadow: 'var(--neu-inset)' }}
                placeholder="Catatan tambahan (opsional)"
                value={note}
                onChange={e => setNote(e.target.value)}
              />

              <div className="flex gap-2 mt-2">
                <motion.button
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white"
                  style={{ background: 'var(--accentFill)', opacity: saving ? 0.6 : 1 }}
                  whileTap={{ scale: 0.97 }}
                  transition={springs.snappy}
                  onClick={handleSave}
                  disabled={saving}
                >
                  {saving ? 'Menyimpan...' : 'Simpan'}
                </motion.button>
                <motion.button
                  className="px-4 py-2.5 rounded-xl text-sm font-semibold"
                  style={{ background: 'var(--surface)', color: 'var(--text2)', boxShadow: 'var(--neu-raised-sm)' }}
                  whileTap={{ scale: 0.97 }}
                  transition={springs.snappy}
                  onClick={resetForm}
                >
                  Batal
                </motion.button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Filter Options */}
      <div className="flex flex-col gap-3 mb-5">
        {/* Kids Selector Pills */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] font-bold uppercase tracking-wider block" style={{ color: 'var(--text3)' }}>
            Pilih Anak
          </label>
          <div className="overflow-x-auto -mx-5 px-5 flex gap-1.5 scrollbar-none">
            {uniqueKids.map(kid => (
              <button
                key={kid}
                onClick={() => setSelectedKid(kid)}
                className="px-4 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all"
                style={{
                  background: selectedKid === kid ? 'var(--accentSoft)' : 'var(--surface)',
                  color: selectedKid === kid ? 'var(--accent)' : 'var(--text2)',
                  boxShadow: selectedKid === kid ? 'var(--neu-pressed)' : 'var(--neu-raised-sm)',
                }}
              >
                {kid === 'Semua' ? '👧👦 Semua Anak' : `🧒 ${kid}`}
              </button>
            ))}
          </div>
        </div>

        {/* Schedule Type Filter */}
        <div className="grid grid-cols-4 gap-1.5 p-1 rounded-xl" style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}>
          {['Semua', 'pelajaran', 'aktivitas', 'rutinitas'].map(t => (
            <button
              key={t}
              onClick={() => setSelectedType(t)}
              className="py-1.5 rounded-lg text-[10px] font-bold text-center capitalize"
              style={{
                background: selectedType === t ? 'var(--bg)' : 'transparent',
                color: selectedType === t ? 'var(--text)' : 'var(--text3)',
              }}
            >
              {t === 'pelajaran' ? '📖 Pelajaran' : t === 'aktivitas' ? '🎨 Aktivitas' : t === 'rutinitas' ? '⏰ Rutin' : 'Semua'}
            </button>
          ))}
        </div>
      </div>

      {/* Schedule Feed */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-6 h-6 rounded-full border-2 border-t-transparent animate-spin"
            style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }} />
        </div>
      ) : filteredSchedules.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="text-4xl mb-3">📅</p>
          <p className="font-semibold text-sm" style={{ color: 'var(--text2)' }}>Jadwal Kosong</p>
          <p className="text-xs" style={{ color: 'var(--text3)' }}>Belum ada jadwal yang terdaftar</p>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {sortedGroupKeys.map(dayKey => (
            <div key={dayKey} className="flex flex-col gap-2">
              <h3 className="text-xs font-bold uppercase tracking-wider pl-1" style={{ color: 'var(--accent)' }}>
                {dayKey}
              </h3>
              
              <div className="flex flex-col gap-2">
                {groupedSchedules[dayKey].map(s => {
                  const typeColors = {
                    pelajaran: { bg: 'rgba(10,132,255,0.12)', text: '#0A84FF', symbol: '📖' },
                    aktivitas: { bg: 'rgba(255,159,10,0.12)', text: 'var(--warn)', symbol: '🎨' },
                    rutinitas: { bg: 'rgba(94,92,230,0.12)', text: '#5E5CE6', symbol: '⏰' }
                  };
                  const col = typeColors[s.type] || { bg: 'var(--track)', text: 'var(--text)', symbol: '📅' };

                  return (
                    <motion.div
                      key={s.id}
                      layout="position"
                      className="rounded-2xl p-3.5 flex items-center justify-between gap-3"
                      style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}
                    >
                      <div className="w-10 h-10 rounded-xl flex-shrink-0 flex items-center justify-center text-lg"
                        style={{ background: col.bg, color: col.text }}>
                        {col.symbol}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md uppercase tracking-wider"
                            style={{ background: 'var(--surface)', color: 'var(--text2)', boxShadow: 'var(--neu-raised-sm)' }}>
                            {s.kid_name}
                          </span>
                          <span className="text-xs font-bold" style={{ color: 'var(--text3)' }}>
                            {s.schedule_time || '--:--'}
                          </span>
                        </div>
                        <h4 className="text-sm font-semibold truncate mt-1" style={{ color: 'var(--text)' }}>
                          {s.title}
                        </h4>
                        {s.note && (
                          <p className="text-xs truncate mt-0.5" style={{ color: 'var(--text3)' }}>
                            {s.note}
                          </p>
                        )}
                      </div>

                      {/* Action buttons */}
                      <div className="flex gap-1.5">
                        <motion.button
                          className="w-7 h-7 rounded-lg flex items-center justify-center"
                          style={{ background: 'var(--track)' }}
                          whileTap={{ scale: 0.85 }}
                          onClick={() => handleEdit(s)}
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text2)" strokeWidth="2.5">
                            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                            <path d="M18.5 2.5a2.121 2.121 0 113 3L12 15l-4 1 1-4 9.5-9.5z" />
                          </svg>
                        </motion.button>
                        <motion.button
                          className="w-7 h-7 rounded-lg flex items-center justify-center"
                          style={{ background: 'rgba(255,69,58,0.12)' }}
                          whileTap={{ scale: 0.85 }}
                          onClick={() => handleDelete(s.id)}
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--neg)" strokeWidth="2.5">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                          </svg>
                        </motion.button>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
