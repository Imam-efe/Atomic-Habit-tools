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

import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { springs, collapse } from '@/tokens/motion';
import { apiFetch, ApiError } from '@/lib/api';
import { isVoiceSupported, startVoiceInput, type VoiceSession } from '@/lib/voice';

/** Modul harus sama persis dengan MODULES di backend/src/lib/ai_context.ts. */
export type AiModule =
  | 'kebiasaan' | 'uang' | 'inventaris' | 'kebun' | 'kalender'
  | 'catatan' | 'proyek' | 'nutrisi' | 'masakan';

interface AgentAction {
  alat: string;
  modul: string;
  status: 'dijalankan' | 'perlu_konfirmasi' | 'gagal';
  ringkasan: string;
  ids?: string[];
  argumen?: Record<string, unknown>;
}

interface AgentReply {
  jawaban: string;
  aksi: AgentAction[];
  alatTidakDikenal: string[];
}

interface Props {
  module: AiModule;
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
};

export function AiPanel({ module, suggestions = [], onChanged }: Props) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [reply, setReply] = useState<AgentReply | null>(null);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState<string | null>(null);
  const [listening, setListening] = useState(false);

  const voice = useRef<VoiceSession | null>(null);
  useEffect(() => () => voice.current?.stop(), []);

  const ask = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    setLoading(true);
    setError('');
    setReply(null);
    try {
      const res = await apiFetch<AgentReply>('/agent', {
        method: 'POST',
        body: JSON.stringify({ message: trimmed, module }),
      });
      setReply(res);
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

  const confirm = async (action: AgentAction) => {
    setConfirming(action.alat);
    try {
      const res = await apiFetch<{ ringkasan: string }>('/agent/confirm', {
        method: 'POST',
        body: JSON.stringify({ tool: action.alat, args: action.argumen ?? {} }),
      });
      setReply((prev) => prev && {
        ...prev,
        aksi: prev.aksi.map((a) =>
          a === action ? { ...a, status: 'dijalankan' as const, ringkasan: res.ringkasan } : a
        ),
      });
      onChanged?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.body.error ?? 'Gagal menyimpan.' : 'Tidak ada jaringan.');
    }
    setConfirming(null);
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

                    {a.status === 'perlu_konfirmasi' && (
                      <>
                        {/* Angka yang akan disimpan ditampilkan apa adanya:
                            menyetujui sesuatu yang tidak terlihat bukan
                            persetujuan. */}
                        <p className="text-[10px] font-mono break-words" style={{ color: 'var(--text3)' }}>
                          {Object.entries(a.argumen ?? {})
                            .map(([k, v]) => `${k}: ${String(v)}`)
                            .join(' · ')}
                        </p>
                        <button
                          className="text-[10px] font-bold px-2.5 py-1.5 rounded-lg text-white disabled:opacity-50"
                          style={{ background: 'var(--accentFill)' }}
                          onClick={() => confirm(a)}
                          disabled={confirming === a.alat}
                        >
                          {confirming === a.alat ? 'Menyimpan…' : 'Simpan'}
                        </button>
                      </>
                    )}
                  </div>
                ))}

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
