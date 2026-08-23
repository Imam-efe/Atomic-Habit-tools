import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { springs, collapse } from '@/tokens/motion';
import { apiFetch } from '@/lib/api';
import { useUIStore } from '@/stores/uiStore';

interface Plant {
  id: string;
  name: string;
  latinName: string;
  category: string;
  emoji: string;
  daysToHarvest: [number, number];
  repeatHarvest: boolean;
  harvestEveryDays: number | null;
  waterIntervalDays: number;
  waterNote: string;
  fertilizeIntervalDays: number;
  fertilizer: string;
  sunlight: string;
  spacingCm: number;
  potLiter: number;
  difficulty: string;
  season: string;
  altitude: string;
  pests: string[];
  companions: string[];
  propagation: string;
  harvestNote: string;
  tips: string;
}

interface CareState {
  lastWater: string | null;
  nextWater: string | null;
  waterOverdueDays: number;
  lastFertilize: string | null;
  nextFertilize: string | null;
  fertilizeOverdueDays: number;
  lastHarvest: string | null;
  nextHarvest: string | null;
  harvestReady: boolean;
  ageDays: number;
  growthPercent: number;
}

interface Planting {
  id: string;
  plantId: string | null;
  name: string;
  emoji: string;
  category: string | null;
  latinName: string | null;
  nickname: string | null;
  location: string | null;
  quantity: number;
  plantingMethod: string | null;
  plantedDate: string;
  expectedHarvestDate: string | null;
  status: string;
  note: string | null;
  care: CareState;
}

interface GardenResponse {
  today: string;
  plantings: Planting[];
  summary: {
    total: number; active: number;
    needWater: number; needFertilize: number; readyToHarvest: number;
  };
}

interface DueItem {
  plantingId: string;
  name: string;
  emoji: string;
  nickname: string | null;
  location: string | null;
  action: string;
  dueDate: string;
  overdueDays: number;
}

interface ScheduleResponse {
  today: string;
  horizonDays: number;
  overdue: DueItem[];
  todayDue: DueItem[];
  upcoming: DueItem[];
}

interface CareLog {
  id: string;
  action: string;
  date: string;
  amount: number | null;
  unit: string | null;
  note: string | null;
}

interface Diagnosis {
  diagnosis: string;
  confidence: string;
  cause: string;
  treatment: string[];
  prevention: string;
  urgency: string;
}

const ACTION_META: Record<string, { label: string; emoji: string; color: string }> = {
  siram: { label: 'Siram', emoji: '💧', color: 'var(--info)' },
  pupuk: { label: 'Pupuk', emoji: '🌿', color: 'var(--pos)' },
  panen: { label: 'Panen', emoji: '🧺', color: 'var(--warn)' },
  pangkas: { label: 'Pangkas', emoji: '✂️', color: 'var(--text2)' },
  semprot: { label: 'Semprot', emoji: '🧴', color: 'var(--text2)' },
  catatan: { label: 'Catatan', emoji: '📝', color: 'var(--text2)' },
};

const STATUS_META: Record<string, { label: string; color: string }> = {
  tumbuh: { label: 'Tumbuh', color: 'var(--pos)' },
  panen: { label: 'Panen', color: 'var(--warn)' },
  selesai: { label: 'Selesai', color: 'var(--text3)' },
  gagal: { label: 'Gagal', color: 'var(--neg)' },
};

const DIFFICULTY_COLOR: Record<string, string> = {
  mudah: 'var(--pos)', sedang: 'var(--warn)', sulit: 'var(--neg)',
};

const METHODS = ['benih', 'bibit', 'stek', 'umbi'];

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatDate(iso: string): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Ags', 'Sep', 'Okt', 'Nov', 'Des'];
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${months[m - 1]} ${y}`;
}

/** Beda hari dari hari ini, untuk label "3 hari lagi" / "telat 2 hari". */
function relativeLabel(iso: string, today: string): string {
  const diff = Math.round((new Date(iso).getTime() - new Date(today).getTime()) / 86400000);
  if (diff === 0) return 'hari ini';
  if (diff === 1) return 'besok';
  if (diff > 1) return `${diff} hari lagi`;
  return `telat ${Math.abs(diff)} hari`;
}

/** Kecilkan foto sebelum dikirim — model vision tidak butuh resolusi penuh. */
function compressImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('gagal membaca file'));
    reader.onload = (event) => {
      const img = new Image();
      img.onerror = () => reject(new Error('gagal memuat gambar'));
      img.onload = () => {
        const max = 1200;
        let { width, height } = img;
        if (width > height && width > max) { height *= max / width; width = max; }
        else if (height >= width && height > max) { width *= max / height; height = max; }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d')?.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.7));
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  });
}

export function Garden() {
  const { goBack } = useUIStore();
  const [tab, setTab] = useState<'kebun' | 'jadwal' | 'katalog'>('kebun');
  const [data, setData] = useState<GardenResponse | null>(null);
  const [schedule, setSchedule] = useState<ScheduleResponse | null>(null);
  const [loading, setLoading] = useState(true);

  // Katalog
  const [catalog, setCatalog] = useState<Plant[]>([]);
  const [categories, setCategories] = useState<{ id: string; label: string }[]>([]);
  const [catalogQuery, setCatalogQuery] = useState('');
  const [catalogCategory, setCatalogCategory] = useState('');
  const [openPlant, setOpenPlant] = useState<Plant | null>(null);

  // Pencarian AI untuk tanaman di luar katalog
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');

  // Form tanam
  const [plantingFor, setPlantingFor] = useState<Plant | null>(null);
  const [formNickname, setFormNickname] = useState('');
  const [formLocation, setFormLocation] = useState('');
  const [formQuantity, setFormQuantity] = useState('1');
  const [formMethod, setFormMethod] = useState('benih');
  const [formDate, setFormDate] = useState(todayISO());
  const [formNote, setFormNote] = useState('');
  const [saving, setSaving] = useState(false);

  // Detail tanaman yang dibuka
  const [openPlanting, setOpenPlanting] = useState<string | null>(null);
  const [careLogs, setCareLogs] = useState<CareLog[]>([]);
  const [insight, setInsight] = useState<string>('');
  const [insightLoading, setInsightLoading] = useState(false);

  // Diagnosis. `diagnoseOpen` terpisah dari `diagnoseFor` karena panel ini
  // juga bisa dibuka tanpa tanaman tertentu (tombol 🔬 di header).
  const [diagnoseOpen, setDiagnoseOpen] = useState(false);
  const [diagnoseFor, setDiagnoseFor] = useState<Planting | null>(null);
  const [symptoms, setSymptoms] = useState('');
  const [photo, setPhoto] = useState('');
  const [diagnosis, setDiagnosis] = useState<Diagnosis | null>(null);
  const [diagnosing, setDiagnosing] = useState(false);
  const [diagnoseError, setDiagnoseError] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const [g, s] = await Promise.all([
        apiFetch<GardenResponse>('/garden'),
        apiFetch<ScheduleResponse>('/garden/schedule?days=14'),
      ]);
      setData(g);
      setSchedule(s);
    } catch {}
    setLoading(false);
  };

  const loadCatalog = async () => {
    try {
      const params = new URLSearchParams();
      if (catalogQuery.trim()) params.set('q', catalogQuery.trim());
      if (catalogCategory) params.set('category', catalogCategory);
      const res = await apiFetch<{ categories: { id: string; label: string }[]; plants: Plant[] }>(
        `/garden/catalog${params.toString() ? `?${params}` : ''}`
      );
      setCatalog(res.plants);
      setCategories(res.categories);
    } catch {}
  };

  useEffect(() => { load(); }, []);
  useEffect(() => { loadCatalog(); }, [catalogQuery, catalogCategory]);

  const handleCare = async (plantingId: string, action: string) => {
    // Optimistis: jadwal berikutnya digeser di layar sebelum server menjawab.
    setData(prev => prev && {
      ...prev,
      plantings: prev.plantings.map(p => p.id !== plantingId ? p : {
        ...p,
        care: {
          ...p.care,
          ...(action === 'siram' ? { lastWater: prev.today, waterOverdueDays: 0 } : {}),
          ...(action === 'pupuk' ? { lastFertilize: prev.today, fertilizeOverdueDays: 0 } : {}),
          ...(action === 'panen' ? { lastHarvest: prev.today, harvestReady: false } : {}),
        },
      }),
    });

    try {
      await apiFetch(`/garden/${plantingId}/care`, {
        method: 'POST',
        body: JSON.stringify({ action, date: todayISO() }),
      });
      load();
      if (openPlanting === plantingId) loadCareLogs(plantingId);
    } catch {
      load();
    }
  };

  const loadCareLogs = async (plantingId: string) => {
    try {
      setCareLogs(await apiFetch<CareLog[]>(`/garden/${plantingId}/care`));
    } catch {
      setCareLogs([]);
    }
  };

  const toggleDetail = (plantingId: string) => {
    if (openPlanting === plantingId) {
      setOpenPlanting(null);
      return;
    }
    setOpenPlanting(plantingId);
    setInsight('');
    loadCareLogs(plantingId);
  };

  const handleInsight = async (plantingId: string) => {
    setInsightLoading(true);
    setInsight('');
    try {
      const res = await apiFetch<{ insight: string }>(`/garden/${plantingId}/insight`, { method: 'POST' });
      setInsight(res.insight);
    } catch {
      setInsight('Gagal membuat insight. Coba lagi nanti.');
    }
    setInsightLoading(false);
  };

  const handleAiLookup = async () => {
    const name = catalogQuery.trim();
    if (!name) return;
    setAiLoading(true);
    setAiError('');
    try {
      const res = await apiFetch<{ plant: Plant }>('/garden/identify', {
        method: 'POST',
        body: JSON.stringify({ name }),
      });
      setOpenPlant(res.plant);
    } catch {
      setAiError('Tidak menemukan data tanaman itu. Coba nama lain.');
    }
    setAiLoading(false);
  };

  const openPlantingForm = (plant: Plant) => {
    setPlantingFor(plant);
    setOpenPlant(null);
    setFormNickname('');
    setFormLocation('');
    setFormQuantity('1');
    setFormMethod('benih');
    setFormDate(todayISO());
    setFormNote('');
  };

  const handlePlant = async () => {
    if (!plantingFor) return;
    setSaving(true);
    try {
      await apiFetch('/garden', {
        method: 'POST',
        body: JSON.stringify({
          plantId: plantingFor.id,
          nickname: formNickname.trim() || undefined,
          location: formLocation.trim() || undefined,
          quantity: parseInt(formQuantity) || 1,
          plantingMethod: formMethod,
          plantedDate: formDate,
          note: formNote.trim() || undefined,
        }),
      });
      setPlantingFor(null);
      setTab('kebun');
      load();
    } catch {}
    setSaving(false);
  };

  const handleDelete = async (plantingId: string) => {
    if (!confirm('Hapus tanaman ini beserta riwayat perawatannya?')) return;
    setData(prev => prev && { ...prev, plantings: prev.plantings.filter(p => p.id !== plantingId) });
    setOpenPlanting(null);
    try {
      await apiFetch(`/garden/${plantingId}`, { method: 'DELETE' });
      load();
    } catch {
      load();
    }
  };

  const handleDiagnose = async () => {
    if (!symptoms.trim() && !photo) {
      setDiagnoseError('Isi gejala atau lampirkan foto dulu.');
      return;
    }
    setDiagnosing(true);
    setDiagnoseError('');
    setDiagnosis(null);
    try {
      const res = await apiFetch<Diagnosis>('/garden/diagnose', {
        method: 'POST',
        body: JSON.stringify({
          plantingId: diagnoseFor?.id,
          symptoms: symptoms.trim() || undefined,
          image: photo || undefined,
        }),
      });
      setDiagnosis(res);
    } catch {
      setDiagnoseError('Diagnosis gagal. Coba jelaskan gejalanya lebih detail.');
    }
    setDiagnosing(false);
  };

  const openDiagnose = (planting: Planting | null) => {
    setDiagnoseFor(planting);
    setDiagnoseOpen(true);
    setSymptoms('');
    setPhoto('');
    setDiagnosis(null);
    setDiagnoseError('');
  };

  const closeDiagnose = () => {
    setDiagnoseOpen(false);
    setDiagnoseFor(null);
    setSymptoms('');
    setPhoto('');
    setDiagnosis(null);
    setDiagnoseError('');
  };

  const summary = data?.summary;
  const today = data?.today ?? todayISO();

  return (
    <div className="min-h-screen px-5 pt-14 pb-28" style={{ background: 'var(--bg)' }}>
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
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
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-extrabold tracking-tight" style={{ color: 'var(--text)', letterSpacing: '-0.5px' }}>
            Kebun
          </h1>
          <p className="text-xs" style={{ color: 'var(--text2)' }}>
            Sayur & buah: jadwal siram, pupuk, panen
          </p>
        </div>
        <motion.button
          className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 text-base"
          style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}
          whileTap={{ scale: 0.9 }}
          onClick={() => openDiagnose(null)}
          title="Diagnosis masalah tanaman"
        >
          🔬
        </motion.button>
      </div>

      {/* Ringkasan */}
      {summary && summary.total > 0 && (
        <div className="grid grid-cols-4 gap-2 mb-4">
          {[
            { label: 'Tanaman', value: summary.active, color: 'var(--text)' },
            { label: 'Siram', value: summary.needWater, color: 'var(--info)' },
            { label: 'Pupuk', value: summary.needFertilize, color: 'var(--pos)' },
            { label: 'Panen', value: summary.readyToHarvest, color: 'var(--warn)' },
          ].map(s => (
            <div key={s.label} className="rounded-[14px] py-2.5 text-center"
              style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}>
              <p className="text-lg font-black" style={{ color: s.color }}>{s.value}</p>
              <p className="text-[9px] font-bold uppercase tracking-wide" style={{ color: 'var(--text3)' }}>{s.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Tab */}
      <div className="grid grid-cols-3 gap-1.5 p-1 rounded-xl mb-4"
        style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}>
        {([
          ['kebun', '🌱 Kebun'],
          ['jadwal', '📅 Jadwal'],
          ['katalog', '📖 Katalog'],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className="py-2.5 rounded-lg text-xs font-bold text-center"
            style={{
              background: tab === id ? 'var(--bg)' : 'transparent',
              color: tab === id ? 'var(--text)' : 'var(--text3)',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-6 h-6 rounded-full border-2 border-t-transparent animate-spin"
            style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }} />
        </div>
      ) : tab === 'kebun' ? (
        /* ─────────────────────────── TAB KEBUN ─────────────────────────── */
        !data || data.plantings.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
            <p className="text-4xl">🌱</p>
            <p className="font-semibold text-sm" style={{ color: 'var(--text2)' }}>Belum ada tanaman</p>
            <p className="text-xs mb-2" style={{ color: 'var(--text3)' }}>Pilih dari katalog untuk mulai menanam</p>
            <button
              className="neu-cta px-4 py-2 rounded-xl text-xs font-bold text-white"
              style={{ background: 'var(--accentFill)' }}
              onClick={() => setTab('katalog')}
            >
              Buka Katalog
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {data.plantings.map(p => {
              const status = STATUS_META[p.status] ?? STATUS_META.tumbuh;
              const isOpen = openPlanting === p.id;
              return (
                <motion.div
                  key={p.id}
                  layout="position"
                  className="rounded-[18px] p-4"
                  style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}
                >
                  <button className="w-full text-left" onClick={() => toggleDetail(p.id)}>
                    <div className="flex items-start gap-3">
                      <span className="text-2xl flex-shrink-0" aria-hidden>{p.emoji}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="text-sm font-bold" style={{ color: 'var(--text)' }}>
                            {p.nickname || p.name}
                          </h3>
                          {/* Tanpa latar: --pos/--neg di atas --track hanya
                              mencapai 4.2–4.5:1 di tema terang, sedangkan di
                              atas surface keduanya lolos 4.5:1. */}
                          <span className="text-[9px] font-bold uppercase tracking-wide" style={{ color: status.color }}>
                            {status.label}
                          </span>
                        </div>
                        <p className="text-[11px] mt-0.5" style={{ color: 'var(--text3)' }}>
                          {p.nickname ? `${p.name} · ` : ''}{p.quantity} tanaman
                          {p.location ? ` · ${p.location}` : ''} · umur {p.care.ageDays} hari
                        </p>
                      </div>
                    </div>

                    {/* Progres menuju panen */}
                    {p.care.growthPercent > 0 && (
                      <div className="mt-2.5">
                        <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--track)' }}>
                          <motion.div
                            className="h-full rounded-full"
                            style={{ background: p.care.harvestReady ? 'var(--warn)' : 'var(--pos)' }}
                            initial={{ width: 0 }}
                            animate={{ width: `${p.care.growthPercent}%` }}
                            transition={springs.smooth}
                          />
                        </div>
                      </div>
                    )}

                    {/* Status jatuh tempo */}
                    <div className="flex flex-wrap gap-1.5 mt-2.5">
                      {/* Yang terlambat pakai negFill + teks putih; token *Fill
                          memang disediakan untuk label putih, sedangkan --neg
                          di atas --track tidak lolos 4.5:1 di tema terang. */}
                      {p.care.nextWater && (
                        <span className="text-[10px] font-semibold px-2 py-1 rounded-lg"
                          style={
                            p.care.waterOverdueDays > 0
                              ? { background: 'var(--negFill)', color: 'white' }
                              : { background: 'var(--track)', color: 'var(--text2)' }
                          }>
                          💧 {relativeLabel(p.care.nextWater, today)}
                        </span>
                      )}
                      {p.care.nextFertilize && (
                        <span className="text-[10px] font-semibold px-2 py-1 rounded-lg"
                          style={
                            p.care.fertilizeOverdueDays > 0
                              ? { background: 'var(--negFill)', color: 'white' }
                              : { background: 'var(--track)', color: 'var(--text2)' }
                          }>
                          🌿 {relativeLabel(p.care.nextFertilize, today)}
                        </span>
                      )}
                      {p.care.nextHarvest && (
                        <span className="text-[10px] font-semibold px-2 py-1 rounded-lg"
                          style={{
                            background: p.care.harvestReady ? 'var(--warnFill)' : 'var(--track)',
                            color: p.care.harvestReady ? 'white' : 'var(--text2)',
                          }}>
                          🧺 {relativeLabel(p.care.nextHarvest, today)}
                        </span>
                      )}
                    </div>
                  </button>

                  {/* Aksi cepat */}
                  <div className="flex gap-2 mt-3">
                    {(['siram', 'pupuk', 'panen'] as const).map(action => (
                      <motion.button
                        key={action}
                        className="flex-1 py-2 rounded-xl text-[11px] font-bold"
                        style={{ background: 'var(--bg)', color: ACTION_META[action].color, boxShadow: 'var(--neu-raised-sm)' }}
                        whileTap={{ scale: 0.95 }}
                        transition={springs.snappy}
                        onClick={() => handleCare(p.id, action)}
                      >
                        {ACTION_META[action].emoji} {ACTION_META[action].label}
                      </motion.button>
                    ))}
                  </div>

                  {/* Detail */}
                  <AnimatePresence>
                    {isOpen && (
                      <motion.div
                        className="mt-3 pt-3 flex flex-col gap-3"
                        style={{ borderTop: '1px solid var(--sep)' }}
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={collapse}
                      >
                        <p className="text-[11px]" style={{ color: 'var(--text2)' }}>
                          Ditanam {formatDate(p.plantedDate)}
                          {p.plantingMethod ? ` dari ${p.plantingMethod}` : ''}
                          {p.expectedHarvestDate ? ` · perkiraan panen ${formatDate(p.expectedHarvestDate)}` : ''}
                        </p>
                        {p.note && (
                          <p className="text-[11px] italic" style={{ color: 'var(--text3)' }}>📝 {p.note}</p>
                        )}

                        {/* Insight AI */}
                        <div className="rounded-xl p-3" style={{ background: 'var(--bg)', boxShadow: 'var(--neu-inset)' }}>
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <p className="text-[10px] font-extrabold uppercase tracking-wider" style={{ color: 'var(--text3)' }}>
                              ✨ Insight AI
                            </p>
                            <button
                              className="neu-cta text-[10px] font-bold px-2.5 py-1 rounded-lg text-white"
                              style={{ background: 'var(--accentFill)', opacity: insightLoading ? 0.6 : 1 }}
                              onClick={() => handleInsight(p.id)}
                              disabled={insightLoading}
                            >
                              {insightLoading ? 'Menulis...' : 'Analisa'}
                            </button>
                          </div>
                          <p className="text-[11px] leading-relaxed" style={{ color: insight ? 'var(--text)' : 'var(--text3)' }}>
                            {insight || 'Nilai pola perawatanmu terhadap umur tanaman ini.'}
                          </p>
                        </div>

                        {/* Riwayat perawatan */}
                        {careLogs.length > 0 && (
                          <div>
                            <p className="text-[10px] font-extrabold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text3)' }}>
                              Riwayat
                            </p>
                            <div className="flex flex-col gap-1">
                              {careLogs.slice(0, 8).map(log => (
                                <div key={log.id} className="flex items-center justify-between text-[11px]">
                                  <span style={{ color: 'var(--text2)' }}>
                                    {ACTION_META[log.action]?.emoji ?? '•'} {ACTION_META[log.action]?.label ?? log.action}
                                    {log.amount ? ` ${log.amount}${log.unit ? ` ${log.unit}` : ''}` : ''}
                                  </span>
                                  <span style={{ color: 'var(--text3)' }}>{formatDate(log.date)}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        <div className="flex gap-2">
                          <button
                            className="flex-1 py-2 rounded-xl text-[11px] font-bold"
                            style={{ background: 'var(--bg)', color: 'var(--text2)', boxShadow: 'var(--neu-raised-sm)' }}
                            onClick={() => openDiagnose(p)}
                          >
                            🔬 Diagnosis
                          </button>
                          <button
                            className="px-3 py-2 rounded-xl text-[11px] font-bold"
                            style={{ background: 'var(--bg)', color: 'var(--neg)', boxShadow: 'var(--neu-raised-sm)' }}
                            onClick={() => handleDelete(p.id)}
                          >
                            Hapus
                          </button>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              );
            })}
          </div>
        )
      ) : tab === 'jadwal' ? (
        /* ────────────────────────── TAB JADWAL ────────────────────────── */
        !schedule || (schedule.overdue.length + schedule.todayDue.length + schedule.upcoming.length) === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
            <p className="text-4xl">✅</p>
            <p className="font-semibold text-sm" style={{ color: 'var(--text2)' }}>Tidak ada jadwal</p>
            <p className="text-xs" style={{ color: 'var(--text3)' }}>Semua tanaman sudah terawat</p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {([
              ['Terlambat', schedule.overdue, 'var(--neg)'],
              ['Hari Ini', schedule.todayDue, 'var(--warn)'],
              [`${schedule.horizonDays} Hari ke Depan`, schedule.upcoming, 'var(--text3)'],
            ] as const).map(([title, items, color]) => items.length === 0 ? null : (
              <div key={title}>
                <p className="text-[10px] font-extrabold uppercase tracking-wider mb-2" style={{ color }}>
                  {title} ({items.length})
                </p>
                <div className="flex flex-col gap-2">
                  {items.map((d, i) => (
                    <div
                      key={`${d.plantingId}-${d.action}-${i}`}
                      className="rounded-[14px] p-3 flex items-center gap-3"
                      style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}
                    >
                      <span className="text-lg flex-shrink-0" aria-hidden>{d.emoji}</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-bold" style={{ color: 'var(--text)' }}>
                          {ACTION_META[d.action]?.emoji} {ACTION_META[d.action]?.label ?? d.action} — {d.nickname || d.name}
                        </p>
                        <p className="text-[10px]" style={{ color: 'var(--text3)' }}>
                          {formatDate(d.dueDate)} · {relativeLabel(d.dueDate, schedule.today)}
                          {d.location ? ` · ${d.location}` : ''}
                        </p>
                      </div>
                      <motion.button
                        className="px-3 py-1.5 rounded-lg text-[11px] font-bold flex-shrink-0"
                        style={{ background: 'var(--bg)', color: ACTION_META[d.action]?.color ?? 'var(--text2)', boxShadow: 'var(--neu-raised-sm)' }}
                        whileTap={{ scale: 0.95 }}
                        onClick={() => handleCare(d.plantingId, d.action)}
                      >
                        Selesai
                      </motion.button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )
      ) : (
        /* ────────────────────────── TAB KATALOG ────────────────────────── */
        <div className="flex flex-col gap-3">
          <input
            className="w-full px-3.5 py-2.5 rounded-xl text-sm outline-none"
            style={{ background: 'var(--surface)', color: 'var(--text)', boxShadow: 'var(--neu-raised)' }}
            placeholder="Cari tanaman... (cabai, tomat, jahe)"
            value={catalogQuery}
            onChange={e => { setCatalogQuery(e.target.value); setAiError(''); }}
          />

          <div className="overflow-x-auto -mx-5 px-5 flex gap-1.5 scrollbar-none">
            {[{ id: '', label: 'Semua' }, ...categories].map(cat => (
              <button
                key={cat.id || 'all'}
                onClick={() => setCatalogCategory(cat.id)}
                className="px-3.5 py-1.5 rounded-full text-[11px] font-semibold whitespace-nowrap"
                style={{
                  background: catalogCategory === cat.id ? 'var(--accentSoft)' : 'var(--surface)',
                  color: catalogCategory === cat.id ? 'var(--accent)' : 'var(--text2)',
                  boxShadow: catalogCategory === cat.id ? 'var(--neu-pressed)' : 'var(--neu-raised-sm)',
                }}
              >
                {cat.label}
              </button>
            ))}
          </div>

          {catalog.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center gap-2">
              <p className="text-3xl">🔍</p>
              <p className="text-sm font-semibold" style={{ color: 'var(--text2)' }}>Tidak ada di katalog</p>
              <p className="text-xs mb-1" style={{ color: 'var(--text3)' }}>
                {aiError || 'Cari data tanaman ini pakai AI'}
              </p>
              {catalogQuery.trim() && (
                <button
                  className="neu-cta px-4 py-2 rounded-xl text-xs font-bold text-white"
                  style={{ background: 'var(--accentFill)', opacity: aiLoading ? 0.6 : 1 }}
                  onClick={handleAiLookup}
                  disabled={aiLoading}
                >
                  {aiLoading ? 'Mencari...' : `✨ Cari "${catalogQuery.trim()}" dengan AI`}
                </button>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {catalog.map(plant => (
                <button
                  key={plant.id}
                  className="rounded-[14px] p-3 flex items-center gap-3 text-left"
                  style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}
                  onClick={() => setOpenPlant(plant)}
                >
                  <span className="text-xl flex-shrink-0" aria-hidden>{plant.emoji}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold" style={{ color: 'var(--text)' }}>{plant.name}</p>
                    <p className="text-[10px]" style={{ color: 'var(--text3)' }}>
                      Panen {plant.daysToHarvest[0]}–{plant.daysToHarvest[1]} hari · siram tiap {plant.waterIntervalDays} hari
                    </p>
                  </div>
                  <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded flex-shrink-0"
                    style={{ color: DIFFICULTY_COLOR[plant.difficulty] ?? 'var(--text2)' }}>
                    {plant.difficulty}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ───────────────────── Detail tanaman katalog ───────────────────── */}
      <AnimatePresence>
        {openPlant && (
          <motion.div
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setOpenPlant(null)}
          >
            <motion.div
              className="w-full max-w-[460px] rounded-t-3xl p-5 max-h-[85vh] overflow-y-auto"
              style={{ background: 'var(--surface)' }}
              initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
              transition={springs.smooth}
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-start gap-3 mb-4">
                <span className="text-3xl flex-shrink-0" aria-hidden>{openPlant.emoji}</span>
                <div className="min-w-0 flex-1">
                  <h2 className="text-lg font-extrabold" style={{ color: 'var(--text)' }}>{openPlant.name}</h2>
                  {openPlant.latinName && (
                    <p className="text-[11px] italic" style={{ color: 'var(--text3)' }}>{openPlant.latinName}</p>
                  )}
                </div>
                <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-lg flex-shrink-0"
                  style={{ color: DIFFICULTY_COLOR[openPlant.difficulty] ?? 'var(--text2)' }}>
                  {openPlant.difficulty}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 mb-4">
                {[
                  ['Umur panen', `${openPlant.daysToHarvest[0]}–${openPlant.daysToHarvest[1]} hari`],
                  ['Siram', `tiap ${openPlant.waterIntervalDays} hari`],
                  ['Pupuk', `tiap ${openPlant.fertilizeIntervalDays} hari`],
                  ['Matahari', openPlant.sunlight],
                  ['Jarak tanam', `${openPlant.spacingCm} cm`],
                  ['Pot minimum', openPlant.potLiter > 0 ? `${openPlant.potLiter} liter` : 'tidak cocok pot'],
                  ['Ketinggian', openPlant.altitude],
                  ['Musim', openPlant.season],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-xl p-2.5" style={{ background: 'var(--bg)', boxShadow: 'var(--neu-inset)' }}>
                    <p className="text-[9px] font-bold uppercase tracking-wide" style={{ color: 'var(--text3)' }}>{label}</p>
                    <p className="text-[11px] font-semibold" style={{ color: 'var(--text)' }}>{value}</p>
                  </div>
                ))}
              </div>

              <div className="flex flex-col gap-3 mb-4">
                {([
                  ['Perbanyakan', openPlant.propagation],
                  ['Penyiraman', openPlant.waterNote],
                  ['Pemupukan', openPlant.fertilizer],
                  ['Panen', openPlant.harvestNote],
                  ['Tips', openPlant.tips],
                ] as const).map(([label, value]) => value ? (
                  <div key={label}>
                    <p className="text-[10px] font-extrabold uppercase tracking-wider mb-0.5" style={{ color: 'var(--text3)' }}>{label}</p>
                    <p className="text-[12px] leading-relaxed" style={{ color: 'var(--text)' }}>{value}</p>
                  </div>
                ) : null)}

                {openPlant.pests.length > 0 && (
                  <div>
                    <p className="text-[10px] font-extrabold uppercase tracking-wider mb-1" style={{ color: 'var(--text3)' }}>Hama & penyakit</p>
                    <div className="flex flex-wrap gap-1.5">
                      {openPlant.pests.map(pest => (
                        <span key={pest} className="text-[10px] font-semibold px-2 py-0.5 rounded"
                          style={{ background: 'var(--track)', color: 'var(--text2)' }}>{pest}</span>
                      ))}
                    </div>
                  </div>
                )}

                {openPlant.companions.length > 0 && (
                  <div>
                    <p className="text-[10px] font-extrabold uppercase tracking-wider mb-1" style={{ color: 'var(--text3)' }}>Cocok berdampingan</p>
                    <div className="flex flex-wrap gap-1.5">
                      {openPlant.companions.map(c => (
                        <span key={c} className="text-[10px] font-semibold px-2 py-0.5 rounded"
                          style={{ color: 'var(--pos)' }}>{c}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="flex gap-2">
                <motion.button
                  className="neu-cta flex-1 py-3 rounded-xl text-sm font-bold text-white"
                  style={{ background: 'var(--accentFill)' }}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => openPlantingForm(openPlant)}
                >
                  🌱 Tanam Ini
                </motion.button>
                <button
                  className="px-4 py-3 rounded-xl text-sm font-bold"
                  style={{ background: 'var(--bg)', color: 'var(--text2)', boxShadow: 'var(--neu-raised-sm)' }}
                  onClick={() => setOpenPlant(null)}
                >
                  Tutup
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ───────────────────────── Form tanam ───────────────────────── */}
      <AnimatePresence>
        {plantingFor && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center p-5 bg-black/60 backdrop-blur-sm"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          >
            <motion.div
              className="w-full max-w-[380px] rounded-3xl p-5 flex flex-col gap-3 max-h-[85vh] overflow-y-auto"
              style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}
              initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9, y: 20 }}
            >
              <div>
                <p className="text-sm font-bold" style={{ color: 'var(--text)' }}>
                  {plantingFor.emoji} Tanam {plantingFor.name}
                </p>
                <p className="text-[11px]" style={{ color: 'var(--text2)' }}>
                  Perkiraan panen {plantingFor.daysToHarvest[0]} hari dari tanggal tanam
                </p>
              </div>

              <input
                className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
                style={{ background: 'var(--bg)', color: 'var(--text)', boxShadow: 'var(--neu-inset)' }}
                placeholder="Nama panggilan (opsional)"
                value={formNickname}
                onChange={e => setFormNickname(e.target.value)}
              />
              <input
                className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
                style={{ background: 'var(--bg)', color: 'var(--text)', boxShadow: 'var(--neu-inset)' }}
                placeholder="Lokasi (teras depan, kebun belakang)"
                value={formLocation}
                onChange={e => setFormLocation(e.target.value)}
              />

              <div className="flex gap-2">
                <input
                  type="number"
                  min="1"
                  className="flex-1 px-3 py-2.5 rounded-xl text-sm outline-none"
                  style={{ background: 'var(--bg)', color: 'var(--text)', boxShadow: 'var(--neu-inset)' }}
                  placeholder="Jumlah"
                  value={formQuantity}
                  onChange={e => setFormQuantity(e.target.value)}
                />
                <select
                  className="flex-1 px-3 py-2.5 rounded-xl text-sm outline-none"
                  style={{ background: 'var(--bg)', color: 'var(--text)', boxShadow: 'var(--neu-inset)' }}
                  value={formMethod}
                  onChange={e => setFormMethod(e.target.value)}
                >
                  {METHODS.map(m => <option key={m} value={m}>dari {m}</option>)}
                </select>
              </div>

              <div>
                <label className="text-[10px] font-bold uppercase tracking-wide mb-1 block" style={{ color: 'var(--text3)' }}>
                  Tanggal tanam
                </label>
                <input
                  type="date"
                  className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
                  style={{ background: 'var(--bg)', color: 'var(--text)', boxShadow: 'var(--neu-inset)' }}
                  value={formDate}
                  onChange={e => setFormDate(e.target.value)}
                />
              </div>

              <input
                className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
                style={{ background: 'var(--bg)', color: 'var(--text)', boxShadow: 'var(--neu-inset)' }}
                placeholder="Catatan (opsional)"
                value={formNote}
                onChange={e => setFormNote(e.target.value)}
              />

              <div className="flex gap-2 mt-1">
                <motion.button
                  className="neu-cta flex-1 py-2.5 rounded-xl text-sm font-bold text-white"
                  style={{ background: 'var(--accentFill)', opacity: saving ? 0.6 : 1 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={handlePlant}
                  disabled={saving}
                >
                  {saving ? 'Menyimpan...' : 'Tanam'}
                </motion.button>
                <button
                  className="px-4 py-2.5 rounded-xl text-sm font-bold"
                  style={{ background: 'var(--bg)', color: 'var(--text2)', boxShadow: 'var(--neu-raised-sm)' }}
                  onClick={() => setPlantingFor(null)}
                >
                  Batal
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ─────────────────────── Diagnosis masalah ─────────────────────── */}
      <AnimatePresence>
        {diagnoseOpen && (
          <DiagnosePanel
            planting={diagnoseFor}
            symptoms={symptoms}
            setSymptoms={setSymptoms}
            photo={photo}
            setPhoto={setPhoto}
            diagnosis={diagnosis}
            diagnosing={diagnosing}
            error={diagnoseError}
            setError={setDiagnoseError}
            onRun={handleDiagnose}
            onClose={closeDiagnose}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

const URGENCY_META: Record<string, { label: string; color: string }> = {
  segera: { label: 'Tangani segera', color: 'var(--neg)' },
  'minggu-ini': { label: 'Tangani minggu ini', color: 'var(--warn)' },
  pantau: { label: 'Cukup dipantau', color: 'var(--text2)' },
};

const CONFIDENCE_LABEL: Record<string, string> = {
  tinggi: 'Keyakinan tinggi', sedang: 'Keyakinan sedang', rendah: 'Keyakinan rendah',
};

function DiagnosePanel(props: {
  planting: Planting | null;
  symptoms: string;
  setSymptoms: (v: string) => void;
  photo: string;
  setPhoto: (v: string) => void;
  diagnosis: Diagnosis | null;
  diagnosing: boolean;
  error: string;
  setError: (v: string) => void;
  onRun: () => void;
  onClose: () => void;
}) {
  const { planting, symptoms, setSymptoms, photo, setPhoto, diagnosis, diagnosing, error, setError, onRun, onClose } = props;

  const handlePhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setPhoto(await compressImage(file));
      setError('');
    } catch {
      setError('Gagal memproses foto.');
    }
  };

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="w-full max-w-[460px] rounded-t-3xl p-5 max-h-[88vh] overflow-y-auto flex flex-col gap-3"
        style={{ background: 'var(--surface)' }}
        initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        transition={springs.smooth}
        onClick={e => e.stopPropagation()}
      >
        <div>
          <p className="text-base font-extrabold" style={{ color: 'var(--text)' }}>🔬 Diagnosis Tanaman</p>
          <p className="text-[11px]" style={{ color: 'var(--text2)' }}>
            {planting
              ? `${planting.emoji} ${planting.nickname || planting.name} — umur ${planting.care.ageDays} hari`
              : 'Jelaskan gejalanya, atau foto bagian yang bermasalah'}
          </p>
        </div>

        <textarea
          rows={3}
          className="w-full resize-none rounded-xl px-3 py-2.5 text-sm outline-none leading-relaxed"
          style={{ background: 'var(--bg)', color: 'var(--text)', boxShadow: 'var(--neu-inset)' }}
          placeholder="Contoh: daun menguning dari bawah, ada bintik cokelat, batang berlendir..."
          value={symptoms}
          onChange={e => setSymptoms(e.target.value)}
        />

        <div className="flex items-center gap-2">
          <label
            className="flex-1 py-2.5 rounded-xl text-xs font-bold text-center cursor-pointer"
            style={{ background: 'var(--bg)', color: 'var(--text2)', boxShadow: 'var(--neu-raised-sm)' }}
          >
            {photo ? '📷 Ganti foto' : '📷 Tambah foto'}
            <input type="file" accept="image/*" className="hidden" onChange={handlePhoto} />
          </label>
          {photo && (
            <button
              className="px-3 py-2.5 rounded-xl text-xs font-bold"
              style={{ background: 'var(--bg)', color: 'var(--neg)', boxShadow: 'var(--neu-raised-sm)' }}
              onClick={() => setPhoto('')}
            >
              Hapus
            </button>
          )}
        </div>

        {photo && (
          <img src={photo} alt="Foto tanaman" className="w-full rounded-xl max-h-48 object-cover" />
        )}

        {error && <p className="text-xs" style={{ color: 'var(--neg)' }}>{error}</p>}

        {diagnosis && (
          <div className="rounded-xl p-3.5 flex flex-col gap-2.5" style={{ background: 'var(--bg)', boxShadow: 'var(--neu-inset)' }}>
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-bold" style={{ color: 'var(--text)' }}>{diagnosis.diagnosis}</p>
              <span className="text-[9px] font-bold uppercase tracking-wide px-2 py-1 rounded flex-shrink-0"
                style={{ color: URGENCY_META[diagnosis.urgency]?.color ?? 'var(--text2)' }}>
                {URGENCY_META[diagnosis.urgency]?.label ?? diagnosis.urgency}
              </span>
            </div>
            <p className="text-[10px] font-semibold" style={{ color: 'var(--text3)' }}>
              {CONFIDENCE_LABEL[diagnosis.confidence] ?? diagnosis.confidence}
            </p>
            {diagnosis.cause && (
              <p className="text-[12px] leading-relaxed" style={{ color: 'var(--text2)' }}>{diagnosis.cause}</p>
            )}
            {diagnosis.treatment.length > 0 && (
              <div>
                <p className="text-[10px] font-extrabold uppercase tracking-wider mb-1" style={{ color: 'var(--text3)' }}>Penanganan</p>
                <ol className="flex flex-col gap-1">
                  {diagnosis.treatment.map((t, i) => (
                    <li key={i} className="text-[12px] leading-relaxed" style={{ color: 'var(--text)' }}>
                      {i + 1}. {t}
                    </li>
                  ))}
                </ol>
              </div>
            )}
            {diagnosis.prevention && (
              <div>
                <p className="text-[10px] font-extrabold uppercase tracking-wider mb-0.5" style={{ color: 'var(--text3)' }}>Pencegahan</p>
                <p className="text-[12px] leading-relaxed" style={{ color: 'var(--text2)' }}>{diagnosis.prevention}</p>
              </div>
            )}
          </div>
        )}

        <div className="flex gap-2">
          <motion.button
            className="neu-cta flex-1 py-3 rounded-xl text-sm font-bold text-white"
            style={{ background: 'var(--accentFill)', opacity: diagnosing ? 0.6 : 1 }}
            whileTap={{ scale: 0.97 }}
            onClick={onRun}
            disabled={diagnosing}
          >
            {diagnosing ? 'Menganalisa...' : diagnosis ? 'Diagnosis Ulang' : '✨ Diagnosis'}
          </motion.button>
          <button
            className="px-4 py-3 rounded-xl text-sm font-bold"
            style={{ background: 'var(--bg)', color: 'var(--text2)', boxShadow: 'var(--neu-raised-sm)' }}
            onClick={onClose}
          >
            Tutup
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
