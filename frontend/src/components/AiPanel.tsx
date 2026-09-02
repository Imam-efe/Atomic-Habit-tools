/**
 * Panel AI yang sama di setiap layar.
 *
 * Sebelumnya AI muncul berbeda-beda di tiap modul — di Kebun sebagai tombol
 * tanya, di Uang sebagai OCR, di Nutrisi tidak ada sama sekali — dan setiap
 * penambahan berarti merancang ulang kotak percakapan dari nol. Satu
 * komponen yang tahu layar mana ia berada membuat "AI di semua menu" jadi
 * satu baris per layar, dan membuat perilakunya seragam: pertanyaan dijawab
 * dengan data layar itu, perintah dikerjakan.
 *
 * Yang sengaja tidak dilakukan: menyimpan riwayat percakapan. Panel ini
 * menjawab satu permintaan pada satu waktu. Riwayat membuat model membawa
 * salah paham dari giliran sebelumnya, dan di aplikasi yang aksinya menulis
 * ke database, salah paham yang menumpuk lebih mahal daripada mengetik ulang.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { springs, collapse } from '@/tokens/motion';
import { apiFetch, ApiError } from '@/lib/api';
import { isVoiceSupported, startVoiceInput, type VoiceSession } from '@/lib/voice';
import { isNetworkError, newClientId, queueFor } from '@/lib/offlineQueue';
import { useAuthStore } from '@/stores/authStore';

/** Modul harus sama persis dengan MODULES di backend/src/lib/ai_context.ts. */
export type AiModule =
  | 'kebiasaan' | 'uang' | 'inventaris' | 'kebun' | 'kalender'
  | 'catatan' | 'proyek' | 'nutrisi' | 'masakan' | 'ternak';

interface AgentAction {
  alat: string;
  modul: string;
  status: 'dijalankan' | 'perlu_konfirmasi' | 'gagal' | 'dibatalkan';
  ringkasan: string;
  ids?: string[];
  /** Id catatan aksi; ada hanya kalau aksinya benar-benar menulis sesuatu. */
  actionId?: string;
  argumen?: Record<string, unknown>;
}

interface AgentReply {
  jawaban: string;
  aksi: AgentAction[];
  alatTidakDikenal: string[];
  /** Sisa jatah AI hari ini. */
  sisa?: number;
  /** Peringatan kuota, hanya diisi saat menipis atau habis. */
  catatanKuota?: string | null;
  /** Benar bila jawabannya dipakai ulang, bukan dihitung baru. */
  dariSimpanan?: boolean;
}

interface Props {
  /** Tanpa modul, seluruh alat tersedia — dipakai overlay Catat cepat. */
  module?: AiModule;
  /** Terbuka sejak awal, untuk tempat yang memang khusus dibuka untuk ini. */
  defaultOpen?: boolean;
  /** Isi kotak dari luar, misalnya hasil dikte. */
  initialMessage?: string;
  /** Contoh pertanyaan yang pas untuk layar ini. */
  suggestions?: string[];
  /**
   * Dipanggil setelah ada aksi yang benar-benar menulis, supaya layar memuat
   * ulang datanya. Tanpa ini pengguna harus menebak apakah sesuatu terjadi.
   */
  onChanged?: () => void;
}

const STATUS_ICON: Record<AgentAction['status'], string> = {
  dijalankan: '✅',
  perlu_konfirmasi: '⏳',
  gagal: '⚠️',
  dibatalkan: '↩️',
};

export function AiPanel({
  module, suggestions = [], onChanged, defaultOpen = false, initialMessage,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const [message, setMessage] = useState(initialMessage ?? '');

  // Teks dari luar (dikte) menimpa kotak selama pengguna belum mengetik
  // sendiri; setelah itu ketikannya yang menang.
  useEffect(() => {
    if (initialMessage) setMessage(initialMessage);
  }, [initialMessage]);
  const [loading, setLoading] = useState(false);
  const [reply, setReply] = useState<AgentReply | null>(null);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState<string | null>(null);
  const [undoing, setUndoing] = useState<string | null>(null);
  const [followUp, setFollowUp] = useState('');
  /**
   * Argumen aksi yang sedang menunggu persetujuan, per indeks aksi.
   *
   * Bisa disunting, bukan sekadar ditampilkan: model sering benar soal niat
   * tapi meleset soal angka, dan memaksa pengguna membatalkan lalu mengetik
   * ulang seluruh kalimat hanya karena nominalnya 45rb bukan 50rb adalah
   * cara tercepat membuat fitur ini ditinggalkan.
   */
  const [draft, setDraft] = useState<Record<number, Record<string, string>>>({});
  const [listening, setListening] = useState(false);

  /** Pertanyaan terakhir yang dikirim, untuk dibawa sebagai konteks lanjutan. */
  const lastAsked = useRef('');
  const voice = useRef<VoiceSession | null>(null);
  useEffect(() => () => voice.current?.stop(), []);

  // Antrean terikat akun aktif, sama seperti di layar Kebun.
  const userId = useAuthStore((s) => s.session?.user.id ?? '');
  const queue = useMemo(() => queueFor(userId), [userId]);

  // Lewat ref, bukan lewat daftar dependensi: `onChanged` adalah fungsi panah
  // sebaris di kesembilan layar, jadi identitasnya berubah tiap render dan
  // memasukkannya ke dependensi akan memasang-lepas pendengar `online` terus
  // menerus. Ref-nya selalu memegang yang terbaru.
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;

  // Kiriman tertahan dicoba lagi begitu jaringan kembali.
  useEffect(() => {
    const flush = () => {
      if (queue.size() === 0) return;
      queue.flush((path, payload) =>
        apiFetch(path, { method: 'POST', body: JSON.stringify(payload) })
      ).then((r) => { if (r.sent > 0) onChangedRef.current?.(); });
    };
    flush();
    window.addEventListener('online', flush);
    return () => window.removeEventListener('online', flush);
  }, [queue]);

  /**
   * Kirim permintaan. `lanjutan` membawa satu giliran sebelumnya.
   *
   * Hanya satu, bukan riwayat penuh: itu cukup untuk kata "juga" dan "yang
   * tadi", dan tidak cukup untuk menumpuk salah paham di aplikasi yang
   * aksinya menulis ke database.
   */
  const ask = async (text: string, lanjutan = false) => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    const sebelumnya = lanjutan && reply?.jawaban
      ? { pertanyaan: lastAsked.current, jawaban: reply.jawaban }
      : undefined;

    setLoading(true);
    setError('');
    setReply(null);
    lastAsked.current = trimmed;
    try {
      const res = await apiFetch<AgentReply>('/agent', {
        method: 'POST',
        body: JSON.stringify({ message: trimmed, module, lanjutanDari: sebelumnya }),
      });
      setReply(res);
      setDraft(
        Object.fromEntries(
          res.aksi.flatMap((a, i) =>
            a.status === 'perlu_konfirmasi'
              ? [[i, Object.fromEntries(Object.entries(a.argumen ?? {}).map(([k, v]) => [k, String(v)]))]]
              : []
          )
        )
      );
      // Muat ulang hanya kalau memang ada yang tertulis — pertanyaan biasa
      // tidak perlu membuat seluruh layar berkedip.
      if (res.aksi.some((a) => a.status === 'dijalankan')) onChanged?.();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.body.message ?? err.body.error ?? 'AI sedang tidak bisa dihubungi.'
          : 'Tidak ada jaringan.'
      );
    }
    setLoading(false);
  };

  const confirm = async (action: AgentAction, index: number) => {
    setConfirming(action.alat);
    try {
      // Nilai yang aslinya angka dikembalikan jadi angka: input HTML selalu
      // memberi string, dan backend menolak nominal yang bukan number.
      const asli = action.argumen ?? {};
      const disunting = draft[index] ?? {};
      const args = Object.fromEntries(
        Object.entries(asli).map(([k, v]) => {
          const teks = disunting[k];
          if (teks === undefined) return [k, v];
          if (typeof v === 'number') {
            const n = Number(teks.replace(/[^\d.-]/g, ''));
            return [k, Number.isFinite(n) ? n : v];
          }
          return [k, teks];
        })
      );

      // Id dibuat di klien: kalau permintaan ini gagal karena jaringan lalu
      // dikirim ulang dari antrean, server mengenali id yang sama dan tidak
      // mencatat pengeluaran kedua.
      const clientId = newClientId();
      const payload = { tool: action.alat, args, clientId };

      let res: { ringkasan: string; actionId?: string };
      try {
        res = await apiFetch<{ ringkasan: string; actionId?: string }>('/agent/confirm', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      } catch (err) {
        if (!isNetworkError(err)) throw err;
        queue.enqueue({ clientId, path: '/agent/confirm', body: payload, queuedAt: Date.now() });
        setReply((prev) => prev && {
          ...prev,
          aksi: prev.aksi.map((a) =>
            a === action
              ? { ...a, status: 'dijalankan' as const, ringkasan: 'Tertahan — akan tersimpan saat jaringan kembali.' }
              : a
          ),
        });
        setConfirming(null);
        return;
      }
      setReply((prev) => prev && {
        ...prev,
        aksi: prev.aksi.map((a) =>
          a === action
            ? { ...a, status: 'dijalankan' as const, ringkasan: res.ringkasan, actionId: res.actionId }
            : a
        ),
      });
      onChanged?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.body.error ?? 'Gagal menyimpan.' : 'Tidak ada jaringan.');
    }
    setConfirming(null);
  };

  /**
   * Membatalkan menghapus baris yang dibuat aksi itu, dan hanya itu.
   *
   * Inilah yang membuat eksekusi langsung nyaman dipakai: kalau AI salah
   * membuat sepuluh tanaman, memperbaikinya satu ketukan, bukan sepuluh
   * penghapusan manual.
   */
  const undo = async (action: AgentAction) => {
    if (!action.actionId) return;
    setUndoing(action.actionId);
    try {
      await apiFetch('/agent/undo', {
        method: 'POST',
        body: JSON.stringify({ actionId: action.actionId }),
      });
      setReply((prev) => prev && {
        ...prev,
        aksi: prev.aksi.map((a) =>
          a === action ? { ...a, status: 'dibatalkan' as const, ringkasan: 'Dibatalkan.' } : a
        ),
      });
      onChanged?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.body.error ?? 'Gagal membatalkan.' : 'Tidak ada jaringan.');
    }
    setUndoing(null);
  };

  const toggleVoice = () => {
    if (listening) {
      voice.current?.stop();
      voice.current = null;
      setListening(false);
      return;
    }
    const session = startVoiceInput({
      onResult: (text) => setMessage(text),
      onEnd: () => { setListening(false); voice.current = null; },
      onError: () => { setListening(false); voice.current = null; },
    });
    if (session) {
      voice.current = session;
      setListening(true);
    }
  };

  return (
    <div className="rounded-2xl p-3 space-y-2.5" style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}>
      <button
        className="w-full flex items-center justify-between"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="flex items-center gap-2 text-[13px] font-bold" style={{ color: 'var(--text)' }}>
          <span aria-hidden>✨</span> Tanya atau suruh AI
        </span>
        <span className="text-[11px]" style={{ color: 'var(--text3)' }}>{open ? 'Tutup' : 'Buka'}</span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div {...collapse} transition={springs.gentle} className="space-y-2.5 overflow-hidden">
            <div className="flex gap-2">
              <input
                className="flex-1 min-w-0 px-3 py-2.5 rounded-xl text-[12px] outline-none"
                style={{ background: 'var(--bg)', color: 'var(--text)', boxShadow: 'var(--neu-inset)' }}
                placeholder="Contoh: buatkan daftar tanaman untuk pemula"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') ask(message); }}
              />
              {isVoiceSupported() && (
                <button
                  className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 text-[15px]"
                  style={{ background: listening ? 'var(--accentFill)' : 'var(--bg)', boxShadow: 'var(--neu-raised-sm)' }}
                  onClick={toggleVoice}
                  aria-label={listening ? 'Berhenti merekam' : 'Bicara'}
                >
                  {listening ? '⏹' : '🎙'}
                </button>
              )}
              <button
                className="neu-cta px-3 py-2 rounded-xl text-[12px] font-bold text-white flex-shrink-0 disabled:opacity-50"
                style={{ background: 'var(--accentFill)' }}
                onClick={() => ask(message)}
                disabled={loading || !message.trim()}
              >
                {loading ? '…' : 'Kirim'}
              </button>
            </div>

            {suggestions.length > 0 && !reply && !loading && (
              <div className="flex flex-wrap gap-1.5">
                {suggestions.map((s) => (
                  <button
                    key={s}
                    className="text-[10px] px-2.5 py-1.5 rounded-lg"
                    style={{ background: 'var(--bg)', color: 'var(--text2)', boxShadow: 'var(--neu-inset)' }}
                    onClick={() => { setMessage(s); ask(s); }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}

            {error && (
              <p className="text-[11px]" style={{ color: 'var(--neg)' }}>{error}</p>
            )}

            {reply && (
              <div className="space-y-2">
                {/* Kuota disebut sebelum habis, bukan sesudah: yang tersisa
                    masih bisa disimpan untuk yang penting. */}
                {reply.catatanKuota && (
                  <p className="text-[10px]" style={{ color: 'var(--warn)' }}>{reply.catatanKuota}</p>
                )}

                {reply.jawaban && (
                  <p className="text-[12px] leading-relaxed whitespace-pre-line" style={{ color: 'var(--text)' }}>
                    {reply.jawaban}
                  </p>
                )}

                {reply.aksi.map((a, i) => (
                  <div
                    key={`${a.alat}-${i}`}
                    className="rounded-xl p-2.5 space-y-1.5"
                    style={{ background: 'var(--bg)', boxShadow: 'var(--neu-inset)' }}
                  >
                    <p className="text-[11px]" style={{ color: 'var(--text2)' }}>
                      <span aria-hidden>{STATUS_ICON[a.status]} </span>
                      {a.ringkasan}
                    </p>

                    {a.status === 'dijalankan' && a.actionId && (
                      <button
                        className="text-[10px] font-semibold disabled:opacity-50"
                        style={{ color: 'var(--text3)' }}
                        onClick={() => undo(a)}
                        disabled={undoing === a.actionId}
                      >
                        {undoing === a.actionId ? 'Membatalkan…' : 'Batalkan'}
                      </button>
                    )}

                    {a.status === 'perlu_konfirmasi' && (
                      <>
                        {/* Setiap nilai yang akan disimpan terlihat DAN bisa
                            diperbaiki: menyetujui sesuatu yang tidak terlihat
                            bukan persetujuan, dan model yang benar soal niat
                            tapi meleset soal angka tidak seharusnya memaksa
                            mengulang dari awal. */}
                        <div className="space-y-1">
                          {Object.entries(a.argumen ?? {}).map(([k, v]) => (
                            <label key={k} className="flex items-center gap-2">
                              <span className="text-[10px] w-20 flex-shrink-0" style={{ color: 'var(--text3)' }}>
                                {k}
                              </span>
                              <input
                                className="flex-1 min-w-0 px-2 py-1.5 rounded-lg text-[11px] outline-none"
                                style={{ background: 'var(--surface)', color: 'var(--text)', boxShadow: 'var(--neu-inset)' }}
                                value={draft[i]?.[k] ?? String(v)}
                                inputMode={typeof v === 'number' ? 'numeric' : undefined}
                                onChange={(e) =>
                                  setDraft((prev) => ({
                                    ...prev,
                                    [i]: { ...(prev[i] ?? {}), [k]: e.target.value },
                                  }))
                                }
                              />
                            </label>
                          ))}
                        </div>
                        <button
                          className="text-[10px] font-bold px-2.5 py-1.5 rounded-lg text-white disabled:opacity-50"
                          style={{ background: 'var(--accentFill)' }}
                          onClick={() => confirm(a, i)}
                          disabled={confirming === a.alat}
                        >
                          {confirming === a.alat ? 'Menyimpan…' : 'Simpan'}
                        </button>
                      </>
                    )}
                  </div>
                ))}

                {/* Lanjutan: satu kotak kecil yang membawa giliran ini sebagai
                    konteks, supaya "tambahkan cabai juga" tidak perlu
                    mengulang seluruh kalimat. */}
                <div className="flex gap-2 pt-0.5">
                  <input
                    className="flex-1 min-w-0 px-3 py-2 rounded-xl text-[11px] outline-none"
                    style={{ background: 'var(--bg)', color: 'var(--text)', boxShadow: 'var(--neu-inset)' }}
                    placeholder="Lanjutkan… misal: tambahkan cabai juga"
                    value={followUp}
                    onChange={(e) => setFollowUp(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && followUp.trim()) {
                        const t = followUp;
                        setFollowUp('');
                        ask(t, true);
                      }
                    }}
                  />
                  <button
                    className="px-3 py-2 rounded-xl text-[11px] font-bold flex-shrink-0 disabled:opacity-50"
                    style={{ background: 'var(--bg)', color: 'var(--text2)', boxShadow: 'var(--neu-raised-sm)' }}
                    onClick={() => { const t = followUp; setFollowUp(''); ask(t, true); }}
                    disabled={loading || !followUp.trim()}
                  >
                    Lanjut
                  </button>
                </div>

                {reply.dariSimpanan && (
                  <p className="text-[10px]" style={{ color: 'var(--text3)' }}>
                    Jawaban yang sama dari 15 menit terakhir — tidak memakai jatah AI.
                  </p>
                )}

                {reply.alatTidakDikenal.length > 0 && (
                  <p className="text-[10px]" style={{ color: 'var(--text3)' }}>
                    Ada yang tidak bisa dikerjakan dari layar ini. Coba dari menu yang sesuai.
                  </p>
                )}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
