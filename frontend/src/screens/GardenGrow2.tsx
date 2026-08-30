/**
 * Sepuluh fitur kebun lanjutan (gelombang kedua): kompos rumahan, wishlist
 * musim depan, pengingat sanitasi, skor kesulitan pribadi, tren tahun-ke-
 * tahun, panen vs terbuang, dan tampungan air hujan.
 *
 * File terpisah dari GardenGrow.tsx yang sudah panjang. Dua komponen yang
 * diekspor dipasang di tab yang sama — Rencana dan Catatan — persis pola
 * GardenGrow.tsx: menambah tab baru berarti pengguna harus belajar navigasi
 * baru, menambah bagian di tab yang sudah dikenal tidak.
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

function ErrorNote({ message }: { message: string }) {
  return (
    <div
      className="rounded-xl p-3 text-xs border-l-[3px]"
      style={{ background: 'rgba(255, 159, 10, 0.1)', borderColor: '#ff9f0a', color: 'var(--text2)' }}
    >
      {message}
    </div>
  );
}

function PrimaryButton({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <motion.button
      className="py-2.5 rounded-xl text-xs font-semibold text-white"
      style={{ background: disabled ? 'var(--track)' : 'var(--accentFill)' }}
      onClick={onClick}
      disabled={disabled}
      whileTap={disabled ? {} : { scale: 0.97 }}
      transition={springs.snappy}
    >
      {label}
    </motion.button>
  );
}

// ─────────────────────────── TIPE RESPONS ───────────────────────────

interface CompostBatch {
  id: string;
  name: string;
  metode: 'cepat' | 'sedang' | 'lambat';
  startedDate: string;
  materialNote: string | null;
  readyDateEstimasi: string;
  status: 'proses' | 'siap' | 'terpakai';
  hariSejakEstimasi: number;
  siapDiterapkan: boolean;
}

interface CompostResponse {
  batches: CompostBatch[];
  hariMetode: Record<string, number>;
}

interface WishlistItem {
  id: string;
  plantId: string | null;
  name: string;
  emoji: string;
  note: string | null;
}

interface SanitationWarning {
  lokasiId: string;
  lokasiLabel: string;
  prevEndDate: string;
  newStartDate: string;
  message: string;
}

interface DifficultyScore {
  plantId: string;
  name: string;
  emoji: string;
  skor: 'mudah' | 'sedang' | 'sulit';
  total: number;
  gagal: number;
  difficultyKatalog?: string;
}

interface YearlyTrend {
  years: Array<{ year: number; cost: number; value: number; net: number; cumulativeNet: number }>;
  breakEvenYear: number | null;
  cumulativeNet: number;
}

interface WasteReport {
  totalItem: number;
  terpakai: number;
  terbuang: number;
  masihStok: number;
  wastePercent: number | null;
}

interface RainwaterEntry {
  id: string;
  date: string;
  litersCollected: number;
  litersUsed: number;
  note: string | null;
}

interface RainwaterResponse {
  log: RainwaterEntry[];
  tarifRpPerLiter: number;
  ringkasan: { totalTertampung: number; totalTerpakai: number; sisaTampungan: number; hematRupiah: number | null };
}

const METODE_LABEL: Record<CompostBatch['metode'], string> = { cepat: 'Cepat', sedang: 'Sedang', lambat: 'Lambat' };
const SKOR_LABEL: Record<DifficultyScore['skor'], { label: string; color: string }> = {
  mudah: { label: 'Mudah bagimu', color: '#34c759' },
  sedang: { label: 'Sedang bagimu', color: '#ff9f0a' },
  sulit: { label: 'Sulit bagimu', color: '#ff3b30' },
};

/**
 * Pencarian skor yang tidak pernah melempar.
 *
 * Backend hanya mengirim tanaman yang sudah punya vonis, jadi tiga kunci di
 * atas seharusnya cukup. Tapi `SKOR_LABEL[x].color` pada nilai yang tidak
 * terduga merusak SELURUH tab Catatan, bukan satu baris — harga sebuah
 * bidang tak dikenal tidak sepadan dengan itu, dan tab ini akan terus
 * kedatangan bidang baru seiring fitur bertambah.
 */
const skorLabel = (skor: string) =>
  SKOR_LABEL[skor as DifficultyScore['skor']] ?? { label: skor, color: 'var(--text2)' };

// ─────────────────────────── RENCANA ───────────────────────────

export function GrowPlannerSections2({ plantings }: { plantings: PlantingOption[] }) {
  const [compost, setCompost] = useState<CompostResponse | null>(null);
  const [wishlist, setWishlist] = useState<WishlistItem[]>([]);
  const [sanitation, setSanitation] = useState<SanitationWarning[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [batchName, setBatchName] = useState('');
  const [batchMetode, setBatchMetode] = useState<CompostBatch['metode']>('sedang');
  const [applyBatchId, setApplyBatchId] = useState<string | null>(null);
  const [applyPlanting, setApplyPlanting] = useState('');

  const [wishPlant, setWishPlant] = useState('');
  const [wishNote, setWishNote] = useState('');

  const reload = async () => {
    try {
      const [comp, wish, san] = await Promise.all([
        apiFetch<CompostResponse>('/garden/compost'),
        apiFetch<{ items: WishlistItem[] }>('/garden/wishlist'),
        apiFetch<{ warnings: SanitationWarning[] }>('/garden/sanitation'),
      ]);
      setCompost(comp);
      setWishlist(wish.items);
      setSanitation(san.warnings);
    } catch (err) {
      setError(describeError(err, 'Gagal memuat data kebun lanjutan.'));
    }
  };

  useEffect(() => {
    reload();
  }, []);

  const addBatch = async () => {
    if (!batchName.trim()) return;
    try {
      await apiFetch('/garden/compost', { method: 'POST', body: JSON.stringify({ name: batchName.trim(), metode: batchMetode }) });
      setBatchName('');
      reload();
    } catch (err) {
      setError(describeError(err, 'Gagal membuat batch kompos.'));
    }
  };

  const markReady = async (id: string) => {
    try {
      await apiFetch(`/garden/compost/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'siap' }) });
      reload();
    } catch (err) {
      setError(describeError(err, 'Gagal menandai siap.'));
    }
  };

  const applyBatch = async () => {
    if (!applyBatchId || !applyPlanting) return;
    try {
      await apiFetch(`/garden/compost/${applyBatchId}/apply`, { method: 'POST', body: JSON.stringify({ plantingId: applyPlanting }) });
      setApplyBatchId(null);
      setApplyPlanting('');
      reload();
    } catch (err) {
      setError(describeError(err, 'Gagal menerapkan kompos.'));
    }
  };

  const deleteBatch = async (id: string) => {
    try {
      await apiFetch(`/garden/compost/${id}`, { method: 'DELETE' });
      reload();
    } catch (err) {
      setError(describeError(err, 'Gagal menghapus batch.'));
    }
  };

  const addWish = async () => {
    if (!wishPlant.trim()) return;
    const isCatalog = plantings.some((p) => p.plantId === wishPlant);
    try {
      await apiFetch('/garden/wishlist', {
        method: 'POST',
        body: JSON.stringify(
          isCatalog ? { plantId: wishPlant, note: wishNote.trim() || undefined } : { customName: wishPlant.trim(), note: wishNote.trim() || undefined }
        ),
      });
      setWishPlant('');
      setWishNote('');
      reload();
    } catch (err) {
      setError(describeError(err, 'Gagal menyimpan wishlist.'));
    }
  };

  const removeWish = async (id: string) => {
    try {
      await apiFetch(`/garden/wishlist/${id}`, { method: 'DELETE' });
      reload();
    } catch (err) {
      setError(describeError(err, 'Gagal menghapus wishlist.'));
    }
  };

  const cleanNow = async (w: SanitationWarning) => {
    try {
      // Dikirim balik dengan kunci yang sama persis seperti yang diterima.
      // Mengirim LABEL-nya membuat pembersihan bedengan tersimpan sebagai
      // lokasi teks, tidak pernah cocok dengan peringatannya, dan
      // peringatannya tidak pernah hilang walau tombolnya sudah ditekan.
      await apiFetch('/garden/sanitation', { method: 'POST', body: JSON.stringify({ lokasiId: w.lokasiId }) });
      reload();
    } catch (err) {
      setError(describeError(err, 'Gagal mencatat sanitasi.'));
    }
  };

  return (
    <div className="flex flex-col">
      {error && (
        <div className="mb-3">
          <ErrorNote message={error} />
        </div>
      )}

      {sanitation.length > 0 && (
        <Card title="🧼 Bersihkan sebelum tanam ulang">
          {sanitation.map((w) => (
            <div key={w.lokasiId} className="flex items-center justify-between gap-2">
              <div className="text-xs" style={{ color: 'var(--text2)' }}>{w.message}</div>
              <button
                className="px-2.5 py-1.5 rounded-lg text-[10px] font-semibold shrink-0"
                style={{ background: 'rgba(52,199,89,0.15)', color: '#34c759' }}
                onClick={() => cleanNow(w)}
              >
                Sudah dibersihkan
              </button>
            </div>
          ))}
        </Card>
      )}

      <Card title="♻️ Kompos rumahan">
        {compost && compost.batches.length > 0 && (
          <div className="flex flex-col gap-2">
            {compost.batches.map((b) => (
              <div key={b.id} className="rounded-xl p-2.5 flex flex-col gap-1" style={{ background: 'var(--bg)', boxShadow: 'var(--neu-inset)' }}>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold" style={{ color: 'var(--text)' }}>{b.name}</span>
                  <span
                    className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md"
                    style={{
                      color: b.status === 'terpakai' ? 'var(--text3)' : b.siapDiterapkan ? '#34c759' : 'var(--text2)',
                      background: b.status === 'terpakai' ? 'transparent' : b.siapDiterapkan ? 'rgba(52,199,89,0.12)' : 'transparent',
                    }}
                  >
                    {b.status === 'terpakai' ? 'Sudah diterapkan' : b.status === 'siap' ? 'Siap dipakai' : b.siapDiterapkan ? 'Siap dipakai' : 'Masih proses'}
                  </span>
                </div>
                <div className="text-xs" style={{ color: 'var(--text3)' }}>
                  {METODE_LABEL[b.metode]} · perkiraan siap {b.readyDateEstimasi}
                </div>
                {b.status !== 'terpakai' && (
                  <div className="flex gap-1.5 pt-0.5">
                    {b.status === 'proses' && (
                      <button
                        className="px-2 py-1 rounded-lg text-[10px] font-semibold"
                        style={{ background: 'var(--surface)', color: 'var(--text2)', boxShadow: 'var(--neu-raised-sm)' }}
                        onClick={() => markReady(b.id)}
                      >
                        Tandai siap
                      </button>
                    )}
                    <button
                      className="px-2 py-1 rounded-lg text-[10px] font-semibold"
                      style={{ background: 'var(--surface)', color: 'var(--text2)', boxShadow: 'var(--neu-raised-sm)' }}
                      onClick={() => setApplyBatchId(applyBatchId === b.id ? null : b.id)}
                    >
                      Terapkan ke tanaman
                    </button>
                    <button
                      className="px-2 py-1 rounded-lg text-[10px] font-semibold"
                      style={{ background: 'rgba(255,59,48,0.1)', color: '#ff3b30' }}
                      onClick={() => deleteBatch(b.id)}
                    >
                      Hapus
                    </button>
                  </div>
                )}
                {applyBatchId === b.id && (
                  <div className="flex gap-1.5 pt-1">
                    <select
                      className="flex-1 px-2 py-1.5 rounded-lg text-xs outline-none"
                      style={inputStyle}
                      value={applyPlanting}
                      onChange={(e) => setApplyPlanting(e.target.value)}
                    >
                      <option value="">Pilih tanaman…</option>
                      {plantings.map((p) => (
                        <option key={p.id} value={p.id}>{p.label}</option>
                      ))}
                    </select>
                    <button
                      className="px-2.5 py-1.5 rounded-lg text-[10px] font-semibold text-white shrink-0"
                      style={{ background: applyPlanting ? 'var(--accentFill)' : 'var(--track)' }}
                      disabled={!applyPlanting}
                      onClick={applyBatch}
                    >
                      Terapkan
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <input
            className="px-3 py-2.5 rounded-xl text-sm outline-none"
            style={inputStyle}
            placeholder="Nama batch"
            value={batchName}
            onChange={(e) => setBatchName(e.target.value)}
          />
          <select
            className="px-3 py-2.5 rounded-xl text-sm outline-none"
            style={inputStyle}
            value={batchMetode}
            onChange={(e) => setBatchMetode(e.target.value as CompostBatch['metode'])}
          >
            {(['cepat', 'sedang', 'lambat'] as const).map((m) => (
              <option key={m} value={m}>{METODE_LABEL[m]} (~{compost?.hariMetode[m] ?? '?'} hari)</option>
            ))}
          </select>
        </div>
        <PrimaryButton label="Mulai batch kompos" onClick={addBatch} disabled={!batchName.trim()} />
      </Card>

      <Card title="🌟 Wishlist musim depan">
        {wishlist.length > 0 && (
          <div className="flex flex-col gap-1.5">
            {wishlist.map((w) => (
              <div key={w.id} className="flex items-center justify-between">
                <span className="text-sm" style={{ color: 'var(--text)' }}>
                  {w.emoji} {w.name}
                  {w.note && <span className="text-xs" style={{ color: 'var(--text3)' }}> · {w.note}</span>}
                </span>
                <button className="text-xs shrink-0" style={{ color: '#ff3b30' }} onClick={() => removeWish(w.id)}>
                  Hapus
                </button>
              </div>
            ))}
          </div>
        )}
        <input
          className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
          style={inputStyle}
          placeholder="Nama tanaman yang ingin dicoba"
          value={wishPlant}
          onChange={(e) => setWishPlant(e.target.value)}
        />
        <input
          className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
          style={inputStyle}
          placeholder="Catatan (opsional)"
          value={wishNote}
          onChange={(e) => setWishNote(e.target.value)}
        />
        <PrimaryButton label="Tambah ke wishlist" onClick={addWish} disabled={!wishPlant.trim()} />
      </Card>
    </div>
  );
}

// ─────────────────────────── CATATAN ───────────────────────────

export function GrowRecordSections2() {
  const [difficulty, setDifficulty] = useState<DifficultyScore[]>([]);
  const [yearlyTrend, setYearlyTrend] = useState<YearlyTrend | null>(null);
  const [waste, setWaste] = useState<WasteReport | null>(null);
  const [rainwater, setRainwater] = useState<RainwaterResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [tarifInput, setTarifInput] = useState('');
  const [rainCollected, setRainCollected] = useState('');
  const [rainUsed, setRainUsed] = useState('');

  const reload = async () => {
    try {
      const [diff, trend, wasteRes, rain] = await Promise.all([
        apiFetch<{ scores: DifficultyScore[] }>('/garden/difficulty'),
        apiFetch<YearlyTrend>('/garden/yearly-trend'),
        apiFetch<WasteReport>('/garden/waste-report'),
        apiFetch<RainwaterResponse>('/garden/rainwater'),
      ]);
      setDifficulty(diff.scores);
      setYearlyTrend(trend);
      setWaste(wasteRes);
      setRainwater(rain);
      setTarifInput(rain.tarifRpPerLiter > 0 ? String(rain.tarifRpPerLiter) : '');
    } catch (err) {
      setError(describeError(err, 'Gagal memuat catatan lanjutan.'));
    }
  };

  useEffect(() => {
    reload();
  }, []);

  const saveTarif = async () => {
    const n = Number(tarifInput.replace(/\D/g, ''));
    try {
      await apiFetch('/garden/rainwater/tarif', { method: 'PUT', body: JSON.stringify({ tarifRpPerLiter: n || 0 }) });
      reload();
    } catch (err) {
      setError(describeError(err, 'Gagal menyimpan tarif.'));
    }
  };

  const addRain = async () => {
    const collected = Number(rainCollected.replace(/\D/g, ''));
    const used = Number(rainUsed.replace(/\D/g, ''));
    if (!collected && !used) return;
    try {
      await apiFetch('/garden/rainwater', {
        method: 'POST',
        body: JSON.stringify({ litersCollected: collected || undefined, litersUsed: used || undefined }),
      });
      setRainCollected('');
      setRainUsed('');
      reload();
    } catch (err) {
      setError(describeError(err, 'Gagal mencatat air hujan.'));
    }
  };

  return (
    <div className="flex flex-col">
      {error && (
        <div className="mb-3">
          <ErrorNote message={error} />
        </div>
      )}

      {difficulty.length > 0 && (
        <Card title="🎯 Skor kesulitan bagimu">
          {difficulty.map((d) => {
            const skor = skorLabel(d.skor);
            return (
              <div key={d.plantId} className="flex justify-between items-center text-sm">
                <span style={{ color: 'var(--text)' }}>{d.emoji} {d.name}</span>
                <span className="text-xs text-right" style={{ color: skor.color }}>
                  {skor.label}
                  <span className="block" style={{ color: 'var(--text3)' }}>{d.total} percobaan, {d.gagal} gagal</span>
                </span>
              </div>
            );
          })}
          <div className="text-xs" style={{ color: 'var(--text3)' }}>
            Dari riwayat menanammu sendiri, bisa berbeda dari tingkat kesulitan katalog umum.
          </div>
        </Card>
      )}

      {yearlyTrend && yearlyTrend.years.length > 0 && (
        <Card title="📈 Tren tahun-ke-tahun">
          {yearlyTrend.years.map((y) => (
            <div key={y.year} className="flex justify-between text-sm">
              <span style={{ color: 'var(--text)' }}>{y.year}</span>
              <span className="text-xs text-right" style={{ color: y.net >= 0 ? '#34c759' : '#ff3b30' }}>
                {y.net >= 0 ? '+' : '−'}{rupiah(Math.abs(y.net))}
                <span className="block" style={{ color: 'var(--text3)' }}>kumulatif {rupiah(y.cumulativeNet)}</span>
              </span>
            </div>
          ))}
          <div className="text-xs" style={{ color: 'var(--text3)' }}>
            {yearlyTrend.cumulativeNet >= 0
              ? `📈 Sudah balik modal${yearlyTrend.breakEvenYear ? ` sejak ${yearlyTrend.breakEvenYear}` : ''}.`
              : '📉 Belum balik modal secara kumulatif.'}
          </div>
        </Card>
      )}

      {waste && waste.totalItem > 0 && (
        <Card title="🗑️ Panen vs terbuang">
          <div className="flex justify-between text-sm">
            <span style={{ color: '#34c759' }}>Terpakai: {waste.terpakai}</span>
            <span style={{ color: 'var(--text2)' }}>Masih stok: {waste.masihStok}</span>
            <span style={{ color: waste.terbuang > 0 ? '#ff3b30' : 'var(--text2)' }}>Terbuang: {waste.terbuang}</span>
          </div>
          {waste.wastePercent !== null && (
            <div className="text-xs" style={{ color: 'var(--text3)' }}>
              {waste.wastePercent}% dari hasil panen yang masuk stok berakhir terbuang.
            </div>
          )}
        </Card>
      )}

      <Card title="🌧️ Tampungan air hujan">
        {rainwater && (
          <div className="text-sm" style={{ color: 'var(--text)' }}>
            Sisa tampungan: <span className="font-semibold">{rainwater.ringkasan.sisaTampungan} liter</span>
            {rainwater.ringkasan.hematRupiah !== null && (
              <span className="block text-xs" style={{ color: '#34c759' }}>
                Hemat ~{rupiah(rainwater.ringkasan.hematRupiah)} dari air hujan
              </span>
            )}
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <input
            className="px-3 py-2.5 rounded-xl text-sm outline-none"
            style={inputStyle}
            placeholder="Liter tertampung"
            inputMode="numeric"
            value={rainCollected}
            onChange={(e) => setRainCollected(e.target.value)}
          />
          <input
            className="px-3 py-2.5 rounded-xl text-sm outline-none"
            style={inputStyle}
            placeholder="Liter terpakai"
            inputMode="numeric"
            value={rainUsed}
            onChange={(e) => setRainUsed(e.target.value)}
          />
        </div>
        <PrimaryButton label="Catat hari ini" onClick={addRain} disabled={!rainCollected.trim() && !rainUsed.trim()} />

        <div className="flex gap-2 items-center pt-1" style={{ borderTop: '1px solid var(--sep)' }}>
          <input
            className="flex-1 px-3 py-2 rounded-xl text-xs outline-none"
            style={inputStyle}
            placeholder="Tarif air PDAM (Rp/liter), opsional"
            inputMode="numeric"
            value={tarifInput}
            onChange={(e) => setTarifInput(e.target.value)}
          />
          <button
            className="px-3 py-2 rounded-lg text-[11px] font-semibold shrink-0"
            style={{ background: 'var(--bg)', color: 'var(--text2)', boxShadow: 'var(--neu-raised-sm)' }}
            onClick={saveTarif}
          >
            Simpan
          </button>
        </div>
      </Card>
    </div>
  );
}
