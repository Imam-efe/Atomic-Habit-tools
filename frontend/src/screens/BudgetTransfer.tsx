/**
 * Transfer antar rekening.
 *
 * Memindahkan uang bukan pemasukan dan bukan pengeluaran. Sebelum layar ini
 * ada, satu-satunya cara mencatatnya adalah sepasang transaksi biasa — dan
 * setiap laporan pengeluaran jadi membengkak oleh uang yang cuma berpindah
 * tempat.
 *
 * Saldo kedua rekening ikut benar dengan sendirinya: server menurunkannya dari
 * transaksi dan transfer, jadi layar ini tidak menghitung saldo sendiri dan
 * tidak bisa menyimpang darinya.
 */

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { springs } from '@/tokens/motion';
import { apiFetch } from '@/lib/api';
import { formatRp } from '@/lib/currency';
import { todayISO } from '@/lib/date';
import { tampilkanGagal } from '@/stores/gagalToastStore';

interface Rekening {
  id: string;
  name: string;
  account_type: string;
  balance: number;
}

interface Transfer {
  id: string;
  dariRekeningId: string;
  keRekeningId: string;
  dariNama: string | null;
  keNama: string | null;
  jumlah: number;
  tanggal: string;
  catatan: string | null;
}

export function BudgetTransfer({ onChanged }: { onChanged?: () => void }) {
  const [rekening, setRekening] = useState<Rekening[]>([]);
  const [daftar, setDaftar] = useState<Transfer[]>([]);
  const [memuat, setMemuat] = useState(true);
  // Gagal memuat harus bisa dibedakan dari "belum ada transfer": layar kosong
  // yang sebetulnya gagal akan membuat pengguna mencatat ulang transfer yang
  // datanya sebenarnya masih aman di server.
  const [gagalMuat, setGagalMuat] = useState(false);

  const [buka, setBuka] = useState(false);
  const [dari, setDari] = useState('');
  const [ke, setKe] = useState('');
  const [jumlah, setJumlah] = useState('');
  const [tanggal, setTanggal] = useState(todayISO());
  const [catatan, setCatatan] = useState('');
  const [menyimpan, setMenyimpan] = useState(false);
  const [galatForm, setGalatForm] = useState('');

  const muat = async () => {
    setMemuat(true);
    try {
      const [r, t] = await Promise.all([
        apiFetch<Rekening[]>('/bank-accounts'),
        apiFetch<{ transfer: Transfer[] }>('/transfer'),
      ]);
      setRekening(r);
      setDaftar(t.transfer);
      setGagalMuat(false);
    } catch {
      setGagalMuat(true);
    }
    setMemuat(false);
  };

  useEffect(() => { muat(); }, []);

  const angka = Math.round(Number(jumlah.replace(/\D/g, '')) || 0);
  const rekDari = rekening.find((r) => r.id === dari);
  // Peringatan, bukan larangan: rekening bisa saja memang minus, dan server
  // yang berhak menolak. Layar cuma memberi tahu lebih awal.
  const saldoKurang = !!rekDari && angka > rekDari.balance;

  const simpan = async () => {
    setGalatForm('');
    if (!dari || !ke) return setGalatForm('Pilih rekening asal dan tujuan.');
    if (dari === ke) return setGalatForm('Rekening asal dan tujuan tidak boleh sama.');
    if (angka < 1) return setGalatForm('Isi jumlah yang dipindahkan.');

    setMenyimpan(true);
    try {
      await apiFetch('/transfer', {
        method: 'POST',
        body: JSON.stringify({
          dari_rekening_id: dari,
          ke_rekening_id: ke,
          jumlah: angka,
          tanggal,
          catatan: catatan.trim() || undefined,
        }),
      });
      setDari(''); setKe(''); setJumlah(''); setCatatan(''); setTanggal(todayISO());
      setBuka(false);
      await muat();
      onChanged?.();
    } catch (err) {
      // Formulir sengaja dibiarkan terbuka dengan isinya utuh: menutupnya
      // setelah gagal berarti mengetik ulang semuanya.
      tampilkanGagal('Gagal menyimpan transfer', err);
    }
    setMenyimpan(false);
  };

  const hapus = async (id: string) => {
    if (!confirm('Hapus transfer ini? Saldo kedua rekening akan dikembalikan.')) return;
    try {
      await apiFetch(`/transfer/${id}`, { method: 'DELETE' });
      await muat();
      onChanged?.();
    } catch (err) {
      tampilkanGagal('Gagal menghapus transfer', err);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <button
        onClick={() => setBuka((v) => !v)}
        className="w-full py-3 rounded-2xl text-sm font-bold"
        style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)', color: 'var(--text)' }}
      >
        {buka ? 'Tutup' : '🔄 Pindahkan uang antar rekening'}
      </button>

      <AnimatePresence>
        {buka && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={springs.gentle}
            className="overflow-hidden"
          >
            <div className="rounded-2xl p-4 flex flex-col gap-2.5"
              style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}>

              {rekening.length < 2 ? (
                <p className="text-xs" style={{ color: 'var(--text2)' }}>
                  Transfer butuh dua rekening. Tambah rekening dulu di menu Lainnya.
                </p>
              ) : (
                <>
                  <label className="text-[10px] font-bold uppercase" style={{ color: 'var(--text3)' }}>Dari</label>
                  <select value={dari} onChange={(e) => setDari(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl text-sm"
                    style={{ background: 'var(--bg)', color: 'var(--text)' }}>
                    <option value="">Pilih rekening asal</option>
                    {rekening.map((r) => (
                      <option key={r.id} value={r.id}>{r.name} — {formatRp(r.balance)}</option>
                    ))}
                  </select>

                  <label className="text-[10px] font-bold uppercase" style={{ color: 'var(--text3)' }}>Ke</label>
                  <select value={ke} onChange={(e) => setKe(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl text-sm"
                    style={{ background: 'var(--bg)', color: 'var(--text)' }}>
                    <option value="">Pilih rekening tujuan</option>
                    {rekening.filter((r) => r.id !== dari).map((r) => (
                      <option key={r.id} value={r.id}>{r.name} — {formatRp(r.balance)}</option>
                    ))}
                  </select>

                  <input
                    inputMode="numeric" placeholder="Jumlah (Rp)"
                    value={jumlah ? formatRp(angka) : ''}
                    onChange={(e) => setJumlah(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl text-sm"
                    style={{ background: 'var(--bg)', color: 'var(--text)' }}
                  />
                  {saldoKurang && (
                    <p className="text-[11px]" style={{ color: 'var(--neg)' }}>
                      Saldo {rekDari!.name} cuma {formatRp(rekDari!.balance)} — transfer ini membuatnya minus.
                    </p>
                  )}

                  <input type="date" value={tanggal} onChange={(e) => setTanggal(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl text-sm"
                    style={{ background: 'var(--bg)', color: 'var(--text)' }} />

                  <input placeholder="Catatan (opsional)" value={catatan}
                    onChange={(e) => setCatatan(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl text-sm"
                    style={{ background: 'var(--bg)', color: 'var(--text)' }} />

                  {galatForm && <p className="text-[11px]" style={{ color: 'var(--neg)' }}>{galatForm}</p>}

                  <button onClick={simpan} disabled={menyimpan}
                    className="w-full py-3 rounded-xl text-sm font-bold mt-1"
                    style={{ background: 'var(--accentFill)', color: '#fff', opacity: menyimpan ? 0.6 : 1 }}>
                    {menyimpan ? 'Menyimpan…' : 'Pindahkan'}
                  </button>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {memuat ? (
        <p className="text-xs text-center py-6" style={{ color: 'var(--text3)' }}>Memuat…</p>
      ) : gagalMuat ? (
        <div className="rounded-2xl p-4 text-center" style={{ background: 'var(--surface)' }}>
          <p className="text-sm font-semibold" style={{ color: 'var(--text2)' }}>📡 Gagal memuat transfer</p>
          <p className="text-xs mb-2" style={{ color: 'var(--text3)' }}>
            Datamu aman di server — ini cuma gagal mengambilnya.
          </p>
          <button onClick={muat} className="text-xs font-bold" style={{ color: 'var(--accent)' }}>Coba lagi</button>
        </div>
      ) : daftar.length === 0 ? (
        <p className="text-xs text-center py-6" style={{ color: 'var(--text3)' }}>
          Belum ada transfer. Uang yang cuma pindah rekening dicatat di sini, bukan sebagai pengeluaran.
        </p>
      ) : (
        <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}>
          {daftar.map((t, i) => (
            <div key={t.id}>
              {i > 0 && <div className="h-px mx-4" style={{ background: 'var(--sep)' }} />}
              <div className="flex items-center justify-between px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold truncate" style={{ color: 'var(--text)' }}>
                    {t.dariNama ?? 'Rekening terhapus'} → {t.keNama ?? 'Rekening terhapus'}
                  </p>
                  <p className="text-[10px]" style={{ color: 'var(--text3)' }}>
                    {t.tanggal}{t.catatan ? ` · ${t.catatan}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <span className="text-sm font-bold" style={{ color: 'var(--text)' }}>{formatRp(t.jumlah)}</span>
                  <button onClick={() => hapus(t.id)} aria-label="Hapus transfer"
                    className="w-6 h-6 flex items-center justify-center bg-red-950/10 rounded-lg">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--neg)" strokeWidth="2.5">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
