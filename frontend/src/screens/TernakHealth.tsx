/**
 * Tab Kesehatan — timbang/ukur, tes air, kepadatan kandang, dan hitung
 * mundur karantina.
 *
 * Empat hal yang tidak muncul di jadwal karena tidak berjadwal tetap: berat
 * turun kapan saja, air memburuk kapan saja, kandang jadi sesak begitu
 * penghuni baru ditambah, dan karantina berlaku sekali per hewan baru.
 *
 * Baris ukur untuk hewan ber-`jumlah` lebih dari satu diberi keterangan
 * tegas bahwa angkanya contoh satu ekor, bukan sensus seluruh kandang — 180
 * gram pada baris tiga puluh ekor lele terbaca sebagai total kalau
 * keterangan ini tidak ada.
 */

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { springs } from '@/tokens/motion';
import { apiFetch } from '@/lib/api';
import { todayISO } from '@/lib/date';
import {
  describeError, inputStyle, buttonStyle,
  type HewanItem, type KandangItem, type PilihanSubjek, type KepadatanItem, type KarantinaItem,
} from './Ternak';

interface UkurRow {
  id: string;
  tanggal: string;
  beratGram: number | null;
  panjangCm: number | null;
  catatan: string | null;
}

type StatusAir = 'aman' | 'waspada' | 'bahaya';
interface PenilaianAir { parameter: string; nilai: number; status: StatusAir; saran: string }
interface AirRow {
  id: string;
  tanggal: string;
  suhuC: number | null;
  ph: number | null;
  amoniaPpm: number | null;
  nitritPpm: number | null;
  nitratPpm: number | null;
  salinitasPpt: number | null;
  catatan: string | null;
  penilaian: PenilaianAir[];
}

const STATUS_AIR_COLOR: Record<StatusAir, string> = {
  aman: 'var(--pos)', waspada: 'var(--warn)', bahaya: 'var(--neg)',
};

export function TernakHealthTab({
  hewan, kandang, subjekHewan, subjekKandang, kepadatan, karantina, focus, clearFocus, onChanged,
}: {
  hewan: HewanItem[];
  kandang: KandangItem[];
  subjekHewan: PilihanSubjek[];
  subjekKandang: PilihanSubjek[];
  kepadatan: KepadatanItem[];
  karantina: KarantinaItem[];
  focus: PilihanSubjek | null;
  clearFocus: () => void;
  onChanged: () => void;
}) {
  // ─────────────────────────── TIMBANG / UKUR ───────────────────────────
  const [hewanId, setHewanId] = useState('');
  const [ukurRiwayat, setUkurRiwayat] = useState<UkurRow[]>([]);
  const [ukurLoading, setUkurLoading] = useState(false);
  const [ukurError, setUkurError] = useState('');
  const [beratGram, setBeratGram] = useState('');
  const [panjangCm, setPanjangCm] = useState('');
  const [ukurTanggal, setUkurTanggal] = useState(todayISO());
  const [ukurCatatan, setUkurCatatan] = useState('');
  const [ukurSaving, setUkurSaving] = useState(false);

  const hewanTerpilih = hewan.find((h) => h.id === hewanId) ?? null;
  const contohSajaUkur = (hewanTerpilih?.jumlah ?? 0) > 1;

  const loadUkur = async (id: string) => {
    if (!id) { setUkurRiwayat([]); return; }
    setUkurLoading(true);
    setUkurError('');
    try {
      setUkurRiwayat((await apiFetch<{ ukur: UkurRow[] }>(`/ternak/ukur/${id}`)).ukur);
    } catch (err) {
      setUkurRiwayat([]);
      setUkurError(describeError(err, 'Gagal memuat riwayat ukur.'));
    }
    setUkurLoading(false);
  };

  useEffect(() => { void loadUkur(hewanId); }, [hewanId]);

  const simpanUkur = async () => {
    if (!hewanId || (!beratGram && !panjangCm)) return;
    setUkurSaving(true);
    setUkurError('');
    try {
      await apiFetch(`/ternak/ukur/${hewanId}`, {
        method: 'POST',
        body: JSON.stringify({
          tanggal: ukurTanggal,
          beratGram: beratGram ? Number(beratGram) : undefined,
          panjangCm: panjangCm ? Number(panjangCm) : undefined,
          catatan: ukurCatatan.trim() || undefined,
        }),
      });
      setBeratGram(''); setPanjangCm(''); setUkurCatatan('');
      await loadUkur(hewanId);
    } catch (err) {
      setUkurError(describeError(err, 'Gagal menyimpan ukuran.'));
    }
    setUkurSaving(false);
  };

  // ─────────────────────────── TES AIR ───────────────────────────
  const kandangAir = subjekKandang.filter((s) => kandang.find((k) => k.id === s.id)?.habitat !== 'darat');
  const [kandangId, setKandangId] = useState('');
  const [airRiwayat, setAirRiwayat] = useState<AirRow[]>([]);
  const [airLoading, setAirLoading] = useState(false);
  const [airError, setAirError] = useState('');
  const [airTanggal, setAirTanggal] = useState(todayISO());
  const [suhuC, setSuhuC] = useState('');
  const [ph, setPh] = useState('');
  const [amoniaPpm, setAmoniaPpm] = useState('');
  const [nitritPpm, setNitritPpm] = useState('');
  const [nitratPpm, setNitratPpm] = useState('');
  const [salinitasPpt, setSalinitasPpt] = useState('');
  const [airCatatan, setAirCatatan] = useState('');
  const [airSaving, setAirSaving] = useState(false);

  const loadAir = async (id: string) => {
    if (!id) { setAirRiwayat([]); return; }
    setAirLoading(true);
    setAirError('');
    try {
      setAirRiwayat((await apiFetch<{ air: AirRow[] }>(`/ternak/air/${id}`)).air);
    } catch (err) {
      setAirRiwayat([]);
      setAirError(describeError(err, 'Gagal memuat riwayat tes air.'));
    }
    setAirLoading(false);
  };

  useEffect(() => { void loadAir(kandangId); }, [kandangId]);

  const simpanAir = async () => {
    if (!kandangId) return;
    const semua = [suhuC, ph, amoniaPpm, nitritPpm, nitratPpm, salinitasPpt];
    if (semua.every((v) => !v)) { setAirError('Isi minimal satu parameter.'); return; }
    setAirSaving(true);
    setAirError('');
    try {
      await apiFetch(`/ternak/air/${kandangId}`, {
        method: 'POST',
        body: JSON.stringify({
          tanggal: airTanggal,
          suhuC: suhuC ? Number(suhuC) : undefined,
          ph: ph ? Number(ph) : undefined,
          amoniaPpm: amoniaPpm ? Number(amoniaPpm) : undefined,
          nitritPpm: nitritPpm ? Number(nitritPpm) : undefined,
          nitratPpm: nitratPpm ? Number(nitratPpm) : undefined,
          salinitasPpt: salinitasPpt ? Number(salinitasPpt) : undefined,
          catatan: airCatatan.trim() || undefined,
        }),
      });
      setSuhuC(''); setPh(''); setAmoniaPpm(''); setNitritPpm(''); setNitratPpm(''); setSalinitasPpt(''); setAirCatatan('');
      await loadAir(kandangId);
      // Amonia di layar Hari Ini dihitung dari tes terakhir tiap kandang —
      // tes baru di sini harus ikut memperbarui peringatan itu.
      onChanged();
    } catch (err) {
      setAirError(describeError(err, 'Gagal menyimpan tes air.'));
    }
    setAirSaving(false);
  };

  // Sorotan dari peringatan lintas-tab: karantina → pilih hewannya di
  // Timbang; kepadatan/amonia → pilih kandangnya di Tes air.
  useEffect(() => {
    if (!focus) return;
    if (focus.tipe === 'hewan') setHewanId(focus.id);
    else setKandangId(focus.id);
    clearFocus();
  }, [focus]);

  return (
    <div className="flex flex-col gap-3">
      {/* ─────────────────────────── TIMBANG ─────────────────────────── */}
      <div className="rounded-[18px] p-4 flex flex-col gap-2.5" style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}>
        <p className="text-sm font-bold" style={{ color: 'var(--text)' }}>⚖️ Timbang & ukur</p>
        <select className="w-full rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle}
          value={hewanId} onChange={(e) => setHewanId(e.target.value)}>
          <option value="">Pilih hewan…</option>
          {subjekHewan.map((h) => <option key={h.id} value={h.id}>{h.nama}</option>)}
        </select>

        {hewanId && (
          <>
            {contohSajaUkur && (
              <p className="text-[10px] italic" style={{ color: 'var(--text3)' }}>
                Baris ini mewakili {hewanTerpilih?.jumlah} ekor — angka yang dicatat di sini contoh dari satu ekor, bukan sensus seluruh kandang.
              </p>
            )}
            <div className="flex gap-2">
              <input type="number" inputMode="decimal" min={0} className="flex-1 min-w-0 rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle}
                placeholder="Berat (gram)" value={beratGram} onChange={(e) => setBeratGram(e.target.value)} />
              <input type="number" inputMode="decimal" min={0} className="flex-1 min-w-0 rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle}
                placeholder="Panjang (cm)" value={panjangCm} onChange={(e) => setPanjangCm(e.target.value)} />
            </div>
            <div className="flex gap-2">
              <input type="date" className="flex-1 min-w-0 rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle}
                value={ukurTanggal} onChange={(e) => setUkurTanggal(e.target.value)} />
              <input className="flex-[2] min-w-0 rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle}
                placeholder="Catatan (opsional)" value={ukurCatatan} onChange={(e) => setUkurCatatan(e.target.value)} />
            </div>
            {ukurError && <p className="text-xs" style={{ color: 'var(--neg)' }}>{ukurError}</p>}
            <motion.button
              className="w-full py-2 rounded-xl text-xs font-bold"
              style={{ ...buttonStyle, opacity: ukurSaving || (!beratGram && !panjangCm) ? 0.5 : 1 }}
              whileTap={{ scale: 0.97 }} transition={springs.snappy}
              disabled={ukurSaving || (!beratGram && !panjangCm)}
              onClick={simpanUkur}
            >
              {ukurSaving ? 'Menyimpan…' : 'Simpan ukuran'}
            </motion.button>

            {ukurLoading && <p className="text-xs" style={{ color: 'var(--text3)' }}>Memuat…</p>}
            {!ukurLoading && ukurRiwayat.length === 0 && !ukurError && (
              <p className="text-xs" style={{ color: 'var(--text3)' }}>Belum ada ukuran tercatat.</p>
            )}
            {ukurRiwayat.slice(0, 8).map((r) => (
              <div key={r.id} className="text-[11px] flex justify-between" style={{ color: 'var(--text2)' }}>
                <span className="tabular-nums">{r.tanggal}</span>
                <span style={{ color: 'var(--text)' }}>
                  {[r.beratGram !== null ? `${r.beratGram} g` : null, r.panjangCm !== null ? `${r.panjangCm} cm` : null, r.catatan]
                    .filter(Boolean).join(' · ')}
                  {contohSajaUkur ? ' (contoh)' : ''}
                </span>
              </div>
            ))}
          </>
        )}
      </div>

      {/* ─────────────────────────── TES AIR ─────────────────────────── */}
      <div className="rounded-[18px] p-4 flex flex-col gap-2.5" style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}>
        <p className="text-sm font-bold" style={{ color: 'var(--text)' }}>🧪 Tes air</p>
        {kandangAir.length === 0 ? (
          <p className="text-xs" style={{ color: 'var(--text3)' }}>Belum ada kandang berhabitat air.</p>
        ) : (
          <select className="w-full rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle}
            value={kandangId} onChange={(e) => setKandangId(e.target.value)}>
            <option value="">Pilih kandang…</option>
            {kandangAir.map((k) => <option key={k.id} value={k.id}>{k.nama}</option>)}
          </select>
        )}

        {kandangId && (
          <>
            <p className="text-[10px]" style={{ color: 'var(--text3)' }}>Semua kolom opsional — isi yang sempat diukur saja.</p>
            <div className="grid grid-cols-2 gap-2">
              <input type="number" inputMode="decimal" className="rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle}
                placeholder="Suhu (°C)" value={suhuC} onChange={(e) => setSuhuC(e.target.value)} />
              <input type="number" inputMode="decimal" className="rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle}
                placeholder="pH" value={ph} onChange={(e) => setPh(e.target.value)} />
              <input type="number" inputMode="decimal" className="rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle}
                placeholder="Amonia (ppm)" value={amoniaPpm} onChange={(e) => setAmoniaPpm(e.target.value)} />
              <input type="number" inputMode="decimal" className="rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle}
                placeholder="Nitrit (ppm)" value={nitritPpm} onChange={(e) => setNitritPpm(e.target.value)} />
              <input type="number" inputMode="decimal" className="rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle}
                placeholder="Nitrat (ppm)" value={nitratPpm} onChange={(e) => setNitratPpm(e.target.value)} />
              <input type="number" inputMode="decimal" className="rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle}
                placeholder="Salinitas (ppt)" value={salinitasPpt} onChange={(e) => setSalinitasPpt(e.target.value)} />
            </div>
            <div className="flex gap-2">
              <input type="date" className="flex-1 min-w-0 rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle}
                value={airTanggal} onChange={(e) => setAirTanggal(e.target.value)} />
              <input className="flex-[2] min-w-0 rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle}
                placeholder="Catatan (opsional)" value={airCatatan} onChange={(e) => setAirCatatan(e.target.value)} />
            </div>
            {airError && <p className="text-xs" style={{ color: 'var(--neg)' }}>{airError}</p>}
            <motion.button
              className="w-full py-2 rounded-xl text-xs font-bold"
              style={{ ...buttonStyle, opacity: airSaving ? 0.6 : 1 }}
              whileTap={{ scale: 0.97 }} transition={springs.snappy}
              disabled={airSaving}
              onClick={simpanAir}
            >
              {airSaving ? 'Menyimpan…' : 'Simpan tes air'}
            </motion.button>

            {airLoading && <p className="text-xs" style={{ color: 'var(--text3)' }}>Memuat…</p>}
            {!airLoading && airRiwayat.length === 0 && !airError && (
              <p className="text-xs" style={{ color: 'var(--text3)' }}>Belum ada tes air tercatat.</p>
            )}
            {airRiwayat.slice(0, 6).map((r) => (
              <div key={r.id} className="rounded-lg p-2 flex flex-col gap-1" style={{ background: 'var(--bg)', boxShadow: 'var(--neu-inset)' }}>
                <p className="text-[11px] font-semibold tabular-nums" style={{ color: 'var(--text)' }}>{r.tanggal}</p>
                {r.penilaian.length === 0 ? (
                  <p className="text-[10px]" style={{ color: 'var(--text3)' }}>Tidak ada parameter yang bisa dinilai.</p>
                ) : r.penilaian.map((p) => (
                  <p key={p.parameter} className="text-[10px]" style={{ color: STATUS_AIR_COLOR[p.status] }}>
                    {p.parameter}: {p.nilai} — {p.status}{p.saran ? `. ${p.saran}` : ''}
                  </p>
                ))}
              </div>
            ))}
          </>
        )}
      </div>

      {/* ─────────────────────────── KEPADATAN ─────────────────────────── */}
      {kepadatan.length > 0 && (
        <div className="rounded-[18px] p-4 flex flex-col gap-2" style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}>
          <p className="text-sm font-bold" style={{ color: 'var(--text)' }}>🏠 Kepadatan kandang</p>
          {kepadatan.map((k) => (
            <div key={k.kandangId} className="text-[11px] flex justify-between" style={{ color: k.sesak ? 'var(--neg)' : 'var(--text2)' }}>
              <span style={{ color: 'var(--text)' }}>{k.nama}</span>
              <span>{k.butuhLiter}L / {k.tersedia}L{k.sesak ? ` — kurang ${k.kelebihan}L` : ' — aman'}</span>
            </div>
          ))}
        </div>
      )}

      {/* ─────────────────────────── KARANTINA ─────────────────────────── */}
      {karantina.length > 0 && (
        <div className="rounded-[18px] p-4 flex flex-col gap-2" style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}>
          <p className="text-sm font-bold" style={{ color: 'var(--text)' }}>🦠 Karantina berjalan</p>
          {karantina.map((k) => (
            <div key={k.hewanId} className="text-[11px] flex justify-between" style={{ color: 'var(--text2)' }}>
              <span style={{ color: 'var(--text)' }}>{k.nama}</span>
              <span>{k.sisaHari} hari lagi · selesai {k.selesai}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
