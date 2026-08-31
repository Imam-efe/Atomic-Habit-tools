import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { springs, collapse } from '@/tokens/motion';
import { GardenPlanner, GardenRecords, type PlantingOption } from './GardenExtras';
import { apiFetch } from '@/lib/api';
import { compressImage } from '@/lib/image';
import { isNetworkError, newClientId, queueFor } from '@/lib/offlineQueue';
import { useAuthStore } from '@/stores/authStore';
import { todayISO } from '@/lib/date';
import { AiPanel } from '@/components/AiPanel';
import { isVoiceSupported, startVoiceInput, type VoiceSession } from '@/lib/voice';
import {
  LABEL_SIZES, LABEL_SIZE_TITLE, labelLayout, categoryColorRgb, labelContentLayout,
  secondaryTextColor, A4_MARGIN_MM, LABEL_GAP_MM,
  type LabelSize, type LabelColorMode,
} from '@/lib/labelPrint';
import { susunLembarKerja, type LembarKerja, type TugasKebun } from '@/lib/gardenWorksheet';

interface Plant {
  id: string;
  name: string;
  latinName: string;
  category: string;
  emoji: string;
  /** null untuk tanaman hias — tidak dipanen. */
  daysToHarvest: [number, number] | null;
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
  /** Terisi hanya untuk tanaman hias. */
  ornamental?: {
    indoor: boolean;
    bloom: string | null;
    toxic: boolean;
    toxicNote: string;
    grooming: string;
  };
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

interface FertilizePlanEntry {
  plantingId: string;
  name: string;
  emoji: string;
  phase: 'semai' | 'vegetatif' | 'generatif';
  guidance: string;
}

const PHASE_LABEL: Record<FertilizePlanEntry['phase'], string> = {
  semai: '🌱 Semai',
  vegetatif: '🌿 Vegetatif',
  generatif: '🌸 Berbunga/berbuah',
};

interface CareLog {
  id: string;
  action: string;
  date: string;
  amount: number | null;
  unit: string | null;
  note: string | null;
}

interface Photo {
  id: string;
  image: string;
  taken_date: string;
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

/** Pertanyaan siap-pakai — satu ketuk untuk sudut pandang insight yang berbeda. */
interface GrowthCheck {
  fromDate: string;
  toDate: string;
  gapDays: number;
  verdict: string;
  observation: string;
  concern: string;
  action: string;
}

const GROWTH_LABEL: Record<string, string> = {
  'tumbuh-baik': '✅ Tumbuh baik',
  lambat: '🐌 Pertumbuhan lambat',
  bermasalah: '⚠️ Ada masalah',
};

const GROWTH_COLOR: Record<string, string> = {
  'tumbuh-baik': 'var(--pos)',
  lambat: 'var(--warn)',
  bermasalah: 'var(--neg)',
};

const QUICK_QUESTIONS = [
  'Kapan waktu terbaik panen?',
  'Kenapa pertumbuhannya lambat?',
  'Apa risiko hama sekarang?',
  'Bagaimana pola siram & pupukku?',
];

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

export function Garden() {
  const [tab, setTab] = useState<'kebun' | 'jadwal' | 'katalog' | 'rencana' | 'catatan'>('kebun');
  const [data, setData] = useState<GardenResponse | null>(null);
  const [schedule, setSchedule] = useState<ScheduleResponse | null>(null);
  const [fertilizePlan, setFertilizePlan] = useState<FertilizePlanEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const fertilizeByPlanting = new Map(fertilizePlan.map((f) => [f.plantingId, f]));

  // Bentuk ringkas untuk tab Rencana dan Catatan — keduanya hanya butuh id,
  // label, dan id katalognya.
  const plantingOptions: PlantingOption[] = (data?.plantings ?? []).map(p => ({
    id: p.id,
    label: p.nickname || p.name,
    plantId: p.plantId,
  }));

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

  // Jurnal foto — timeline pertumbuhan per tanaman.
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  // Penilaian pertumbuhan dari dua foto jurnal.
  const [growth, setGrowth] = useState<GrowthCheck | null>(null);
  const [growthLoading, setGrowthLoading] = useState(false);

  // Tanya AI bebas dengan konteks tanaman yang sedang dibuka.
  const [askQuestion, setAskQuestion] = useState('');
  const [askAnswer, setAskAnswer] = useState('');
  const [asking, setAsking] = useState(false);

  // Catatan suara: dikte catatan perawatan (catatan/pangkas/semprot) alih-alih
  // mengetik — kebun adalah tempat tangan biasanya kotor atau sibuk memegang alat.
  const [voiceNoteFor, setVoiceNoteFor] = useState<string | null>(null);
  const [voiceNoteText, setVoiceNoteText] = useState('');
  const [voiceListening, setVoiceListening] = useState(false);
  const [voiceSaving, setVoiceSaving] = useState(false);
  const voiceRef = useRef<VoiceSession | null>(null);
  const voiceAvailable = useRef(isVoiceSupported());

  // Diagnosis. `diagnoseOpen` terpisah dari `diagnoseFor` karena panel ini
  // juga bisa dibuka tanpa tanaman tertentu (tombol 🔬 di header).
  const [diagnoseOpen, setDiagnoseOpen] = useState(false);
  const [diagnoseFor, setDiagnoseFor] = useState<Planting | null>(null);
  const [symptoms, setSymptoms] = useState('');
  const [photo, setPhoto] = useState('');
  const [diagnosis, setDiagnosis] = useState<Diagnosis | null>(null);
  const [diagnosing, setDiagnosing] = useState(false);
  const [diagnoseError, setDiagnoseError] = useState('');

  // Cetak label — pilih tanaman & jumlah, di-pack ke layout A4.
  const [labelPrintOpen, setLabelPrintOpen] = useState(false);
  const [worksheetBusy, setWorksheetBusy] = useState(false);

  // Catatan yang belum terkirim karena jaringan mati. Antrean terikat akun
  // aktif: pindah akun tidak boleh membuat catatan milik akun lain ikut
  // terkirim dengan token yang salah.
  const userId = useAuthStore((s) => s.session?.user.id ?? '');
  const queue = useMemo(() => queueFor(userId), [userId]);
  const [pendingWrites, setPendingWrites] = useState(0);
  useEffect(() => { setPendingWrites(queue.size()); }, [queue]);

  const load = async () => {
    setLoading(true);
    try {
      const [g, s, f] = await Promise.all([
        apiFetch<GardenResponse>('/garden'),
        apiFetch<ScheduleResponse>('/garden/schedule?days=14'),
        apiFetch<{ plan: FertilizePlanEntry[] }>('/garden/fertilize-plan'),
      ]);
      setData(g);
      setSchedule(s);
      setFertilizePlan(f.plan);
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

  // Tab ini tetap ter-mount antar kunjungan, jadi perawatan yang dicatat dari
  // luar layar ini — lewat quick-add, misalnya — tidak akan terlihat sampai
  // dimuat ulang. Event yang sama dipakai Beranda untuk alasan yang sama.
  useEffect(() => {
    const onShown = (e: Event) => {
      if ((e as CustomEvent).detail === 'kebun') load();
    };
    window.addEventListener('fayolla:tab-shown', onShown);
    return () => window.removeEventListener('fayolla:tab-shown', onShown);
  }, []);

  // Kirim ulang catatan yang tertahan begitu jaringan kembali. Dicoba juga
  // sekali saat layar dibuka, karena peristiwa `online` bisa terjadi ketika
  // aplikasi sedang tertutup dan tidak akan terulang.
  useEffect(() => {
    let cancelled = false;

    const flush = async () => {
      if (queue.size() === 0) return;
      const result = await queue.flush((path, body) =>
        apiFetch(path, { method: 'POST', body: JSON.stringify(body) })
      );
      if (cancelled) return;
      setPendingWrites(result.remaining);
      if (result.sent > 0) load();
    };

    flush();
    window.addEventListener('online', flush);
    return () => {
      cancelled = true;
      window.removeEventListener('online', flush);
    };
  }, [queue]);

  const handleCare = async (plantingId: string, action: string, note?: string) => {
    // Panen boleh dicatat tanpa jumlah, tapi kalau diisi, dikirim ke backend
    // supaya hasil panen otomatis masuk ke Inventaris.
    let amount: number | undefined;
    if (action === 'panen') {
      const raw = window.prompt('Berapa kg hasil panennya? (kosongkan kalau tidak mau dicatat ke Inventaris)');
      const parsed = raw ? Number(raw.replace(',', '.')) : NaN;
      if (Number.isFinite(parsed) && parsed > 0) amount = parsed;
    }

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

    // clientId dibuat di sini, bukan di server: kalau permintaan ini gagal
    // karena jaringan lalu dikirim ulang dari antrean, server mengenali id
    // yang sama dan mengabaikan kiriman kedua alih-alih mencatat siram dobel.
    const clientId = newClientId();
    const path = `/garden/${plantingId}/care`;
    const body = { action, date: todayISO(), ...(amount ? { amount, unit: 'kg' } : {}), ...(note ? { note } : {}) };

    try {
      await apiFetch(path, { method: 'POST', body: JSON.stringify({ ...body, clientId }) });
      load();
      if (openPlanting === plantingId) loadCareLogs(plantingId);
    } catch (err) {
      if (isNetworkError(err)) {
        // Offline: catatan disimpan dan dikirim saat jaringan kembali. Layar
        // sengaja TIDAK dimuat ulang — pembaruan optimistis di atas adalah
        // gambaran paling jujur dari keadaan sekarang.
        //
        // Antrean menolak permintaan yang isinya persis sama, jadi mengetuk
        // ulang setelah aplikasi dibuka kembali (saat layar memuat data lama
        // dari server dan tanamannya kembali terlihat belum disiram) tidak
        // menambah catatan kedua.
        queue.enqueue({ clientId, path, body, queuedAt: Date.now() });
        setPendingWrites(queue.size());
      } else {
        load();
      }
    }
  };

  const openVoiceNote = (plantingId: string) => {
    setVoiceNoteFor(plantingId);
    setVoiceNoteText('');
  };

  const closeVoiceNote = () => {
    voiceRef.current?.cancel();
    voiceRef.current = null;
    setVoiceListening(false);
    setVoiceNoteFor(null);
    setVoiceNoteText('');
  };

  const toggleVoiceListening = () => {
    if (voiceListening) {
      voiceRef.current?.stop();
      return;
    }
    const session = startVoiceInput({
      onPartial: setVoiceNoteText,
      onResult: setVoiceNoteText,
      onEnd: () => {
        setVoiceListening(false);
        voiceRef.current = null;
      },
    });
    if (session) {
      voiceRef.current = session;
      setVoiceListening(true);
    }
  };

  const saveVoiceNote = async () => {
    if (!voiceNoteFor || !voiceNoteText.trim()) return;
    setVoiceSaving(true);
    try {
      await handleCare(voiceNoteFor, 'catatan', voiceNoteText.trim());
    } finally {
      setVoiceSaving(false);
      closeVoiceNote();
    }
  };

  /**
   * Ambil jadwal tujuh hari ke depan lalu cetak jadi satu lembar A4.
   *
   * Memakai endpoint jadwal yang sudah ada, bukan endpoint cetak tersendiri —
   * lembar ini harus menampilkan tugas yang sama persis dengan yang di layar,
   * dan satu sumber data adalah cara termurah memastikannya tetap begitu.
   */
  const printWorksheet = async () => {
    setWorksheetBusy(true);
    try {
      // Ketiga keranjang diambil semua. `todayDue` terpisah dari `upcoming`
      // di endpoint jadwal, dan melewatkannya berarti tugas HARI INI —
      // justru yang paling mungkin dikerjakan — hilang dari lembar cetak.
      const jadwal = await apiFetch<{
        today: string; overdue: TugasKebun[]; todayDue: TugasKebun[]; upcoming: TugasKebun[];
      }>('/garden/schedule?days=7');
      const lembar = susunLembarKerja(
        [...jadwal.overdue, ...jadwal.todayDue, ...jadwal.upcoming],
        jadwal.today
      );
      const doc = await buildWorksheetPdf(lembar);
      doc.save(`lembar-kerja-kebun-${jadwal.today}.pdf`);
    } catch {
      // Sengaja senyap seperti tombol cetak label: kegagalannya sudah terlihat
      // dari tidak adanya berkas yang tersimpan.
    } finally {
      setWorksheetBusy(false);
    }
  };

  const loadCareLogs = async (plantingId: string) => {
    try {
      setCareLogs(await apiFetch<CareLog[]>(`/garden/${plantingId}/care`));
    } catch {
      setCareLogs([]);
    }
  };

  const loadPhotos = async (plantingId: string) => {
    try {
      const res = await apiFetch<{ photos: Photo[] }>(`/garden/${plantingId}/photos`);
      // Timeline dibaca kiri-ke-kanan dari semai ke sekarang — kebalikan
      // dari urutan endpoint (terbaru dulu) yang cocok untuk daftar riwayat.
      setPhotos([...res.photos].reverse());
    } catch {
      setPhotos([]);
    }
  };

  const toggleDetail = (plantingId: string) => {
    if (openPlanting === plantingId) {
      setOpenPlanting(null);
      return;
    }
    setOpenPlanting(plantingId);
    setInsight('');
    setAskQuestion('');
    setAskAnswer('');
    // Tanpa ini, penilaian pertumbuhan tanaman sebelumnya ikut terbawa dan
    // terbaca sebagai penilaian tanaman yang baru dibuka.
    setGrowth(null);
    loadCareLogs(plantingId);
    loadPhotos(plantingId);
  };

  const handleAsk = async (plantingId: string, questionOverride?: string) => {
    const question = (questionOverride ?? askQuestion).trim();
    if (!question) return;
    setAsking(true);
    setAskAnswer('');
    try {
      const res = await apiFetch<{ answer: string }>(`/garden/${plantingId}/ask`, {
        method: 'POST',
        body: JSON.stringify({ question }),
      });
      setAskAnswer(res.answer);
    } catch {
      setAskAnswer('Gagal menjawab. Coba lagi nanti.');
    }
    setAsking(false);
  };

  const handleGrowthCheck = async (plantingId: string) => {
    setGrowthLoading(true);
    setGrowth(null);
    try {
      setGrowth(await apiFetch<GrowthCheck>(`/garden/${plantingId}/growth-check`, { method: 'POST' }));
    } catch {
      setGrowth({
        fromDate: '', toDate: '', gapDays: 0, verdict: 'bermasalah',
        observation: 'Gagal menilai foto. Coba lagi nanti.', concern: '', action: '',
      });
    }
    setGrowthLoading(false);
  };

  const handleAddJournalPhoto = async (plantingId: string, file: File) => {
    setUploadingPhoto(true);
    try {
      const image = await compressImage(file);
      await apiFetch(`/garden/${plantingId}/photos`, {
        method: 'POST',
        body: JSON.stringify({ image, date: todayISO() }),
      });
      await loadPhotos(plantingId);
    } catch {
      // Diam saja — jurnal foto bersifat opsional, kegagalan tidak boleh
      // mengganggu alur perawatan utama yang lebih penting.
    }
    setUploadingPhoto(false);
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
    <div className="min-h-screen px-5 pt-16 pb-tab-safe" style={{ background: 'var(--bg)' }}>
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <div className="flex-1 min-w-0">
          <h1 className="text-3xl font-extrabold tracking-tight" style={{ color: 'var(--text)', letterSpacing: '-0.6px' }}>
            Kebun
          </h1>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text2)' }}>
            Sayur & buah: jadwal siram, pupuk, panen
          </p>
          {/* Catatan yang tertahan disebut apa adanya. Diam-diam menyimpan
              tanpa memberi tahu membuat pengguna mengira datanya hilang, lalu
              mencatat ulang hal yang sama. */}
          {pendingWrites > 0 && (
            <p className="text-[10px] mt-0.5" style={{ color: 'var(--warn)' }}>
              📴 {pendingWrites} catatan menunggu jaringan — akan terkirim otomatis
            </p>
          )}
        </div>
        <motion.button
          className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 text-base"
          style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}
          whileTap={{ scale: 0.9 }}
          onClick={() => setLabelPrintOpen(true)}
          title="Cetak label tanaman"
        >
          🏷️
        </motion.button>
        <motion.button
          className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 text-base"
          style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)', opacity: worksheetBusy ? 0.6 : 1 }}
          whileTap={{ scale: 0.9 }}
          onClick={printWorksheet}
          disabled={worksheetBusy}
          title="Cetak lembar kerja minggu ini"
        >
          🗒️
        </motion.button>
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

      <AiPanel
        module="kebun"
        suggestions={['Buatkan daftar tanaman untuk pemula', 'Tanaman mana yang perlu disiram?']}
        onChanged={() => load()}
      />

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
      <div className="grid grid-cols-5 gap-1 p-1 rounded-xl mb-4"
        style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}>
        {([
          ['kebun', '🌱'],
          ['jadwal', '📅'],
          ['rencana', '🧭'],
          ['catatan', '📊'],
          ['katalog', '📖'],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className="py-2.5 rounded-lg text-base font-bold text-center"
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
                    <motion.button
                      className="flex-1 py-2 rounded-xl text-[11px] font-bold"
                      style={{ background: 'var(--bg)', color: ACTION_META.catatan.color, boxShadow: 'var(--neu-raised-sm)' }}
                      whileTap={{ scale: 0.95 }}
                      transition={springs.snappy}
                      onClick={() => openVoiceNote(p.id)}
                    >
                      {ACTION_META.catatan.emoji} {ACTION_META.catatan.label}
                    </motion.button>
                  </div>

                  {/* Catatan suara — dikte catatan perawatan (pangkas, semprot, dst)
                      tanpa mengetik, tangan sering kotor atau sibuk di kebun. */}
                  <AnimatePresence>
                    {voiceNoteFor === p.id && (
                      <motion.div
                        className="mt-2 rounded-xl p-3 flex flex-col gap-2"
                        style={{ background: 'var(--bg)', boxShadow: 'var(--neu-inset)' }}
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={collapse}
                      >
                        <div className="flex gap-2">
                          <input
                            className="flex-1 px-2.5 py-2 rounded-lg text-[11px] outline-none"
                            style={{ background: 'var(--surface)', color: 'var(--text)' }}
                            placeholder="Catatan pangkas, semprot, atau lainnya…"
                            value={voiceNoteText}
                            onChange={(e) => setVoiceNoteText(e.target.value)}
                            autoFocus
                          />
                          {voiceAvailable.current && (
                            <motion.button
                              whileTap={{ scale: 0.9 }}
                              onClick={toggleVoiceListening}
                              aria-label={voiceListening ? 'Berhenti merekam' : 'Dikte suara'}
                              aria-pressed={voiceListening}
                              className="w-9 h-9 rounded-full flex items-center justify-center text-[16px] flex-shrink-0"
                              style={{
                                background: voiceListening ? 'var(--accentFill)' : 'var(--surface)',
                                color: voiceListening ? '#fff' : 'var(--text2)',
                              }}
                            >
                              {voiceListening ? '⏹' : '🎤'}
                            </motion.button>
                          )}
                        </div>
                        <div className="flex gap-2">
                          <button
                            className="flex-1 py-2 rounded-lg text-[11px] font-semibold"
                            style={{ background: 'var(--surface)', color: 'var(--text2)' }}
                            onClick={closeVoiceNote}
                          >
                            Batal
                          </button>
                          <button
                            className="flex-1 py-2 rounded-lg text-[11px] font-bold text-white"
                            style={{ background: voiceNoteText.trim() ? 'var(--accentFill)' : 'var(--track)', opacity: voiceSaving ? 0.6 : 1 }}
                            disabled={!voiceNoteText.trim() || voiceSaving}
                            onClick={saveVoiceNote}
                          >
                            {voiceSaving ? 'Menyimpan…' : 'Simpan'}
                          </button>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

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

                        {/* Fase pertumbuhan & pupuk — hanya untuk tanaman berkatalog */}
                        {fertilizeByPlanting.get(p.id) && (
                          <div className="rounded-xl p-3" style={{ background: 'var(--bg)', boxShadow: 'var(--neu-inset)' }}>
                            <p className="text-[10px] font-extrabold uppercase tracking-wider mb-1" style={{ color: 'var(--text3)' }}>
                              {PHASE_LABEL[fertilizeByPlanting.get(p.id)!.phase]}
                            </p>
                            <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text)' }}>
                              {fertilizeByPlanting.get(p.id)!.guidance}
                            </p>
                          </div>
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
                          <p className="text-[11px] leading-relaxed whitespace-pre-line" style={{ color: insight ? 'var(--text)' : 'var(--text3)' }}>
                            {insight || 'Nilai pola perawatanmu terhadap umur tanaman ini.'}
                          </p>
                        </div>

                        {/* Tanya AI bebas — konteksnya tanaman yang sama seperti Insight */}
                        <div className="rounded-xl p-3" style={{ background: 'var(--bg)', boxShadow: 'var(--neu-inset)' }}>
                          <p className="text-[10px] font-extrabold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text3)' }}>
                            💬 Tanya soal tanaman ini
                          </p>
                          <div className="flex flex-wrap gap-1.5 mb-2">
                            {QUICK_QUESTIONS.map(q => (
                              <button
                                key={q}
                                className="text-[10px] px-2 py-1 rounded-full"
                                style={{ background: 'var(--surface)', color: 'var(--text2)' }}
                                onClick={() => { setAskQuestion(q); handleAsk(p.id, q); }}
                                disabled={asking}
                              >
                                {q}
                              </button>
                            ))}
                          </div>
                          <div className="flex gap-2">
                            <input
                              className="flex-1 px-2.5 py-2 rounded-lg text-[11px] outline-none"
                              style={{ background: 'var(--surface)', color: 'var(--text)' }}
                              placeholder="Contoh: kenapa daunnya menguning?"
                              value={askQuestion}
                              onChange={(e) => setAskQuestion(e.target.value)}
                              onKeyDown={(e) => { if (e.key === 'Enter') handleAsk(p.id); }}
                            />
                            <button
                              className="neu-cta px-3 py-2 rounded-lg text-[10px] font-bold text-white flex-shrink-0"
                              style={{ background: 'var(--accentFill)', opacity: asking || !askQuestion.trim() ? 0.6 : 1 }}
                              onClick={() => handleAsk(p.id)}
                              disabled={asking || !askQuestion.trim()}
                            >
                              {asking ? '...' : 'Tanya'}
                            </button>
                          </div>
                          {askAnswer && (
                            <p className="text-[11px] leading-relaxed mt-2" style={{ color: 'var(--text)' }}>
                              {askAnswer}
                            </p>
                          )}
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

                        {/* Jurnal foto — timeline pertumbuhan */}
                        <div>
                          <div className="flex items-center justify-between mb-1.5">
                            <p className="text-[10px] font-extrabold uppercase tracking-wider" style={{ color: 'var(--text3)' }}>
                              📷 Jurnal Foto
                            </p>
                            <label
                              className="text-[10px] font-bold cursor-pointer"
                              style={{ color: uploadingPhoto ? 'var(--text3)' : 'var(--accent)' }}
                            >
                              {uploadingPhoto ? 'Mengunggah...' : '+ Tambah'}
                              <input
                                type="file"
                                accept="image/*"
                                className="hidden"
                                disabled={uploadingPhoto}
                                onChange={(e) => {
                                  const file = e.target.files?.[0];
                                  if (file) handleAddJournalPhoto(p.id, file);
                                  e.target.value = '';
                                }}
                              />
                            </label>
                          </div>
                          {photos.length === 0 ? (
                            <p className="text-[11px]" style={{ color: 'var(--text3)' }}>
                              Belum ada foto. Rekam pertumbuhannya dari semai sampai panen.
                            </p>
                          ) : (
                            <div className="flex gap-2 overflow-x-auto pb-1">
                              {photos.map((photo) => {
                                const dayNum = Math.round(
                                  (new Date(`${photo.taken_date}T00:00:00`).getTime() -
                                    new Date(`${p.plantedDate}T00:00:00`).getTime()) / 86400000
                                );
                                return (
                                  <div key={photo.id} className="flex-shrink-0 flex flex-col items-center gap-1">
                                    <img
                                      src={photo.image}
                                      alt={`Hari ke-${dayNum}`}
                                      className="w-16 h-16 rounded-xl object-cover"
                                      style={{ boxShadow: 'var(--neu-raised-sm)' }}
                                    />
                                    <span className="text-[9px]" style={{ color: 'var(--text3)' }}>
                                      hari ke-{dayNum}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          )}

                          {/* Dua foto sudah cukup untuk dibandingkan — di situlah
                              jurnal foto berhenti jadi album dan mulai menjawab
                              "tanamanku maju atau jalan di tempat?". */}
                          {photos.length >= 2 && (
                            <>
                              <button
                                className="w-full mt-2 py-2 rounded-xl text-[11px] font-bold"
                                style={{
                                  background: 'var(--bg)',
                                  color: growthLoading ? 'var(--text3)' : 'var(--accent)',
                                  boxShadow: 'var(--neu-raised-sm)',
                                }}
                                onClick={() => handleGrowthCheck(p.id)}
                                disabled={growthLoading}
                              >
                                {growthLoading ? 'Membandingkan...' : '✨ Bandingkan foto pertama & terakhir'}
                              </button>
                              {growth && (
                                <div className="rounded-xl p-2.5 mt-2" style={{ background: 'var(--bg)', boxShadow: 'var(--neu-inset)' }}>
                                  <p className="text-[10px] font-bold uppercase tracking-wide"
                                    style={{ color: GROWTH_COLOR[growth.verdict] ?? 'var(--text2)' }}>
                                    {GROWTH_LABEL[growth.verdict] ?? growth.verdict} · rentang {growth.gapDays} hari
                                  </p>
                                  <p className="text-[11px] leading-relaxed mt-1" style={{ color: 'var(--text)' }}>
                                    {growth.observation}
                                  </p>
                                  {growth.concern && (
                                    <p className="text-[11px] leading-relaxed mt-1" style={{ color: 'var(--warn)' }}>
                                      ⚠️ {growth.concern}
                                    </p>
                                  )}
                                  {growth.action && (
                                    <p className="text-[11px] leading-relaxed mt-1" style={{ color: 'var(--text2)' }}>
                                      → {growth.action}
                                    </p>
                                  )}
                                </div>
                              )}
                            </>
                          )}
                        </div>

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
      ) : tab === 'rencana' ? (
        /* ────────────────────────── TAB RENCANA ────────────────────────── */
        <GardenPlanner plantings={plantingOptions} />
      ) : tab === 'catatan' ? (
        /* ────────────────────────── TAB CATATAN ────────────────────────── */
        <GardenRecords plantings={plantingOptions} />
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
                      {plant.daysToHarvest
                        ? `Panen ${plant.daysToHarvest[0]}–${plant.daysToHarvest[1]} hari`
                        : plant.ornamental?.indoor ? 'Hias, bisa dalam ruangan' : 'Hias, di luar ruangan'}
                      {' · siram tiap '}{plant.waterIntervalDays} hari
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
            className="fixed inset-0 z-sheet flex items-end justify-center bg-black/60 backdrop-blur-sm"
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
                  openPlant.daysToHarvest
                    ? ['Umur panen', `${openPlant.daysToHarvest[0]}–${openPlant.daysToHarvest[1]} hari`]
                    : ['Jenis', openPlant.ornamental?.indoor ? 'Hias, dalam ruangan' : 'Hias, luar ruangan'],
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
                  ['Berbunga', openPlant.ornamental?.bloom ?? ''],
                  ['Perawatan rutin', openPlant.ornamental?.grooming ?? ''],
                  ['Tips', openPlant.tips],
                ] as const).map(([label, value]) => value ? (
                  <div key={label}>
                    <p className="text-[10px] font-extrabold uppercase tracking-wider mb-0.5" style={{ color: 'var(--text3)' }}>{label}</p>
                    <p className="text-[12px] leading-relaxed" style={{ color: 'var(--text)' }}>{value}</p>
                  </div>
                ) : null)}

                {openPlant.ornamental?.toxic && (
                  <div
                    className="rounded-xl px-3 py-2.5"
                    style={{ background: 'var(--bg)', boxShadow: 'var(--neu-inset)' }}
                  >
                    <p className="text-[10px] font-extrabold uppercase tracking-wider mb-0.5" style={{ color: 'var(--neg)' }}>
                      Beracun
                    </p>
                    <p className="text-[12px] leading-relaxed" style={{ color: 'var(--neg)' }}>
                      {openPlant.ornamental.toxicNote}
                    </p>
                  </div>
                )}

                {openPlant.ornamental && !openPlant.ornamental.toxic && (
                  <div>
                    <p className="text-[10px] font-extrabold uppercase tracking-wider mb-0.5" style={{ color: 'var(--text3)' }}>
                      Keamanan
                    </p>
                    <p className="text-[12px] leading-relaxed" style={{ color: 'var(--text)' }}>
                      {openPlant.ornamental.toxicNote}
                    </p>
                  </div>
                )}

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
            className="fixed inset-0 z-sheet flex items-center justify-center p-5 bg-black/60 backdrop-blur-sm"
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
                  {plantingFor.daysToHarvest
                    ? `Perkiraan panen ${plantingFor.daysToHarvest[0]} hari dari tanggal tanam`
                    : 'Tanaman hias — dijadwalkan siram dan pupuk, tanpa jadwal panen'}
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

      <AnimatePresence>
        {labelPrintOpen && (
          <LabelPrintSheet
            plantings={(data?.plantings ?? []).filter(p => p.status === 'tumbuh' || p.status === 'panen')}
            categories={categories}
            onClose={() => setLabelPrintOpen(false)}
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
      className="fixed inset-0 z-sheet flex items-end justify-center bg-black/60 backdrop-blur-sm"
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

/** Format tanggal pendek untuk label — "planted_date" YYYY-MM-DD → "3 Jan 2026". */
function formatLabelDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/**
 * Bangun PDF A4 berisi label yang dipilih, dipak kecil-kecil untuk hemat kertas.
 *
 * `jspdf` diimpor dinamis di sini, bukan di puncak file — Garden.tsx dimuat
 * eager sebagai tab utama, jadi import statis akan menaikkan bundle awal
 * seluruh aplikasi meski fitur cetak label jarang dipakai.
 *
 * Ukuran dan mode warna diteruskan sebagai parameter, bukan konstanta tetap
 * seperti sebelumnya — tata letaknya (kolom, tinggi label, ukuran font)
 * berasal dari `labelLayout()` di `lib/labelPrint.ts` supaya angkanya sama
 * persis dengan yang diuji di sana.
 */
async function buildLabelsPdf(
  labels: Planting[],
  size: LabelSize,
  colorMode: LabelColorMode,
  categoryLabel: (id: string) => string
) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const layout = labelLayout(size);
  const { cols, widthMm: w, labelHmm: h, perPage, fontTitle, fontBody, fontMeta } = layout;
  const { titleY: titleYOffset, titleLineHeight, bodyLineHeight } = labelContentLayout(layout);

  // Font standar jsPDF (helvetica) cuma mengerti WinAnsi/Latin-1 — emoji
  // dilewatkan lewat sini jadi karakter acak yang berantakan (Ø>ÝÅ dst),
  // dan yang lebih parah, lebar hurufnya salah dihitung sehingga baris judul
  // meluber ke label sebelah alih-alih membungkus. Kartu tercetak tidak
  // butuh emoji untuk dikenali — nama tanaman dan aksen warna kategori sudah
  // cukup.
  const truncateToWidth = (text: string, maxWidth: number): string => {
    if (doc.getTextWidth(text) <= maxWidth) return text;
    let truncated = text;
    while (truncated.length > 1 && doc.getTextWidth(`${truncated}…`) > maxWidth) {
      truncated = truncated.slice(0, -1);
    }
    return `${truncated}…`;
  };

  labels.forEach((p, i) => {
    const posInPage = i % perPage;
    if (i > 0 && posInPage === 0) doc.addPage();

    const col = posInPage % cols;
    const row = Math.floor(posInPage / cols);
    const x = A4_MARGIN_MM + col * (w + LABEL_GAP_MM);
    const y = A4_MARGIN_MM + row * (h + LABEL_GAP_MM);

    // Mode Warna: TIDAK ADA satu pun elemen yang hitam atau abu. Garis tepi,
    // pita aksen, judul, baris isi, dan keterangan kategori semuanya
    // mengambil warna kategori tanaman itu — yang membedakan hanya
    // kepekatannya, bukan ronanya.
    //
    // Monokrom tidak pernah menyentuh peta warna kategori sama sekali —
    // bukan warna yang kebetulan gelap, tapi jalur render yang benar-benar
    // terpisah, supaya printer tinta hitam-putih tidak diam-diam boros tinta.
    const warna = colorMode === 'warna';
    const aksen = warna ? categoryColorRgb(p.category) : ([180, 180, 180] as const);
    const [ar, ag, ab] = aksen;
    // Judul dan baris isi dipisah dari warna aksen: di Monokrom aksen adalah
    // abu MUDA untuk garis tepi, memakainya sebagai warna teks akan membuat
    // judulnya nyaris tak terbaca di kertas putih.
    const [jr, jg, jb] = warna ? aksen : ([20, 20, 20] as const);
    const [sr, sg, sb] = warna ? secondaryTextColor(aksen) : ([60, 60, 60] as const);

    doc.setDrawColor(ar, ag, ab);
    doc.roundedRect(x, y, w, h, 1.5, 1.5);

    // Garis aksen tebal di tepi kiri: cara tercepat memilah label yang sudah
    // tercetak dan tergunting berdasarkan kategori, tanpa harus membaca teks.
    if (colorMode === 'warna') {
      doc.setFillColor(ar, ag, ab);
      doc.rect(x, y, 1.6, h, 'F');
    }

    const textX = x + (colorMode === 'warna' ? 4.5 : 3);
    const textWidth = w - (colorMode === 'warna' ? 7.5 : 6);
    const titleY = y + titleYOffset;

    // Judul memakai warna kategori penuh — elemen paling pekat di label.
    doc.setTextColor(jr, jg, jb);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(fontTitle);
    // Maksimal dua baris judul — nama tanaman yang sangat panjang dipotong
    // dengan elipsis alih-alih membungkus tak terbatas dan menabrak baris
    // Lokasi/Ditanam di bawahnya.
    const titleRaw = doc.splitTextToSize(p.nickname || p.name, textWidth) as string[];
    const titleLines = titleRaw.slice(0, 2);
    if (titleRaw.length > 2) {
      titleLines[1] = truncateToWidth(titleLines[1], textWidth);
    }
    titleLines.forEach((line, li) => doc.text(line, textX, titleY + li * titleLineHeight));

    // Baris isi: rona yang sama dengan judul, hanya lebih muda. Hierarkinya
    // dari kepekatan, bukan dari abu-abu.
    doc.setTextColor(sr, sg, sb);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(fontBody);
    let ly = titleY + (titleLines.length - 1) * titleLineHeight + bodyLineHeight;
    doc.text(truncateToWidth(`Lokasi: ${p.location || '-'}`, textWidth), textX, ly);
    ly += bodyLineHeight;
    doc.text(`Ditanam: ${formatLabelDate(p.plantedDate)}`, textX, ly);

    // Nama kategori hanya muncul di mode Warna, sebagai penjelas warna aksen
    // di sampingnya — di mode Monokrom baris ini tidak menambah apa pun
    // karena tidak ada warna yang perlu dijelaskan.
    if (colorMode === 'warna' && p.category) {
      ly += bodyLineHeight;
      doc.setTextColor(ar, ag, ab);
      doc.setFontSize(fontMeta);
      doc.text(truncateToWidth(categoryLabel(p.category), textWidth), textX, ly);
    }
  });

  return doc;
}

/**
 * Lembar kerja kebun mingguan, satu halaman A4 untuk dibawa ke kebun.
 *
 * Aplikasi ini sudah tahu apa yang harus dikerjakan minggu ini; yang belum
 * bisa dilakukannya adalah ikut keluar. Tangan yang basah dan berlumpur tidak
 * membuka ponsel, dan justru di situlah daftarnya dibutuhkan.
 *
 * Seluruhnya monokrom, tanpa pilihan warna seperti cetak label: lembar ini
 * dicoret pakai pensil lalu dibuang tiap minggu, jadi tinta warna hanya
 * menaikkan biaya untuk sesuatu yang umurnya tujuh hari.
 */
async function buildWorksheetPdf(lembar: LembarKerja): Promise<import('jspdf').jsPDF> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });

  const M = A4_MARGIN_MM + 4;
  const LEBAR = 210 - M * 2;
  let y = M + 4;

  doc.setTextColor(20);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('Lembar Kerja Kebun', M, y);

  y += 6;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(90);
  doc.text(`${formatLabelDate(lembar.mulai)} – ${formatLabelDate(lembar.selesai)}`, M, y);
  doc.text(`${lembar.totalTugas} tugas`, M + LEBAR, y, { align: 'right' });

  y += 3;
  doc.setDrawColor(150);
  doc.line(M, y, M + LEBAR, y);
  y += 6;

  /** Satu baris tugas dengan kotak centang di kiri. */
  const barisTugas = (t: TugasKebun) => {
    doc.setDrawColor(120);
    doc.rect(M + 3, y - 3, 3.5, 3.5);
    doc.setTextColor(30);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    const lokasi = t.location ? ` · ${t.location}` : '';
    doc.text(`${AKSI_CETAK[t.action] ?? t.action}: ${t.label}${lokasi}`, M + 8.5, y);
    y += 5.5;
  };

  if (lembar.terlewat.length > 0) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(60);
    doc.text('Terlewat minggu lalu', M, y);
    y += 5.5;
    lembar.terlewat.forEach(barisTugas);
    y += 3;
  }

  for (const hari of lembar.hari) {
    // Ganti halaman sebelum judul hari, bukan di tengah daftarnya — hari yang
    // terpotong separuh membuat lembar cetak lebih sulit dibaca daripada
    // lembar kedua yang agak kosong.
    if (y > 297 - M - 20) {
      doc.addPage();
      y = M + 4;
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(60);
    doc.text(`${hari.dayName}, ${formatLabelDate(hari.date)}`, M, y);
    y += 5.5;

    if (hari.tugas.length === 0) {
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(9);
      doc.setTextColor(150);
      doc.text('— tidak ada jadwal', M + 8.5, y);
      y += 5.5;
    } else {
      hari.tugas.forEach(barisTugas);
    }
    y += 2.5;
  }

  return doc;
}

/** Kata kerja yang dicetak di lembar; log memakai kata benda pendek. */
const AKSI_CETAK: Record<string, string> = {
  siram: 'Siram',
  pupuk: 'Pupuk',
  panen: 'Panen',
};

/**
 * Cetak label kebun (#11 — susulan): pilih tanaman & jumlah label, di-pack
 * jadi grid kecil di layout A4 dan diekspor sebagai file PDF sungguhan
 * (bukan lewat print dialog browser) supaya bisa disimpan, dibagikan, atau
 * diantre cetak nanti tanpa membuka aplikasi lagi.
 *
 * Dua pengaturan cetak ditambahkan di sini, bukan ditetapkan tetap:
 *
 *   Ukuran (Kecil/Sedang/Besar) — label kecil untuk stiker semai bibit yang
 *   berdesakan, label besar untuk yang harus terbaca dari agak jauh di rak.
 *   Tiga ukuran tetap, bukan slider bebas — lihat `lib/labelPrint.ts` untuk
 *   alasannya.
 *
 *   Mode warna (Monokrom/Warna) — Monokrom untuk printer tinta hitam-putih
 *   di rumah, supaya tidak ada warna yang malah tercetak abu-abu pekat dan
 *   boros tinta. Warna menambah aksen tepi kiri per kategori tanaman, supaya
 *   label yang sudah tergunting bisa dipilah tanpa membaca teksnya satu per
 *   satu.
 */
function LabelPrintSheet({
  plantings, categories, onClose,
}: {
  plantings: Planting[];
  categories: { id: string; label: string }[];
  onClose: () => void;
}) {
  // qty 0 berarti tidak dipilih; > 0 berarti dipilih dengan jumlah label segitu.
  const [qty, setQty] = useState<Record<string, number>>({});
  const [size, setSize] = useState<LabelSize>('sedang');
  const [colorMode, setColorMode] = useState<LabelColorMode>('mono');
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState(false);

  const categoryLabel = (id: string) => categories.find(c => c.id === id)?.label ?? id;

  const setQtyFor = (id: string, next: number) => {
    setQty(prev => ({ ...prev, [id]: Math.max(0, Math.min(99, next)) }));
  };

  const toggle = (id: string) => {
    setQty(prev => ({ ...prev, [id]: prev[id] > 0 ? 0 : 1 }));
  };

  const labels: Planting[] = [];
  for (const p of plantings) {
    const n = qty[p.id] ?? 0;
    for (let i = 0; i < n; i++) labels.push(p);
  }
  const totalLabels = labels.length;
  const layout = labelLayout(size);
  const pageCount = Math.max(1, Math.ceil(totalLabels / layout.perPage));

  // Kategori yang benar-benar ikut tercetak — legenda hanya menjelaskan
  // warna yang ada di halaman, bukan seluruh delapan kategori katalog.
  const kategoriTerpilih = [...new Set(labels.map(p => p.category).filter((c): c is string => !!c))];

  const handleExport = async () => {
    if (totalLabels === 0) return;
    setExporting(true);
    setExported(false);
    try {
      const doc = await buildLabelsPdf(labels, size, colorMode, categoryLabel);
      doc.save(`label-tanaman-${todayISO()}.pdf`);
      setExported(true);
    } finally {
      setExporting(false);
    }
  };

  return (
    <motion.div
      className="fixed inset-0 z-sheet flex items-end justify-center bg-black/60 backdrop-blur-sm"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="w-full max-w-[460px] rounded-t-3xl p-5 max-h-[85vh] flex flex-col"
        style={{ background: 'var(--surface)' }}
        initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        transition={springs.smooth}
        onClick={e => e.stopPropagation()}
      >
        <p className="text-base font-extrabold mb-1" style={{ color: 'var(--text)' }}>🏷️ Cetak Label Tanaman</p>
        <p className="text-[11px] mb-4" style={{ color: 'var(--text3)' }}>
          Pilih tanaman dan jumlah label, lalu ekspor ke PDF — label dipak ke layout A4 supaya hemat kertas. File PDF bisa disimpan atau dicetak nanti.
        </p>

        <div className="flex flex-col gap-2.5 mb-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--text3)' }}>
              Ukuran label
            </p>
            <div className="grid grid-cols-3 gap-1.5">
              {LABEL_SIZES.map(s => (
                <button
                  key={s}
                  className="py-2 rounded-lg text-[11px] font-bold"
                  style={{
                    background: size === s ? 'var(--accentFill)' : 'var(--bg)',
                    color: size === s ? '#fff' : 'var(--text2)',
                    boxShadow: size === s ? 'none' : 'var(--neu-raised-sm)',
                  }}
                  onClick={() => setSize(s)}
                >
                  {LABEL_SIZE_TITLE[s]}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-[10px] font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--text3)' }}>
              Warna font & aksen
            </p>
            <div className="grid grid-cols-2 gap-1.5">
              {([
                { id: 'mono' as const, label: '⬛ Monokrom', desc: 'Hemat tinta printer hitam-putih' },
                { id: 'warna' as const, label: '🎨 Warna', desc: 'Aksen per kategori tanaman' },
              ]).map(m => (
                <button
                  key={m.id}
                  className="py-2 px-2 rounded-lg text-left"
                  style={{
                    background: colorMode === m.id ? 'var(--accentFill)' : 'var(--bg)',
                    boxShadow: colorMode === m.id ? 'none' : 'var(--neu-raised-sm)',
                  }}
                  onClick={() => setColorMode(m.id)}
                >
                  <p className="text-[11px] font-bold" style={{ color: colorMode === m.id ? '#fff' : 'var(--text)' }}>
                    {m.label}
                  </p>
                  <p className="text-[9px]" style={{ color: colorMode === m.id ? 'rgba(255,255,255,0.8)' : 'var(--text3)' }}>
                    {m.desc}
                  </p>
                </button>
              ))}
            </div>
          </div>
        </div>

        {plantings.length === 0 ? (
          <p className="text-[12px] py-6 text-center" style={{ color: 'var(--text3)' }}>
            Belum ada tanaman aktif untuk dibuatkan label.
          </p>
        ) : (
          <div className="flex flex-col gap-2 overflow-y-auto mb-4">
            {plantings.map(p => {
              const n = qty[p.id] ?? 0;
              const checked = n > 0;
              return (
                <div
                  key={p.id}
                  className="flex items-center gap-3 rounded-xl p-2.5"
                  style={{ background: 'var(--bg)', boxShadow: checked ? 'var(--neu-inset)' : 'none' }}
                >
                  <button
                    className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 text-sm"
                    style={{
                      background: checked ? 'var(--accentFill)' : 'var(--surface)',
                      color: checked ? '#fff' : 'var(--text3)',
                      boxShadow: checked ? 'none' : 'var(--neu-raised-sm)',
                    }}
                    onClick={() => toggle(p.id)}
                  >
                    {checked ? '✓' : p.emoji}
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] font-bold truncate" style={{ color: 'var(--text)' }}>
                      {p.nickname || p.name}
                    </p>
                    <p className="text-[10px] truncate" style={{ color: 'var(--text3)' }}>
                      {p.location || 'tanpa lokasi'} · {formatLabelDate(p.plantedDate)}
                    </p>
                  </div>
                  {checked && (
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <button
                        className="w-6 h-6 rounded-md text-xs font-bold"
                        style={{ background: 'var(--surface)', color: 'var(--text2)', boxShadow: 'var(--neu-raised-sm)' }}
                        onClick={() => setQtyFor(p.id, n - 1)}
                      >
                        −
                      </button>
                      <span className="text-[12px] font-bold w-4 text-center" style={{ color: 'var(--text)' }}>{n}</span>
                      <button
                        className="w-6 h-6 rounded-md text-xs font-bold"
                        style={{ background: 'var(--surface)', color: 'var(--text2)', boxShadow: 'var(--neu-raised-sm)' }}
                        onClick={() => setQtyFor(p.id, n + 1)}
                      >
                        +
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {totalLabels > 0 && (
          <>
            <p className="text-[10px] mb-2" style={{ color: 'var(--text3)' }}>
              Pratinjau — {totalLabels} label, {pageCount} halaman A4 ({layout.cols} kolom)
            </p>
            <div
              className="grid gap-1.5 mb-2 p-2 rounded-xl overflow-y-auto"
              style={{
                gridTemplateColumns: `repeat(${Math.min(layout.cols, 4)}, 1fr)`,
                maxHeight: '160px', background: 'var(--bg)', boxShadow: 'var(--neu-inset)',
              }}
            >
              {labels.map((p, i) => {
                // Pratinjau memakai rumus warna yang sama persis dengan PDF-nya
                // — kalau tidak, yang terlihat di layar bukan yang tercetak.
                const warna = colorMode === 'warna';
                const aksen = warna ? categoryColorRgb(p.category) : ([180, 180, 180] as const);
                const rgb = `rgb(${aksen[0]}, ${aksen[1]}, ${aksen[2]})`;
                const sekunder = warna ? secondaryTextColor(aksen) : null;
                const judulColor = warna ? rgb : 'var(--text)';
                const isiColor = sekunder ? `rgb(${sekunder[0]}, ${sekunder[1]}, ${sekunder[2]})` : 'var(--text3)';
                return (
                  <div
                    key={`${p.id}-${i}`}
                    className="rounded-md pl-2 pr-1.5 py-1.5 flex flex-col justify-center border-l-4"
                    style={{ background: 'var(--surface)', minHeight: '46px', borderColor: warna ? rgb : 'var(--sep)' }}
                  >
                    <p className="truncate font-bold" style={{ color: judulColor, fontSize: `${Math.max(7, layout.fontTitle - 2)}px` }}>
                      {p.nickname || p.name}
                    </p>
                    <p className="truncate" style={{ color: isiColor, fontSize: `${Math.max(6, layout.fontBody - 1)}px` }}>
                      {p.location || '-'}
                    </p>
                    <p className="truncate" style={{ color: isiColor, fontSize: `${Math.max(6, layout.fontBody - 1)}px` }}>
                      {formatLabelDate(p.plantedDate)}
                    </p>
                    {warna && p.category && (
                      <p className="truncate font-semibold" style={{ color: isiColor, fontSize: `${layout.fontMeta}px` }}>
                        {categoryLabel(p.category)}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="flex flex-wrap gap-2 mb-4 px-0.5">
              {colorMode === 'warna' && kategoriTerpilih.map(cat => {
                const [r, g, b] = categoryColorRgb(cat);
                return (
                  <div key={cat} className="flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: `rgb(${r}, ${g}, ${b})` }} />
                    <span className="text-[9.5px]" style={{ color: 'var(--text3)' }}>{categoryLabel(cat)}</span>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {exported && (
          <p className="text-[11px] font-semibold mb-2 text-center" style={{ color: 'var(--pos)' }}>
            ✓ PDF tersimpan — cek folder unduhan
          </p>
        )}

        <div className="flex gap-2">
          <motion.button
            className="neu-cta flex-1 py-3 rounded-xl text-sm font-bold text-white"
            style={{ background: 'var(--accentFill)', opacity: totalLabels === 0 || exporting ? 0.6 : 1 }}
            whileTap={{ scale: 0.97 }}
            onClick={handleExport}
            disabled={totalLabels === 0 || exporting}
          >
            {exporting ? 'Membuat PDF...' : `📄 Ekspor PDF${totalLabels > 0 ? ` (${totalLabels} Label)` : ''}`}
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
