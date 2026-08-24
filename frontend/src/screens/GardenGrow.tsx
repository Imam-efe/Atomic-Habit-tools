/**
 * Fitur kebun lanjutan: pembibitan, perkiraan panen adaptif, kalkulator
 * belanja, denah bedengan, efektivitas penanganan hama, dari-kebun-ke-piring,
 * dan laporan tahunan.
 *
 * File terpisah dari GardenExtras.tsx yang sudah panjang. Dua komponen yang
 * diekspor dipasang ke dalam tab yang sudah ada — Rencana dan Catatan — supaya
 * pengguna tidak perlu belajar navigasi baru.
 */

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { springs } from '@/tokens/motion';
import { apiFetch, ApiError } from '@/lib/api';
import type { PlantingOption } from './GardenExtras';

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <motion.div
      className="rounded-[18px] p-4 mb-3 flex flex-col gap-2.5"
      style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={springs.gentle}
    >
      <div className="text-sm font-bold" style={{ color: 'var(--text)' }}>{title}</div>
      {children}
    </motion.div>
  );
}

const describeError = (err: unknown, fallback: string) =>
  err instanceof ApiError ? (err.body.message ?? err.body.error ?? fallback) : 'Terjadi kesalahan jaringan.';

const rupiah = (n: number) => `Rp${Math.round(n).toLocaleString('id-ID')}`;

const inputStyle = {
  background: 'var(--bg)',
  color: 'var(--text)',
  boxShadow: 'var(--neu-inset)',
} as const;

// ─────────────────────────── TIPE RESPONS ───────────────────────────

interface Forecast {
  plantingId: string;
  name: string;
  emoji: string;
  baselineDate: string;
  estimatedDate: string;
  shiftDays: number;
  confidence: string;
  reason: string;
  overdueDays: number;
}

interface SupplyNeed {
  id: string;
  label: string;
  amount: number;
  unit: string;
  basis: string;
}

interface BedSlotView {
  plantingId: string;
  name: string;
  posX: number;
  posY: number;
  spacingCm: number;
}

interface BedIssue {
  kind: string;
  plantingIds: string[];
  message: string;
}

interface BedView {
  id: string;
  name: string;
  widthCm: number;
  lengthCm: number;
  note: string | null;
  slots: BedSlotView[];
  report: { slotCount: number; usedPercent: number; issues: BedIssue[] };
}

interface Sowing {
  id: string;
  name: string;
  emoji: string;
  brand: string | null;
  sownDate: string;
  seedCount: number;
  germinatedCount: number | null;
  transplantedDate: string | null;
}

interface SourceScore {
  brand: string;
  batches: number;
  seedsSown: number;
  ratePercent: number;
  reliable: boolean;
}

interface SowingsResponse {
  sowings: Sowing[];
  summary: {
    totalBatches: number;
    pendingCount: number;
    overallRatePercent: number | null;
    readyToTransplant: number;
  };
  sources: SourceScore[];
}

interface TreatmentScore {
  pest: string;
  treatment: string;
  tried: number;
  worked: number;
  successPercent: number;
  avgDaysToResolve: number | null;
}

interface PendingReview {
  id: string | null;
  pest: string;
  treatment: string | null;
  spottedDate: string;
  daysSince: number;
}

interface KitchenReport {
  items: Array<{ name: string; amount: number; unit: string; valueIdr: number | null }>;
  harvestValueIdr: number;
  foodSpendIdr: number;
  selfSufficiencyPercent: number | null;
  unpricedHarvests: string[];
}

interface AnnualReport {
  year: string;
  plantedCount: number;
  failedCount: number;
  successPercent: number | null;
  pestCount: number;
  harvestValueIdr: number;
  costIdr: number;
  netIdr: number;
  items: Array<{ name: string; amount: number; unit: string; valueIdr: number | null }>;
  unpricedHarvests: string[];
}

// ─────────────────── BAGIAN UNTUK TAB RENCANA ───────────────────

export function GrowPlannerSections({ plantings }: { plantings: PlantingOption[] }) {
  const [forecasts, setForecasts] = useState<Forecast[]>([]);
  const [needs, setNeeds] = useState<SupplyNeed[]>([]);
  const [beds, setBeds] = useState<BedView[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Form bedengan baru
  const [bedName, setBedName] = useState('');
  const [bedWidth, setBedWidth] = useState('100');
  const [bedLength, setBedLength] = useState('200');

  // Menaruh tanaman ke denah
  const [placeBed, setPlaceBed] = useState('');
  const [placePlanting, setPlacePlanting] = useState('');

  const loadBeds = async () => {
    try {
      const res = await apiFetch<{ beds: BedView[] }>('/garden/beds');
      setBeds(res.beds);
    } catch (err) {
      setError(describeError(err, 'Gagal memuat denah.'));
    }
  };

  useEffect(() => {
    let cancelled = false;

    (async () => {
      // Tiap bagian berdiri sendiri: satu endpoint gagal tidak boleh
      // mengosongkan dua lainnya.
      const [f, s, b] = await Promise.all([
        apiFetch<{ forecasts: Forecast[] }>('/garden/harvest-forecast').catch(() => ({ forecasts: [] })),
        apiFetch<{ needs: SupplyNeed[] }>('/garden/supplies').catch(() => ({ needs: [] })),
        apiFetch<{ beds: BedView[] }>('/garden/beds').catch(() => ({ beds: [] })),
      ]);
      if (cancelled) return;
      setForecasts(f.forecasts);
      setNeeds(s.needs);
      setBeds(b.beds);
    })();

    return () => { cancelled = true; };
  }, []);

  const createBed = async () => {
    if (!bedName.trim()) return;
    try {
      await apiFetch('/garden/beds', {
        method: 'POST',
        body: JSON.stringify({
          name: bedName.trim(),
          widthCm: Number(bedWidth),
          lengthCm: Number(bedLength),
        }),
      });
      setBedName('');
      await loadBeds();
    } catch (err) {
      setError(describeError(err, 'Gagal membuat bedengan.'));
    }
  };

  const placePlant = async () => {
    if (!placeBed || !placePlanting) return;
    try {
      // Titik kosong dicari backend supaya penempatan pertama tidak menumpuk;
      // pengguna tetap bisa menggeser lewat angka setelah ini.
      const bed = beds.find((b) => b.id === placeBed);
      const suggestion = await apiFetch<{ suggestion: { posX: number; posY: number } | null }>(
        `/garden/beds/${placeBed}/suggest?spacing=30`
      );
      const pos = suggestion.suggestion ?? { posX: Math.round((bed?.widthCm ?? 100) / 2), posY: 20 };

      await apiFetch(`/garden/beds/${placeBed}/slots`, {
        method: 'PUT',
        body: JSON.stringify({ plantingId: placePlanting, posX: pos.posX, posY: pos.posY }),
      });
      setPlacePlanting('');
      await loadBeds();
    } catch (err) {
      setError(describeError(err, 'Gagal menaruh tanaman di denah.'));
    }
  };

  const removeSlot = async (plantingId: string) => {
    try {
      await apiFetch(`/garden/beds/slots/${plantingId}`, { method: 'DELETE' });
      await loadBeds();
    } catch (err) {
      setError(describeError(err, 'Gagal mengangkat tanaman dari denah.'));
    }
  };

  const deleteBed = async (id: string) => {
    if (!confirm('Hapus bedengan ini beserta penempatannya?')) return;
    try {
      await apiFetch(`/garden/beds/${id}`, { method: 'DELETE' });
      await loadBeds();
    } catch (err) {
      setError(describeError(err, 'Gagal menghapus bedengan.'));
    }
  };

  return (
    <>
      {error && (
        <div className="rounded-xl p-3 text-xs border-l-[3px] mb-3"
          style={{ background: 'rgba(255, 159, 10, 0.1)', borderColor: '#ff9f0a', color: 'var(--text2)' }}>
          {error}
        </div>
      )}

      {/* Perkiraan panen adaptif */}
      {forecasts.length > 0 && (
        <Card title="🌾 Perkiraan panen">
          <p className="text-[11px]" style={{ color: 'var(--text3)' }}>
            Dikoreksi dari kepatuhan siram dan pupuk, bukan sekadar umur katalog.
          </p>
          {forecasts.map((f) => (
            <div key={f.plantingId} className="rounded-xl p-2.5" style={{ background: 'var(--bg)', boxShadow: 'var(--neu-inset)' }}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold truncate" style={{ color: 'var(--text)' }}>
                  {f.emoji} {f.name}
                </span>
                <span className="text-[10px] font-semibold flex-shrink-0"
                  style={{ color: f.overdueDays > 0 ? 'var(--warn)' : f.shiftDays > 0 ? 'var(--warn)' : 'var(--pos)' }}>
                  {f.estimatedDate}
                </span>
              </div>
              <p className="text-[11px] leading-relaxed mt-1" style={{ color: 'var(--text2)' }}>{f.reason}</p>
              <p className="text-[10px] mt-0.5" style={{ color: 'var(--text3)' }}>
                Keyakinan {f.confidence}
                {f.shiftDays > 0 && ` · mundur ${f.shiftDays} hari dari perkiraan katalog ${f.baselineDate}`}
                {f.overdueDays > 0 && ` · sudah lewat ${f.overdueDays} hari`}
              </p>
            </div>
          ))}
        </Card>
      )}

      {/* Kalkulator belanja */}
      <Card title="🛒 Perlu dibeli">
        {needs.length === 0 ? (
          <p className="text-xs" style={{ color: 'var(--text2)' }}>
            Belum ada kebutuhan media atau pupuk yang bisa dihitung dari tanaman aktif.
          </p>
        ) : (
          needs.map((n) => (
            <div key={n.id} className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-semibold" style={{ color: 'var(--text)' }}>{n.label}</p>
                <p className="text-[10px]" style={{ color: 'var(--text3)' }}>{n.basis}</p>
              </div>
              <span className="text-xs font-bold flex-shrink-0" style={{ color: 'var(--accent)' }}>
                {n.amount} {n.unit}
              </span>
            </div>
          ))
        )}
      </Card>

      {/* Denah bedengan */}
      <Card title="🗺️ Denah bedengan">
        <div className="flex gap-2">
          <input
            className="flex-1 min-w-0 px-2.5 py-2 rounded-lg text-[11px] outline-none"
            style={inputStyle}
            placeholder="Nama bedengan"
            value={bedName}
            onChange={(e) => setBedName(e.target.value)}
          />
          <input
            className="w-14 px-2 py-2 rounded-lg text-[11px] outline-none" style={inputStyle}
            value={bedWidth} onChange={(e) => setBedWidth(e.target.value)} inputMode="numeric" aria-label="Lebar cm"
          />
          <input
            className="w-14 px-2 py-2 rounded-lg text-[11px] outline-none" style={inputStyle}
            value={bedLength} onChange={(e) => setBedLength(e.target.value)} inputMode="numeric" aria-label="Panjang cm"
          />
          <button
            className="neu-cta px-3 py-2 rounded-lg text-[11px] font-bold text-white flex-shrink-0"
            style={{ background: 'var(--accentFill)' }}
            onClick={createBed}
          >
            Buat
          </button>
        </div>
        <p className="text-[10px]" style={{ color: 'var(--text3)' }}>Lebar × panjang dalam sentimeter.</p>

        {beds.map((bed) => (
          <div key={bed.id} className="rounded-xl p-3 mt-1" style={{ background: 'var(--bg)', boxShadow: 'var(--neu-inset)' }}>
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="text-xs font-bold" style={{ color: 'var(--text)' }}>
                {bed.name} · {bed.widthCm}×{bed.lengthCm} cm
              </span>
              <button className="text-[10px]" style={{ color: 'var(--neg)' }} onClick={() => deleteBed(bed.id)}>
                Hapus
              </button>
            </div>

            {/* Denah proporsional: kotak mengikuti rasio bedengan asli supaya
                jarak yang terlihat di layar mencerminkan jarak sebenarnya. */}
            <div
              className="relative w-full rounded-lg mb-2"
              style={{
                paddingBottom: `${Math.min(160, (bed.lengthCm / Math.max(1, bed.widthCm)) * 100)}%`,
                background: 'var(--surface)',
                boxShadow: 'var(--neu-raised-sm)',
              }}
            >
              {bed.slots.map((s) => (
                <button
                  key={s.plantingId}
                  className="absolute rounded-full flex items-center justify-center text-[8px] font-bold"
                  style={{
                    left: `${(s.posX / bed.widthCm) * 100}%`,
                    top: `${(s.posY / bed.lengthCm) * 100}%`,
                    width: `${Math.max(8, (Math.max(s.spacingCm, 10) / bed.widthCm) * 100)}%`,
                    aspectRatio: '1',
                    transform: 'translate(-50%, -50%)',
                    background: 'var(--accentSoft)',
                    color: 'var(--accent)',
                    border: '1px solid var(--accent)',
                  }}
                  title={`${s.name} — ketuk untuk angkat dari denah`}
                  onClick={() => removeSlot(s.plantingId)}
                >
                  {s.name.slice(0, 3)}
                </button>
              ))}
            </div>

            <p className="text-[10px]" style={{ color: 'var(--text3)' }}>
              {bed.report.slotCount} tanaman · ruang terpakai {bed.report.usedPercent}%
            </p>
            {bed.report.issues.map((issue, i) => (
              <p key={i} className="text-[10px] leading-relaxed mt-0.5" style={{ color: 'var(--warn)' }}>
                ⚠️ {issue.message}
              </p>
            ))}
          </div>
        ))}

        {beds.length > 0 && (
          <div className="flex gap-2 mt-1">
            <select
              className="flex-1 min-w-0 px-2 py-2 rounded-lg text-[11px] outline-none" style={inputStyle}
              value={placeBed} onChange={(e) => setPlaceBed(e.target.value)}
            >
              <option value="">Pilih bedengan…</option>
              {beds.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <select
              className="flex-1 min-w-0 px-2 py-2 rounded-lg text-[11px] outline-none" style={inputStyle}
              value={placePlanting} onChange={(e) => setPlacePlanting(e.target.value)}
            >
              <option value="">Pilih tanaman…</option>
              {plantings.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
            <button
              className="neu-cta px-3 py-2 rounded-lg text-[11px] font-bold text-white flex-shrink-0"
              style={{ background: 'var(--accentFill)', opacity: placeBed && placePlanting ? 1 : 0.6 }}
              onClick={placePlant}
              disabled={!placeBed || !placePlanting}
            >
              Taruh
            </button>
          </div>
        )}
      </Card>
    </>
  );
}

// ─────────────────── BAGIAN UNTUK TAB CATATAN ───────────────────

export function GrowRecordSections() {
  const [sowings, setSowings] = useState<SowingsResponse | null>(null);
  const [scores, setScores] = useState<TreatmentScore[]>([]);
  const [pending, setPending] = useState<PendingReview[]>([]);
  const [kitchen, setKitchen] = useState<KitchenReport | null>(null);
  const [annual, setAnnual] = useState<AnnualReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  // Form semai baru
  const [sowName, setSowName] = useState('');
  const [sowBrand, setSowBrand] = useState('');
  const [sowCount, setSowCount] = useState('20');

  const loadSowings = async () => {
    try {
      setSowings(await apiFetch<SowingsResponse>('/garden/sowings'));
    } catch (err) {
      setError(describeError(err, 'Gagal memuat pembibitan.'));
    }
  };

  const loadTreatments = async () => {
    try {
      const t = await apiFetch<{ scores: TreatmentScore[]; pending: PendingReview[] }>('/garden/treatments');
      setScores(t.scores);
      setPending(t.pending);
    } catch (err) {
      setError(describeError(err, 'Gagal memuat catatan hama.'));
    }
  };

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const [s, t, k, a] = await Promise.all([
        apiFetch<SowingsResponse>('/garden/sowings').catch(() => null),
        apiFetch<{ scores: TreatmentScore[]; pending: PendingReview[] }>('/garden/treatments')
          .catch(() => ({ scores: [], pending: [] })),
        apiFetch<KitchenReport>('/garden/kitchen').catch(() => null),
        apiFetch<AnnualReport>('/garden/annual-report').catch(() => null),
      ]);
      if (cancelled) return;
      setSowings(s);
      setScores(t.scores);
      setPending(t.pending);
      setKitchen(k);
      setAnnual(a);
    })();

    return () => { cancelled = true; };
  }, []);

  const addSowing = async () => {
    if (!sowName.trim()) return;
    try {
      await apiFetch('/garden/sowings', {
        method: 'POST',
        body: JSON.stringify({
          name: sowName.trim(),
          brand: sowBrand.trim() || undefined,
          seedCount: Number(sowCount),
        }),
      });
      setSowName('');
      setSowBrand('');
      await loadSowings();
    } catch (err) {
      setError(describeError(err, 'Gagal menyimpan catatan semai.'));
    }
  };

  const recordGermination = async (id: string, seedCount: number) => {
    const answer = prompt(`Berapa benih yang tumbuh dari ${seedCount} yang disemai?`);
    if (answer === null) return;
    const count = Number(answer);
    if (!Number.isFinite(count) || count < 0) return;
    try {
      await apiFetch(`/garden/sowings/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ germinatedCount: count }),
      });
      await loadSowings();
    } catch (err) {
      setError(describeError(err, 'Gagal menyimpan hasil kecambah.'));
    }
  };

  const answerReview = async (id: string | null, worked: boolean) => {
    if (!id) return;
    try {
      await apiFetch(`/garden/pests/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ worked }),
      });
      await loadTreatments();
    } catch (err) {
      setError(describeError(err, 'Gagal menyimpan penilaian.'));
    }
  };

  const exportAnnualPdf = async () => {
    if (!annual) return;
    setExporting(true);
    try {
      // jsPDF diimpor dinamis: laporan tahunan jarang dibuka, dan Kebun adalah
      // tab utama yang dimuat eager — import statis akan menaikkan bundle awal
      // seluruh aplikasi.
      const { jsPDF } = await import('jspdf');
      const doc = new jsPDF({ unit: 'mm', format: 'a4' });
      let y = 20;

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(16);
      doc.text(`Laporan Kebun ${annual.year}`, 20, y);
      y += 10;

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      const lines = [
        `Tanaman ditanam: ${annual.plantedCount}`,
        `Gagal: ${annual.failedCount}${annual.successPercent !== null ? ` (tingkat berhasil ${annual.successPercent}%)` : ''}`,
        `Catatan hama: ${annual.pestCount}`,
        '',
        `Nilai panen: ${rupiah(annual.harvestValueIdr)}`,
        `Biaya kebun: ${rupiah(annual.costIdr)}`,
        `Selisih: ${rupiah(annual.netIdr)}`,
      ];
      for (const line of lines) {
        doc.text(line, 20, y);
        y += 6;
      }

      if (annual.items.length > 0) {
        y += 4;
        doc.setFont('helvetica', 'bold');
        doc.text('Rincian panen', 20, y);
        y += 6;
        doc.setFont('helvetica', 'normal');
        for (const item of annual.items) {
          if (y > 275) {
            doc.addPage();
            y = 20;
          }
          const value = item.valueIdr !== null ? rupiah(item.valueIdr) : 'harga belum dicatat';
          doc.text(`${item.name}: ${item.amount} ${item.unit} — ${value}`, 20, y);
          y += 6;
        }
      }

      doc.save(`laporan-kebun-${annual.year}.pdf`);
    } catch (err) {
      setError(describeError(err, 'Gagal membuat PDF laporan.'));
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      {error && (
        <div className="rounded-xl p-3 text-xs border-l-[3px] mb-3"
          style={{ background: 'rgba(255, 159, 10, 0.1)', borderColor: '#ff9f0a', color: 'var(--text2)' }}>
          {error}
        </div>
      )}

      {/* Penilaian penanganan hama yang menggantung — paling atas karena ini
          yang menutup lingkaran data; tanpa dijawab, peringkat di bawah kosong. */}
      {pending.length > 0 && (
        <Card title="❓ Penanganan hama berhasil?">
          {pending.map((p, i) => (
            <div key={p.id ?? i} className="rounded-xl p-2.5" style={{ background: 'var(--bg)', boxShadow: 'var(--neu-inset)' }}>
              <p className="text-xs font-semibold" style={{ color: 'var(--text)' }}>
                {p.pest}{p.treatment ? ` — ${p.treatment}` : ''}
              </p>
              <p className="text-[10px] mb-1.5" style={{ color: 'var(--text3)' }}>
                Terlihat {p.spottedDate} · {p.daysSince} hari lalu
              </p>
              <div className="flex gap-2">
                <button
                  className="flex-1 py-1.5 rounded-lg text-[11px] font-bold text-white"
                  style={{ background: 'var(--pos)' }}
                  onClick={() => answerReview(p.id, true)}
                >
                  Berhasil
                </button>
                <button
                  className="flex-1 py-1.5 rounded-lg text-[11px] font-bold"
                  style={{ background: 'var(--surface)', color: 'var(--text2)', boxShadow: 'var(--neu-raised-sm)' }}
                  onClick={() => answerReview(p.id, false)}
                >
                  Belum
                </button>
              </div>
            </div>
          ))}
        </Card>
      )}

      {scores.length > 0 && (
        <Card title="🧪 Penanganan yang terbukti">
          {scores.map((s, i) => (
            <div key={i} className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-semibold truncate" style={{ color: 'var(--text)' }}>{s.treatment}</p>
                <p className="text-[10px]" style={{ color: 'var(--text3)' }}>
                  {s.pest} · {s.worked} dari {s.tried} kali
                  {s.avgDaysToResolve !== null && ` · rata-rata ${s.avgDaysToResolve} hari`}
                </p>
              </div>
              <span className="text-xs font-bold flex-shrink-0"
                style={{ color: s.successPercent >= 50 ? 'var(--pos)' : 'var(--text3)' }}>
                {s.successPercent}%
              </span>
            </div>
          ))}
        </Card>
      )}

      {/* Pembibitan */}
      <Card title="🌱 Pembibitan">
        <div className="flex gap-2">
          <input
            className="flex-1 min-w-0 px-2.5 py-2 rounded-lg text-[11px] outline-none" style={inputStyle}
            placeholder="Tanaman" value={sowName} onChange={(e) => setSowName(e.target.value)}
          />
          <input
            className="flex-1 min-w-0 px-2.5 py-2 rounded-lg text-[11px] outline-none" style={inputStyle}
            placeholder="Merek benih" value={sowBrand} onChange={(e) => setSowBrand(e.target.value)}
          />
          <input
            className="w-14 px-2 py-2 rounded-lg text-[11px] outline-none" style={inputStyle}
            value={sowCount} onChange={(e) => setSowCount(e.target.value)} inputMode="numeric" aria-label="Jumlah benih"
          />
          <button
            className="neu-cta px-3 py-2 rounded-lg text-[11px] font-bold text-white flex-shrink-0"
            style={{ background: 'var(--accentFill)' }}
            onClick={addSowing}
          >
            Semai
          </button>
        </div>

        {sowings && sowings.summary.totalBatches > 0 && (
          <p className="text-[10px]" style={{ color: 'var(--text3)' }}>
            {sowings.summary.totalBatches} batch
            {sowings.summary.overallRatePercent !== null && ` · daya tumbuh ${sowings.summary.overallRatePercent}%`}
            {sowings.summary.readyToTransplant > 0 && ` · ${sowings.summary.readyToTransplant} bibit siap pindah`}
          </p>
        )}

        {sowings?.sowings.map((s) => (
          <div key={s.id} className="flex items-center justify-between gap-2 rounded-xl p-2.5"
            style={{ background: 'var(--bg)', boxShadow: 'var(--neu-inset)' }}>
            <div className="min-w-0">
              <p className="text-xs font-semibold truncate" style={{ color: 'var(--text)' }}>
                {s.emoji} {s.name}{s.brand ? ` · ${s.brand}` : ''}
              </p>
              <p className="text-[10px]" style={{ color: 'var(--text3)' }}>
                {s.sownDate} · {s.seedCount} benih
                {s.germinatedCount !== null && ` · tumbuh ${s.germinatedCount}`}
              </p>
            </div>
            {s.germinatedCount === null && (
              <button
                className="text-[10px] font-bold px-2 py-1 rounded-lg flex-shrink-0 text-white"
                style={{ background: 'var(--accentFill)' }}
                onClick={() => recordGermination(s.id, s.seedCount)}
              >
                Hitung
              </button>
            )}
          </div>
        ))}

        {sowings && sowings.sources.length > 0 && (
          <>
            <p className="text-[10px] font-extrabold uppercase tracking-wider mt-1" style={{ color: 'var(--text3)' }}>
              Peringkat benih
            </p>
            {sowings.sources.map((src) => (
              <div key={src.brand} className="flex items-center justify-between gap-2">
                <span className="text-[11px] truncate" style={{ color: 'var(--text2)' }}>
                  {src.brand} <span style={{ color: 'var(--text3)' }}>({src.seedsSown} benih)</span>
                  {!src.reliable && <span style={{ color: 'var(--text3)' }}> · data masih tipis</span>}
                </span>
                <span className="text-[11px] font-bold flex-shrink-0" style={{ color: 'var(--text)' }}>
                  {src.ratePercent}%
                </span>
              </div>
            ))}
          </>
        )}
      </Card>

      {/* Dari kebun ke piring */}
      {kitchen && kitchen.items.length > 0 && (
        <Card title="🍽️ Dari kebun ke piring">
          <div className="flex items-baseline gap-2">
            <span className="text-lg font-extrabold" style={{ color: 'var(--pos)' }}>
              {rupiah(kitchen.harvestValueIdr)}
            </span>
            <span className="text-[11px]" style={{ color: 'var(--text3)' }}>nilai panen bulan ini</span>
          </div>
          {kitchen.selfSufficiencyPercent !== null ? (
            <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text2)' }}>
              Setara {kitchen.selfSufficiencyPercent}% dari belanja makanan bulan ini
              ({rupiah(kitchen.foodSpendIdr)}).
            </p>
          ) : (
            <p className="text-[11px]" style={{ color: 'var(--text3)' }}>
              Belum ada belanja makanan tercatat bulan ini sebagai pembanding.
            </p>
          )}
          {kitchen.items.map((item, i) => (
            <div key={i} className="flex items-center justify-between gap-2">
              <span className="text-[11px] truncate" style={{ color: 'var(--text2)' }}>
                {item.name} · {item.amount} {item.unit}
              </span>
              <span className="text-[11px] font-semibold flex-shrink-0"
                style={{ color: item.valueIdr !== null ? 'var(--text)' : 'var(--text3)' }}>
                {item.valueIdr !== null ? rupiah(item.valueIdr) : 'belum ada harga'}
              </span>
            </div>
          ))}
          {kitchen.unpricedHarvests.length > 0 && (
            <p className="text-[10px]" style={{ color: 'var(--text3)' }}>
              Catat harga {kitchen.unpricedHarvests.join(', ')} di tab Catatan supaya ikut dinilai.
            </p>
          )}
        </Card>
      )}

      {/* Laporan tahunan */}
      {annual && (
        <Card title="📊 Laporan tahunan">
          <div className="grid grid-cols-2 gap-2">
            {[
              ['Ditanam', `${annual.plantedCount}`],
              ['Berhasil', annual.successPercent !== null ? `${annual.successPercent}%` : '–'],
              ['Nilai panen', rupiah(annual.harvestValueIdr)],
              ['Biaya', rupiah(annual.costIdr)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl p-2.5" style={{ background: 'var(--bg)', boxShadow: 'var(--neu-inset)' }}>
                <p className="text-[9px] font-bold uppercase tracking-wide" style={{ color: 'var(--text3)' }}>{label}</p>
                <p className="text-[12px] font-bold" style={{ color: 'var(--text)' }}>{value}</p>
              </div>
            ))}
          </div>
          <p className="text-[11px]" style={{ color: annual.netIdr >= 0 ? 'var(--pos)' : 'var(--neg)' }}>
            Selisih {annual.year}: {rupiah(annual.netIdr)}
          </p>
          <button
            className="neu-cta py-2.5 rounded-xl text-[12px] font-bold text-white"
            style={{ background: 'var(--accentFill)', opacity: exporting ? 0.6 : 1 }}
            onClick={exportAnnualPdf}
            disabled={exporting}
          >
            {exporting ? 'Membuat PDF...' : '📄 Ekspor laporan PDF'}
          </button>
        </Card>
      )}

    </>
  );
}
