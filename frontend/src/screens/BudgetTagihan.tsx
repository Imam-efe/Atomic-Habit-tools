/**
 * Tagihan terjadwal, dan proyeksi saldo yang menyusul darinya.
 *
 * Tagihan di sini TIDAK memposting apa pun sendiri — bedanya dengan transaksi
 * berulang. Ia cuma terlihat datang, dan transaksinya baru lahir saat tombol
 * "Sudah bayar" ditekan. Alasannya bukan kenyamanan: saldo yang menganggap
 * tagihan sudah lunas padahal belum dibayar melaporkan uang yang masih ada di
 * rekening sebagai sudah pergi, dan saldo seperti itu tidak bisa dipakai
 * memutuskan apa pun.
 *
 * Proyeksinya menonjolkan satu hal: tanggal pertama saldo menembus nol. Saldo
 * akhir yang positif masih bisa menyembunyikan seminggu minus di tengah jalan,
 * dan minggu itulah yang jadi masalah — tagihan yang ditolak karena dana kurang
 * tidak peduli bahwa gaji datang tiga hari kemudian.
 */

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { springs } from '@/tokens/motion';
import { apiFetch } from '@/lib/api';
import { formatRp } from '@/lib/currency';
import { todayISO } from '@/lib/date';
import { tampilkanGagal } from '@/stores/gagalToastStore';
import { useKategoriKeuangan, labelOpsi } from '@/lib/kategoriKeuangan';
import { usePengaturanUang } from '@/lib/pengaturanUang';

interface Tagihan {
  id: string;
  nama: string;
  jumlah: number;
  jatuhTempo: string;
  ulang: string | null;
  jenis: string;
  kategori: string;
  bankAccountId: string | null;
  rekeningNama: string | null;
  aktif: boolean;
  catatan: string | null;
  jumlahBayar: number;
  /** Negatif berarti telat. Dihitung server supaya "hari ini" selalu WIB. */
  sisaHari: number;
}

interface Proyeksi {
  mulai: string;
  hingga: string;
  hari: number;
  saldoAwal: number;
  saldoAkhir: number;
  totalKeluar: number;
  totalMasuk: number;
  tanggalMinus: string | null;
}

interface Rekening {
  id: string;
  name: string;
  account_type: string;
}

const ULANG_LABEL: Record<string, string> = {
  daily: 'tiap hari',
  weekly: 'tiap pekan',
  monthly: 'tiap bulan',
};

export function BudgetTagihan({ onChanged }: { onChanged?: () => void }) {
  const kategori = useKategoriKeuangan();
  const { pengaturan, siap: pengaturanSiap } = usePengaturanUang();

  const [daftar, setDaftar] = useState<Tagihan[]>([]);
  const [proyeksi, setProyeksi] = useState<Proyeksi | null>(null);
  const [rekening, setRekening] = useState<Rekening[]>([]);
  const [memuat, setMemuat] = useState(true);
  // Gagal memuat harus bisa dibedakan dari "belum ada tagihan": layar kosong
  // yang sebetulnya gagal akan membuat pengguna mencatat ulang tagihan yang
  // datanya masih aman di server.
  const [gagalMuat, setGagalMuat] = useState(false);

  const [buka, setBuka] = useState(false);
  const [sunting, setSunting] = useState<string | null>(null);
  const [nama, setNama] = useState('');
  const [jumlah, setJumlah] = useState('');
  const [jatuhTempo, setJatuhTempo] = useState(todayISO());
  const [ulang, setUlang] = useState('monthly');
  const [jenis, setJenis] = useState<'expense' | 'income'>('expense');
  const [kat, setKat] = useState('');
  const [rekeningId, setRekeningId] = useState('');
  const [menyimpan, setMenyimpan] = useState(false);
  const [galat, setGalat] = useState('');

  const muat = async () => {
    setMemuat(true);
    try {
      const [t, p, r] = await Promise.all([
        apiFetch<{ tagihan: Tagihan[] }>('/tagihan'),
        apiFetch<Proyeksi>(`/proyeksi?days=${pengaturan.hariProyeksi}`),
        apiFetch<Rekening[]>('/bank-accounts'),
      ]);
      setDaftar(t.tagihan);
      setProyeksi(p);
      setRekening(r);
      setGagalMuat(false);
    } catch {
      setGagalMuat(true);
    }
    setMemuat(false);
  };

  // Menunggu horizon proyeksinya diketahui: memuat dengan 30 hari lalu
  // memuat ulang dengan angka lain membuat kartu proyeksinya berkedip.
  useEffect(() => {
    if (!pengaturanSiap) return;
    muat();
  }, [pengaturanSiap, pengaturan.hariProyeksi]);

  const angka = Math.round(Number(jumlah.replace(/\D/g, '')) || 0);
  const opsiKategori = jenis === 'expense' ? kategori.expense : kategori.income;

  const resetForm = () => {
    setSunting(null); setNama(''); setJumlah(''); setJatuhTempo(todayISO());
    setUlang('monthly'); setJenis('expense'); setKat(''); setRekeningId(''); setGalat('');
  };

  const bukaSunting = (t: Tagihan) => {
    setSunting(t.id);
    setNama(t.nama);
    setJumlah(String(t.jumlah));
    setJatuhTempo(t.jatuhTempo);
    setUlang(t.ulang ?? '');
    setJenis(t.jenis === 'income' ? 'income' : 'expense');
    setKat(t.kategori);
    setRekeningId(t.bankAccountId ?? '');
    setGalat('');
    setBuka(true);
  };

  const simpan = async () => {
    setGalat('');
    if (!nama.trim()) return setGalat('Isi nama tagihannya.');
    if (angka < 1) return setGalat('Isi perkiraan nominalnya.');

    setMenyimpan(true);
    try {
      const isi = {
        nama: nama.trim(),
        jumlah: angka,
        jatuh_tempo: jatuhTempo,
        ulang: ulang || undefined,
        jenis,
        kategori: kat || opsiKategori[0]?.nama,
        bank_account_id: rekeningId || undefined,
      };
      await apiFetch(sunting ? `/tagihan/${sunting}` : '/tagihan', {
        method: sunting ? 'PUT' : 'POST',
        body: JSON.stringify(isi),
      });
      resetForm();
      setBuka(false);
      await muat();
      onChanged?.();
    } catch (err) {
      // Formulir sengaja dibiarkan terbuka dengan isinya utuh: menutupnya
      // setelah gagal berarti mengetik ulang semuanya.
      tampilkanGagal(sunting ? 'Gagal menyimpan perubahan tagihan' : 'Gagal menyimpan tagihan', err);
    }
    setMenyimpan(false);
  };

  const bayar = async (t: Tagihan) => {
    const jawab = prompt(
      `Nominal yang dibayar untuk ${t.nama} (${t.jatuhTempo})?`,
      String(t.jumlah)
    );
    if (jawab === null) return;
    const dibayar = Math.round(Number(jawab.replace(/\D/g, '')) || 0);
    if (dibayar < 1) return;

    try {
      await apiFetch(`/tagihan/${t.id}/bayar`, {
        method: 'POST',
        body: JSON.stringify({ jumlah: dibayar, dibayar_pada: todayISO() }),
      });
      await muat();
      onChanged?.();
    } catch (err) {
      tampilkanGagal('Gagal mencatat pembayaran', err);
    }
  };

  const batalBayar = async (t: Tagihan) => {
    if (!confirm(`Batalkan pembayaran terakhir ${t.nama}? Saldo akan dikembalikan.`)) return;
    try {
      await apiFetch(`/tagihan/${t.id}/bayar`, { method: 'DELETE' });
      await muat();
      onChanged?.();
    } catch (err) {
      tampilkanGagal('Gagal membatalkan pembayaran', err);
    }
  };

  const hapus = async (t: Tagihan) => {
    if (!confirm(`Hapus tagihan ${t.nama}? Transaksi yang sudah tercatat tetap ada.`)) return;
    try {
      await apiFetch(`/tagihan/${t.id}`, { method: 'DELETE' });
      await muat();
      onChanged?.();
    } catch (err) {
      tampilkanGagal('Gagal menghapus tagihan', err);
    }
  };

  const warnaSisa = (sisaHari: number) =>
    sisaHari < 0 ? 'var(--neg)' : sisaHari <= 3 ? '#d97706' : 'var(--text3)';

  const labelSisa = (sisaHari: number) =>
    sisaHari < 0
      ? `telat ${Math.abs(sisaHari)} hari`
      : sisaHari === 0
        ? 'jatuh tempo hari ini'
        : `${sisaHari} hari lagi`;

  return (
    <div className="flex flex-col gap-3">
      {/* Proyeksi saldo */}
      {proyeksi && (
        <div className="rounded-2xl p-4" style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}>
          <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: 'var(--text3)' }}>
            Proyeksi {proyeksi.hari} hari
          </p>
          <div className="flex items-end justify-between gap-2">
            <div>
              <p className="text-[10px]" style={{ color: 'var(--text3)' }}>Sekarang</p>
              <p className="text-sm font-bold" style={{ color: 'var(--text)' }}>{formatRp(proyeksi.saldoAwal)}</p>
            </div>
            <span className="text-xs pb-1" style={{ color: 'var(--text3)' }}>→</span>
            <div className="text-right">
              <p className="text-[10px]" style={{ color: 'var(--text3)' }}>Perkiraan {proyeksi.hingga}</p>
              <p className="text-sm font-bold"
                style={{ color: proyeksi.saldoAkhir < 0 ? 'var(--neg)' : 'var(--text)' }}>
                {formatRp(proyeksi.saldoAkhir)}
              </p>
            </div>
          </div>

          <div className="flex gap-3 mt-2 text-[10px]" style={{ color: 'var(--text3)' }}>
            <span>keluar {formatRp(proyeksi.totalKeluar)}</span>
            <span>masuk {formatRp(proyeksi.totalMasuk)}</span>
          </div>

          {/* Inti dari proyeksi ini. Saldo akhir yang positif bisa
              menyembunyikan minus di tengah horizon, jadi tanggalnya disebut
              terpisah alih-alih dibiarkan tenggelam dalam angka akhir. */}
          {proyeksi.tanggalMinus && (
            <p className="text-[11px] mt-2 font-semibold" style={{ color: 'var(--neg)' }}>
              ⚠️ Saldo menembus nol pada {proyeksi.tanggalMinus}
            </p>
          )}
        </div>
      )}

      <button
        onClick={() => { if (buka) resetForm(); setBuka((v) => !v); }}
        className="w-full py-3 rounded-2xl text-sm font-bold"
        style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)', color: 'var(--text)' }}
      >
        {buka ? 'Tutup' : '🧾 Tambah tagihan terjadwal'}
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

              <div className="flex gap-2">
                {(['expense', 'income'] as const).map((j) => (
                  <button key={j} onClick={() => { setJenis(j); setKat(''); }}
                    className="flex-1 py-2 rounded-xl text-xs font-semibold"
                    style={{
                      background: jenis === j ? (j === 'expense' ? 'var(--negFill)' : 'var(--posFill)') : 'var(--track)',
                      color: jenis === j ? '#fff' : 'var(--text2)',
                    }}>
                    {j === 'expense' ? 'Tagihan keluar' : 'Pemasukan terjadwal'}
                  </button>
                ))}
              </div>

              <input placeholder="Nama (misal Listrik PLN)" value={nama}
                onChange={(e) => setNama(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl text-sm"
                style={{ background: 'var(--bg)', color: 'var(--text)' }} />

              <input inputMode="numeric" placeholder="Perkiraan nominal (Rp)"
                value={jumlah ? formatRp(angka) : ''}
                onChange={(e) => setJumlah(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl text-sm"
                style={{ background: 'var(--bg)', color: 'var(--text)' }} />

              <div className="grid grid-cols-2 gap-2">
                <input type="date" value={jatuhTempo} onChange={(e) => setJatuhTempo(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl text-sm"
                  style={{ background: 'var(--bg)', color: 'var(--text)' }} />
                <select value={ulang} onChange={(e) => setUlang(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl text-sm"
                  style={{ background: 'var(--bg)', color: 'var(--text)' }}>
                  <option value="monthly">Tiap bulan</option>
                  <option value="weekly">Tiap pekan</option>
                  <option value="daily">Tiap hari</option>
                  <option value="">Sekali saja</option>
                </select>
              </div>

              <select value={kat} onChange={(e) => setKat(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl text-sm"
                style={{ background: 'var(--bg)', color: 'var(--text)' }}>
                <option value="">Pilih kategori</option>
                {opsiKategori.map((o) => (
                  <option key={o.nama} value={o.nama}>{labelOpsi(o)}</option>
                ))}
              </select>

              <select value={rekeningId} onChange={(e) => setRekeningId(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl text-sm"
                style={{ background: 'var(--bg)', color: 'var(--text)' }}>
                <option value="">Tunai (tanpa rekening)</option>
                {rekening.map((r) => (
                  <option key={r.id} value={r.id}>{r.name} ({r.account_type})</option>
                ))}
              </select>

              {galat && <p className="text-[11px]" style={{ color: 'var(--neg)' }}>{galat}</p>}

              <button onClick={simpan} disabled={menyimpan}
                className="w-full py-3 rounded-xl text-sm font-bold mt-1"
                style={{ background: 'var(--accentFill)', color: '#fff', opacity: menyimpan ? 0.6 : 1 }}>
                {menyimpan ? 'Menyimpan…' : sunting ? 'Simpan perubahan' : 'Tambah tagihan'}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {memuat ? (
        <p className="text-xs text-center py-6" style={{ color: 'var(--text3)' }}>Memuat…</p>
      ) : gagalMuat ? (
        <div className="rounded-2xl p-4 text-center" style={{ background: 'var(--surface)' }}>
          <p className="text-sm font-semibold" style={{ color: 'var(--text2)' }}>📡 Gagal memuat tagihan</p>
          <p className="text-xs mb-2" style={{ color: 'var(--text3)' }}>
            Datamu aman di server — ini cuma gagal mengambilnya.
          </p>
          <button onClick={muat} className="text-xs font-bold" style={{ color: 'var(--accent)' }}>Coba lagi</button>
        </div>
      ) : daftar.length === 0 ? (
        <p className="text-xs text-center py-6" style={{ color: 'var(--text3)' }}>
          Belum ada tagihan terjadwal. Tagihan di sini terlihat datang lebih awal dan tidak
          mencatat apa pun sampai kamu bilang sudah bayar.
        </p>
      ) : (
        <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}>
          {daftar.map((t, i) => (
            <div key={t.id} style={{ opacity: t.aktif ? 1 : 0.55 }}>
              {i > 0 && <div className="h-px mx-4" style={{ background: 'var(--sep)' }} />}
              <div className="px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate" style={{ color: 'var(--text)' }}>
                      {t.jenis === 'income' ? '↓ ' : ''}{t.nama}
                    </p>
                    <p className="text-[10px]" style={{ color: 'var(--text3)' }}>
                      {t.jatuhTempo}
                      {t.ulang ? ` · ${ULANG_LABEL[t.ulang] ?? t.ulang}` : ' · sekali'}
                      {t.rekeningNama ? ` · ${t.rekeningNama}` : ' · tunai'}
                    </p>
                    <p className="text-[10px] font-semibold" style={{ color: warnaSisa(t.sisaHari) }}>
                      {t.aktif ? labelSisa(t.sisaHari) : 'tidak aktif'}
                    </p>
                  </div>
                  <span className="text-sm font-bold flex-shrink-0"
                    style={{ color: t.jenis === 'income' ? 'var(--pos)' : 'var(--text)' }}>
                    {formatRp(t.jumlah)}
                  </span>
                </div>

                <div className="flex gap-2 mt-2 flex-wrap">
                  {t.aktif && (
                    <button onClick={() => bayar(t)}
                      className="px-3 py-1.5 rounded-lg text-[11px] font-bold"
                      style={{ background: 'var(--accentFill)', color: '#fff' }}>
                      Sudah bayar
                    </button>
                  )}
                  {t.jumlahBayar > 0 && (
                    <button onClick={() => batalBayar(t)}
                      className="px-3 py-1.5 rounded-lg text-[11px] font-semibold"
                      style={{ background: 'var(--track)', color: 'var(--text2)' }}>
                      Batalkan bayar
                    </button>
                  )}
                  <button onClick={() => bukaSunting(t)}
                    className="px-3 py-1.5 rounded-lg text-[11px] font-semibold"
                    style={{ background: 'var(--track)', color: 'var(--text2)' }}>
                    Ubah
                  </button>
                  <button onClick={() => hapus(t)}
                    className="px-3 py-1.5 rounded-lg text-[11px] font-semibold"
                    style={{ background: 'var(--track)', color: 'var(--neg)' }}>
                    Hapus
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
