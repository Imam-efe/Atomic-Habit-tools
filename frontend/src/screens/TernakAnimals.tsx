/**
 * Tab Hewan — kartu per baris hewan: tambah, detail, riwayat log, pindah
 * kandang, ubah status.
 *
 * Baris ber-`jumlah` lebih dari satu (delapan guppy dicatat sebagai satu
 * baris) tidak boleh menampilkan angka ukuran seolah itu punya keseluruhan
 * kandang: 180 gram di baris tiga puluh ekor lele adalah berat SATU ekor
 * contoh, bukan berat seluruhnya. Riwayat log menegaskan ini di tiap baris
 * yang membawa `nilai`.
 */

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { springs } from '@/tokens/motion';
import { apiFetch } from '@/lib/api';
import { todayISO } from '@/lib/date';
import {
  describeError, inputStyle, buttonStyle,
  STATUS_HEWAN_OPTIONS, STATUS_HEWAN_LABEL,
  type HewanItem, type PilihanSubjek,
} from './Ternak';

const STATUS_COLOR: Record<string, string> = {
  hidup: 'var(--pos)', mati: 'var(--neg)', dilepas: 'var(--text3)', dijual: 'var(--info)',
};

const KESULITAN_COLOR: Record<string, string> = {
  mudah: 'var(--pos)', sedang: 'var(--warn)', sulit: 'var(--neg)',
};

interface LogRow {
  id: string;
  kodeTugas: string;
  tanggal: string;
  nilai: number | null;
  catatan: string | null;
}

interface FormState {
  animalId: string | null;
  emoji: string;
  namaKustom: string;
  namaPanggilan: string;
  kandangId: string;
  jumlah: string;
  kelamin: string;
  tanggalLahir: string;
  tanggalMasuk: string;
  asal: string;
  catatan: string;
}

function formKosong(): FormState {
  return {
    animalId: null, emoji: '🐾', namaKustom: '', namaPanggilan: '', kandangId: '',
    jumlah: '1', kelamin: '', tanggalLahir: '', tanggalMasuk: todayISO(), asal: '', catatan: '',
  };
}

export function TernakAnimalsTab({
  hewan, subjekKandang, prefill, clearPrefill, focus, clearFocus, onChanged,
}: {
  hewan: HewanItem[];
  subjekKandang: PilihanSubjek[];
  prefill: { animalId: string; nama: string; emoji: string; kandangId: string | null } | null;
  clearPrefill: () => void;
  focus: PilihanSubjek | null;
  clearFocus: () => void;
  onChanged: () => void;
}) {
  const [form, setForm] = useState<FormState | null>(null);
  const [formNamaCatalog, setFormNamaCatalog] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  // Peringatan opsional dari POST /ternak/hewan (mis. spesies ini punya
  // tugas bersasaran kandang tapi hewan barusan tidak dimasukkan ke kandang
  // mana pun) — ditampilkan tepat setelah tersimpan, saat kesalahannya
  // terjadi, bukan dibiarkan pengguna baru sadar ketika jadwalnya kosong
  // tanpa sebab yang jelas.
  const [notice, setNotice] = useState('');

  // Datang dari tombol "Pelihara ini" di Katalog — buka formulir dengan
  // animalId sudah terisi, bukan mengharuskan pengguna mencarinya lagi.
  useEffect(() => {
    if (prefill) {
      setForm({ ...formKosong(), animalId: prefill.animalId, emoji: prefill.emoji, kandangId: prefill.kandangId ?? '' });
      setFormNamaCatalog(prefill.nama);
      setFormError('');
      clearPrefill();
    }
  }, [prefill]);

  const [openId, setOpenId] = useState<string | null>(focus?.id ?? null);
  const [logs, setLogs] = useState<Record<string, LogRow[]>>({});
  const [logLoading, setLogLoading] = useState<string | null>(null);
  const [logError, setLogError] = useState<Record<string, string>>({});
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const [rowBusy, setRowBusy] = useState<string | null>(null);

  useEffect(() => {
    if (focus) {
      setOpenId(focus.id);
      loadLog(focus.id);
      clearFocus();
    }
  }, [focus]);

  const loadLog = async (hewanId: string) => {
    setLogLoading(hewanId);
    setLogError((prev) => ({ ...prev, [hewanId]: '' }));
    try {
      const res = await apiFetch<{ log: LogRow[] }>(`/ternak/log/hewan/${hewanId}`);
      setLogs((prev) => ({ ...prev, [hewanId]: res.log }));
    } catch (err) {
      setLogError((prev) => ({ ...prev, [hewanId]: describeError(err, 'Gagal memuat riwayat.') }));
    }
    setLogLoading(null);
  };

  const toggleDetail = (id: string) => {
    if (openId === id) { setOpenId(null); return; }
    setOpenId(id);
    if (!logs[id]) loadLog(id);
  };

  const simpanHewan = async () => {
    if (!form) return;
    if (!form.animalId && !form.namaKustom.trim()) {
      setFormError('Isi nama, atau pilih dari Katalog dulu.');
      return;
    }
    const jumlah = parseInt(form.jumlah, 10) || 1;
    setSaving(true);
    setFormError('');
    try {
      const res = await apiFetch<{ id: string; peringatan?: string }>('/ternak/hewan', {
        method: 'POST',
        body: JSON.stringify({
          kandangId: form.kandangId || undefined,
          animalId: form.animalId ?? undefined,
          namaKustom: form.animalId ? undefined : form.namaKustom.trim(),
          namaPanggilan: form.namaPanggilan.trim() || undefined,
          jumlah,
          kelamin: form.kelamin.trim() || undefined,
          tanggalLahir: form.tanggalLahir || undefined,
          tanggalMasuk: form.tanggalMasuk,
          asal: form.asal.trim() || undefined,
          catatan: form.catatan.trim() || undefined,
        }),
      });
      setForm(null);
      setNotice(res.peringatan ?? '');
      onChanged();
    } catch (err) {
      setFormError(describeError(err, 'Gagal menyimpan hewan.'));
    }
    setSaving(false);
  };

  const pindahKandang = async (hewanId: string, kandangId: string) => {
    setRowBusy(hewanId);
    setRowError((prev) => ({ ...prev, [hewanId]: '' }));
    try {
      await apiFetch(`/ternak/hewan/${hewanId}`, {
        method: 'PATCH',
        body: JSON.stringify({ kandangId: kandangId || null }),
      });
      onChanged();
    } catch (err) {
      setRowError((prev) => ({ ...prev, [hewanId]: describeError(err, 'Gagal memindah kandang.') }));
    }
    setRowBusy(null);
  };

  const ubahStatus = async (hewanId: string, status: string) => {
    if (status !== 'hidup' && !confirm(`Ubah status jadi "${STATUS_HEWAN_LABEL[status]}"?`)) return;
    setRowBusy(hewanId);
    setRowError((prev) => ({ ...prev, [hewanId]: '' }));
    try {
      await apiFetch(`/ternak/hewan/${hewanId}`, { method: 'PATCH', body: JSON.stringify({ status }) });
      onChanged();
    } catch (err) {
      setRowError((prev) => ({ ...prev, [hewanId]: describeError(err, 'Gagal mengubah status.') }));
    }
    setRowBusy(null);
  };

  const hapusHewan = async (hewanId: string) => {
    if (!confirm('Hapus hewan ini beserta riwayatnya?')) return;
    setRowBusy(hewanId);
    try {
      await apiFetch(`/ternak/hewan/${hewanId}`, { method: 'DELETE' });
      setOpenId(null);
      onChanged();
    } catch (err) {
      setRowError((prev) => ({ ...prev, [hewanId]: describeError(err, 'Gagal menghapus.') }));
    }
    setRowBusy(null);
  };

  const namaKandang = (id: string | null) => subjekKandang.find((k) => k.id === id)?.nama ?? null;

  return (
    <div className="flex flex-col gap-3">
      {!form && (
        <motion.button
          className="w-full py-2.5 rounded-xl text-xs font-bold"
          style={buttonStyle}
          whileTap={{ scale: 0.97 }}
          transition={springs.snappy}
          onClick={() => { setForm(formKosong()); setFormNamaCatalog(''); setFormError(''); setNotice(''); }}
        >
          + Tambah hewan
        </motion.button>
      )}

      {notice && (
        <div className="rounded-xl p-3 text-xs border-l-[3px] flex items-start justify-between gap-2" style={{ background: 'rgba(255,159,10,0.1)', borderColor: '#ff9f0a', color: 'var(--text2)' }}>
          <span>⚠️ {notice}</span>
          <button className="flex-shrink-0 text-[11px] font-bold" style={{ color: 'var(--text3)' }} onClick={() => setNotice('')} aria-label="Tutup peringatan">✕</button>
        </div>
      )}

      {form && (
        <div className="rounded-[18px] p-4 flex flex-col gap-2.5" style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}>
          <p className="text-sm font-bold" style={{ color: 'var(--text)' }}>
            {form.animalId ? `${form.emoji} ${formNamaCatalog}` : 'Hewan baru'}
          </p>
          {!form.animalId && (
            <input className="w-full rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle}
              placeholder="Nama jenis hewan (di luar katalog)"
              value={form.namaKustom} onChange={(e) => setForm({ ...form, namaKustom: e.target.value })} />
          )}
          <input className="w-full rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle}
            placeholder="Nama panggilan (opsional)" value={form.namaPanggilan}
            onChange={(e) => setForm({ ...form, namaPanggilan: e.target.value })} />
          <select className="w-full rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle}
            value={form.kandangId} onChange={(e) => setForm({ ...form, kandangId: e.target.value })}>
            <option value="">Tanpa kandang</option>
            {subjekKandang.map((k) => <option key={k.id} value={k.id}>{k.nama}</option>)}
          </select>
          <div className="flex gap-2">
            <input type="number" inputMode="numeric" min={1} className="flex-1 min-w-0 rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle}
              placeholder="Jumlah ekor" value={form.jumlah} onChange={(e) => setForm({ ...form, jumlah: e.target.value })} />
            <input className="flex-1 min-w-0 rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle}
              placeholder="Kelamin (opsional)" value={form.kelamin} onChange={(e) => setForm({ ...form, kelamin: e.target.value })} />
          </div>
          <div className="flex gap-2">
            <input type="date" className="flex-1 min-w-0 rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle}
              value={form.tanggalMasuk} onChange={(e) => setForm({ ...form, tanggalMasuk: e.target.value })} />
            <input className="flex-1 min-w-0 rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle}
              placeholder="Asal (opsional)" value={form.asal} onChange={(e) => setForm({ ...form, asal: e.target.value })} />
          </div>
          {formError && <p className="text-xs" style={{ color: 'var(--neg)' }}>{formError}</p>}
          <div className="flex gap-2">
            <motion.button className="flex-1 py-2 rounded-xl text-xs font-bold" style={{ ...buttonStyle, opacity: saving ? 0.6 : 1 }}
              whileTap={{ scale: 0.97 }} disabled={saving} onClick={simpanHewan}>
              {saving ? 'Menyimpan…' : 'Simpan'}
            </motion.button>
            <button className="flex-1 py-2 rounded-xl text-xs font-bold" style={buttonStyle} onClick={() => setForm(null)}>Batal</button>
          </div>
        </div>
      )}

      {hewan.length === 0 && !form && (
        <p className="text-xs text-center py-10" style={{ color: 'var(--text3)' }}>Belum ada hewan tercatat.</p>
      )}

      {hewan.map((h) => {
        const isOpen = openId === h.id;
        const contoh = h.jumlah > 1;
        return (
          <motion.div key={h.id} layout="position" className="rounded-[18px] p-4" style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}>
            <button className="w-full text-left flex items-start gap-3" onClick={() => toggleDetail(h.id)}>
              <span className="text-2xl flex-shrink-0" aria-hidden>{h.emoji}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold truncate" style={{ color: 'var(--text)' }}>
                  {h.nama}{contoh ? ` · ${h.jumlah} ekor` : ''}
                </p>
                <p className="text-[11px] truncate" style={{ color: 'var(--text3)' }}>
                  {namaKandang(h.kandangId) ?? 'Tanpa kandang'}
                  {h.kesulitan && (
                    <span style={{ color: KESULITAN_COLOR[h.kesulitan] ?? 'var(--text3)' }}> · {h.kesulitan}</span>
                  )}
                </p>
                {h.tugasKandangDorman && (
                  <p className="text-[10px] mt-0.5" style={{ color: 'var(--warn)' }}>
                    💤 Belum punya kandang — sebagian tugas perawatannya belum terjadwal
                  </p>
                )}
              </div>
              <span className="text-[11px] font-bold flex-shrink-0" style={{ color: STATUS_COLOR[h.status] ?? 'var(--text3)' }}>
                {STATUS_HEWAN_LABEL[h.status] ?? h.status}
              </span>
            </button>

            {isOpen && (
              <div className="mt-3 pt-3 flex flex-col gap-2.5" style={{ borderTop: '1px solid var(--sep)' }}>
                {contoh && (
                  <p className="text-[10px] italic" style={{ color: 'var(--text3)' }}>
                    Baris ini mewakili {h.jumlah} ekor — angka ukur di bawah adalah contoh dari satu ekor, bukan sensus semuanya.
                  </p>
                )}

                <div>
                  <p className="text-[11px] font-bold mb-1" style={{ color: 'var(--text)' }}>Riwayat</p>
                  {logLoading === h.id && <p className="text-[11px]" style={{ color: 'var(--text3)' }}>Memuat…</p>}
                  {logError[h.id] && <p className="text-[11px]" style={{ color: 'var(--neg)' }}>{logError[h.id]}</p>}
                  {logs[h.id] && logs[h.id].length === 0 && !logError[h.id] && (
                    <p className="text-[11px]" style={{ color: 'var(--text3)' }}>Belum ada catatan.</p>
                  )}
                  {(logs[h.id] ?? []).slice(0, 10).map((l) => (
                    <div key={l.id} className="text-[11px] flex justify-between" style={{ color: 'var(--text2)' }}>
                      <span>{l.tanggal} · {l.kodeTugas}</span>
                      <span>
                        {l.nilai !== null ? `${l.nilai}${contoh ? ' (contoh)' : ''}` : ''}
                        {l.catatan ? ` ${l.catatan}` : ''}
                      </span>
                    </div>
                  ))}
                </div>

                <label className="flex flex-col gap-1">
                  <span className="text-[10px] font-bold" style={{ color: 'var(--text3)' }}>Pindah kandang</span>
                  <select className="w-full rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle}
                    value={h.kandangId ?? ''} disabled={rowBusy === h.id}
                    onChange={(e) => pindahKandang(h.id, e.target.value)}>
                    <option value="">Tanpa kandang</option>
                    {subjekKandang.map((k) => <option key={k.id} value={k.id}>{k.nama}</option>)}
                  </select>
                </label>

                <div>
                  <p className="text-[10px] font-bold mb-1" style={{ color: 'var(--text3)' }}>Ubah status</p>
                  <div className="flex gap-1.5 flex-wrap">
                    {STATUS_HEWAN_OPTIONS.map((s) => (
                      <button key={s}
                        className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold"
                        style={{ background: h.status === s ? 'var(--accentFill)' : 'var(--bg)', color: h.status === s ? 'white' : 'var(--text2)', boxShadow: h.status === s ? 'none' : 'var(--neu-inset)' }}
                        disabled={rowBusy === h.id}
                        onClick={() => ubahStatus(h.id, s)}
                      >
                        {STATUS_HEWAN_LABEL[s]}
                      </button>
                    ))}
                  </div>
                </div>

                {rowError[h.id] && <p className="text-[11px]" style={{ color: 'var(--neg)' }}>{rowError[h.id]}</p>}

                <button className="text-[11px] font-bold text-left" style={{ color: 'var(--neg)' }} onClick={() => hapusHewan(h.id)}>
                  Hapus hewan ini
                </button>
              </div>
            )}
          </motion.div>
        );
      })}
    </div>
  );
}
