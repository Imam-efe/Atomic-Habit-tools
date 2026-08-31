/**
 * Ukuran tanaman dan kalibrasi interval.
 *
 * Kebun ini sudah menyimpan banyak tentang apa yang DIKERJAKAN — siram,
 * pupuk, panen — tapi hampir tidak ada tentang apa yang TERJADI pada
 * tanamannya. Foto jurnal mendekati itu, hanya saja mata tidak bisa
 * membandingkan dua foto berjarak sebulan dan menyimpulkan "tumbuh 6 cm per
 * pekan"; angka bisa.
 *
 * Kalibrasi interval melengkapinya dari sisi berlawanan: katalog bilang cabai
 * disiram tiap dua hari, tapi kebun ini mungkin menyiramnya tiap empat hari
 * dan hasilnya baik-baik saja. Yang ditampilkan bukan teguran, melainkan
 * selisih antara anjuran dan kebiasaan yang benar-benar berjalan.
 */

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { springs } from '@/tokens/motion';
import { apiFetch, ApiError } from '@/lib/api';
import { todayISO } from '@/lib/date';
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

const describeError = (err: unknown, fallback: string) =>
  err instanceof ApiError ? (err.body.message ?? err.body.error ?? fallback) : 'Terjadi kesalahan jaringan.';

const inputStyle = {
  background: 'var(--bg)',
  color: 'var(--text)',
  boxShadow: 'var(--neu-inset)',
} as const;

const buttonStyle = {
  background: 'var(--bg)',
  color: 'var(--text2)',
  boxShadow: 'var(--neu-raised-sm)',
} as const;

// ─────────────────────────── TIPE RESPONS ───────────────────────────

interface UkuranRow {
  id: string;
  unitNo: number | null;
  measuredDate: string;
  heightCm: number | null;
  leafCount: number | null;
  note: string | null;
}

interface UkuranResponse {
  plantingId: string;
  nama: string;
  riwayat: UkuranRow[];
  laju: { cmPerPekan: number | null; pekan: number; mandek: boolean };
  batas: { tinggiCm: number; daun: number };
}

// ─────────────────────────── PENGUKURAN ───────────────────────────

export function MeasureSections({ plantings }: { plantings: PlantingOption[] }) {
  const [pilih, setPilih] = useState('');
  const [data, setData] = useState<UkuranResponse | null>(null);
  const [memuat, setMemuat] = useState(false);
  const [error, setError] = useState('');

  const [tinggi, setTinggi] = useState('');
  const [daun, setDaun] = useState('');
  const [unitNo, setUnitNo] = useState('');
  const [tanggal, setTanggal] = useState(todayISO());
  const [catatan, setCatatan] = useState('');
  const [menyimpan, setMenyimpan] = useState(false);

  const terpilih = plantings.find(p => p.id === pilih) ?? null;
  const pot = terpilih?.units ?? [];

  const muat = async (id: string) => {
    if (!id) { setData(null); return; }
    setMemuat(true);
    setError('');
    try {
      setData(await apiFetch<UkuranResponse>(`/garden/measurements/${id}`));
    } catch (err) {
      // Gagal memuat TIDAK boleh terlihat seperti riwayat kosong: pengguna
      // yang mengira catatannya hilang akan mengukur ulang dan mencatat
      // ganda.
      setData(null);
      setError(describeError(err, 'Gagal memuat riwayat ukuran.'));
    } finally {
      setMemuat(false);
    }
  };

  // Ganti tanaman berarti ganti riwayat DAN ganti daftar pot; pot yang
  // tertinggal dari tanaman sebelumnya akan ditolak backend sebagai 404.
  useEffect(() => { setUnitNo(''); void muat(pilih); }, [pilih]);

  const simpan = async () => {
    if (!pilih) return;
    setMenyimpan(true);
    setError('');
    try {
      await apiFetch(`/garden/measurements/${pilih}`, {
        method: 'POST',
        body: JSON.stringify({
          heightCm: tinggi ? Number(tinggi) : undefined,
          leafCount: daun ? Number(daun) : undefined,
          unitNo: unitNo ? Number(unitNo) : undefined,
          measuredDate: tanggal,
          note: catatan || undefined,
        }),
      });
      setTinggi(''); setDaun(''); setCatatan('');
      await muat(pilih);
    } catch (err) {
      setError(describeError(err, 'Gagal menyimpan ukuran.'));
    } finally {
      setMenyimpan(false);
    }
  };

  const hapus = async (id: string) => {
    setError('');
    try {
      await apiFetch(`/garden/measurements/${id}`, { method: 'DELETE' });
      await muat(pilih);
    } catch (err) {
      setError(describeError(err, 'Gagal menghapus ukuran.'));
    }
  };

  const kodePot = (no: number | null) =>
    no === null ? null : pot.find(u => u.unitNo === no)?.code ?? `#${no}`;

  return (
    <Card title="📏 Ukuran tanaman">
      <p className="text-xs" style={{ color: 'var(--text2)' }}>
        Catat tinggi atau jumlah daun sesekali. Dua titik saja sudah cukup untuk tahu
        lajunya, dan laju yang mendadak berhenti adalah tanda paling awal ada yang salah.
      </p>

      <select
        className="w-full rounded-xl px-3 py-2 text-xs outline-none"
        style={inputStyle}
        value={pilih}
        onChange={e => setPilih(e.target.value)}
      >
        <option value="">Pilih tanaman…</option>
        {plantings.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
      </select>

      {error && <ErrorNote message={error} />}

      {pilih && (
        <>
          {pot.length > 1 && (
            <select
              className="w-full rounded-xl px-3 py-2 text-xs outline-none"
              style={inputStyle}
              value={unitNo}
              onChange={e => setUnitNo(e.target.value)}
            >
              <option value="">Semua pot (tanpa memisah)</option>
              {pot.map(u => <option key={u.unitNo} value={u.unitNo}>{u.code}</option>)}
            </select>
          )}

          <div className="flex gap-2">
            <input
              type="number" inputMode="decimal" min={0} step="0.5"
              className="flex-1 min-w-0 rounded-xl px-3 py-2 text-xs outline-none"
              style={inputStyle}
              placeholder="Tinggi (cm)"
              value={tinggi}
              onChange={e => setTinggi(e.target.value)}
            />
            <input
              type="number" inputMode="numeric" min={0} step="1"
              className="flex-1 min-w-0 rounded-xl px-3 py-2 text-xs outline-none"
              style={inputStyle}
              placeholder="Jumlah daun"
              value={daun}
              onChange={e => setDaun(e.target.value)}
            />
          </div>

          <div className="flex gap-2">
            <input
              type="date"
              className="flex-1 min-w-0 rounded-xl px-3 py-2 text-xs outline-none"
              style={inputStyle}
              value={tanggal}
              onChange={e => setTanggal(e.target.value)}
            />
            <input
              className="flex-[2] min-w-0 rounded-xl px-3 py-2 text-xs outline-none"
              style={inputStyle}
              placeholder="Catatan (opsional)"
              value={catatan}
              onChange={e => setCatatan(e.target.value)}
            />
          </div>

          <motion.button
            className="w-full py-2 rounded-xl text-xs font-bold"
            style={{ ...buttonStyle, opacity: menyimpan || (!tinggi && !daun) ? 0.5 : 1 }}
            whileTap={{ scale: 0.97 }}
            disabled={menyimpan || (!tinggi && !daun)}
            onClick={simpan}
          >
            {menyimpan ? 'Menyimpan…' : 'Simpan ukuran'}
          </motion.button>
        </>
      )}

      {memuat && <p className="text-xs" style={{ color: 'var(--text2)' }}>Memuat…</p>}

      {data && data.riwayat.length > 0 && (
        <>
          <div
            className="rounded-xl p-3 text-xs"
            style={{ background: 'var(--bg)', boxShadow: 'var(--neu-inset)', color: 'var(--text2)' }}
          >
            {data.laju.cmPerPekan === null ? (
              <>Belum cukup titik tinggi untuk menghitung laju — catat sekali lagi beberapa hari lagi.</>
            ) : data.laju.mandek ? (
              <span style={{ color: 'var(--warn)' }}>
                ⚠️ Tidak ada perubahan tinggi selama {data.laju.pekan.toFixed(1)} pekan terakhir.
                Periksa akar, cahaya, dan hara.
              </span>
            ) : (
              <>📈 {data.laju.cmPerPekan.toFixed(1)} cm per pekan selama {data.laju.pekan.toFixed(1)} pekan.</>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            {[...data.riwayat].reverse().map(r => (
              <div key={r.id} className="flex items-center gap-2 text-xs" style={{ color: 'var(--text2)' }}>
                <span className="tabular-nums">{r.measuredDate}</span>
                <span className="flex-1 min-w-0 truncate" style={{ color: 'var(--text)' }}>
                  {[
                    r.heightCm !== null ? `${r.heightCm} cm` : null,
                    r.leafCount !== null ? `${r.leafCount} daun` : null,
                    kodePot(r.unitNo),
                    r.note,
                  ].filter(Boolean).join(' · ')}
                </span>
                <button className="font-bold" style={{ color: 'var(--neg)' }} onClick={() => hapus(r.id)}>
                  Hapus
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {data && data.riwayat.length === 0 && !memuat && (
        <p className="text-xs" style={{ color: 'var(--text2)' }}>Belum ada ukuran tercatat.</p>
      )}
    </Card>
  );
}

// ─────────────────────────── KALIBRASI INTERVAL ───────────────────────────

interface KalibrasiRow {
  plantId: string;
  nama: string;
  action: string;
  katalog: number;
  nyata: number;
  selisih: number;
  sampel: number;
}

export function CalibrationSection() {
  const [hasil, setHasil] = useState<KalibrasiRow[]>([]);
  const [error, setError] = useState('');
  const [memuat, setMemuat] = useState(true);

  useEffect(() => {
    let batal = false;
    apiFetch<{ hasil: KalibrasiRow[] }>('/garden/calibration/interval')
      .then(r => { if (!batal) setHasil(r.hasil); })
      .catch(err => { if (!batal) setError(describeError(err, 'Gagal memuat kalibrasi interval.')); })
      .finally(() => { if (!batal) setMemuat(false); });
    return () => { batal = true; };
  }, []);

  // Kebun yang belum punya cukup riwayat tidak diberi kartu kosong: kartu yang
  // selalu berisi "belum ada data" mengajari pengguna melewatinya.
  if (memuat || (hasil.length === 0 && !error)) return null;

  return (
    <Card title="⚖️ Interval nyata vs katalog">
      {error && <ErrorNote message={error} />}
      <p className="text-xs" style={{ color: 'var(--text2)' }}>
        Dihitung dari jarak antar catatan perawatan sendiri. Selisih besar bukan berarti salah —
        media, cuaca, dan ukuran pot di kebun ini memang berbeda dari asumsi katalog.
      </p>
      {hasil.map(r => (
        <div
          key={`${r.plantId}-${r.action}`}
          className="rounded-xl p-3 text-xs flex items-center gap-2"
          style={{ background: 'var(--bg)', boxShadow: 'var(--neu-inset)' }}
        >
          <span className="flex-1 min-w-0" style={{ color: 'var(--text)' }}>
            {r.nama} · {r.action === 'siram' ? 'siram' : 'pupuk'}
          </span>
          <span className="tabular-nums" style={{ color: 'var(--text2)' }}>
            katalog {r.katalog}h · nyata {r.nyata}h
          </span>
          <span
            className="tabular-nums font-bold"
            style={{ color: r.selisih > 0 ? 'var(--warn)' : 'var(--pos)' }}
          >
            {r.selisih > 0 ? '+' : ''}{r.selisih}h
          </span>
        </div>
      ))}
      <p className="text-[10px]" style={{ color: 'var(--text2)' }}>
        Dihitung dari {hasil.reduce((n, r) => n + r.sampel, 0)} jarak perawatan.
      </p>
    </Card>
  );
}
