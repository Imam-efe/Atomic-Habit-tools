import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { springs, press } from '@/tokens/motion';
import { apiFetch } from '@/lib/api';
import { isVoiceSupported, startVoiceInput, type VoiceSession } from '@/lib/voice';
import { useCommandStore, notifyDataChanged } from '@/stores/commandStore';
import { useUIStore } from '@/stores/uiStore';

/**
 * Quick-add: one sentence in, one record out.
 *
 * The parse runs on the server and comes back as a *proposal*, never a saved
 * row — an extraction model gets things wrong often enough that writing
 * straight into a finance ledger would be reckless. The proposal lands in
 * editable fields, and the save goes through the same endpoints the manual
 * forms use, so every existing validation still applies.
 */

const EXPENSE_CATEGORIES = [
  'Makanan & Minuman',
  'Transportasi & Bensin',
  'Kebutuhan Rumah Tangga',
  'Belanja Bulanan',
  'Tagihan & Utilitas',
  'Pendidikan & Anak',
  'Kesehatan & Obat',
  'Hiburan & Rekreasi',
  'Cicilan & Utang',
  'Investasi & Tabungan',
  'Lainnya',
];
const INCOME_CATEGORIES = ['Gaji', 'Freelance', 'Investasi', 'Bisnis', 'Lainnya'];

interface EntryProposal {
  type: 'income' | 'expense';
  amount: number;
  category: string;
  note: string;
  date: string;
  bank_account_id: string | null;
  bank_name: string | null;
}

interface ItemProposal {
  name: string;
  quantity: number;
  unit: string;
}

type ParseResponse =
  | { intent: 'expense' | 'income'; text: string; entry: EntryProposal }
  | { intent: 'habit'; text: string; habit: { id: string; name: string } }
  | { intent: 'inventory'; text: string; item: ItemProposal }
  | { intent: 'unknown'; text: string };

const EXAMPLES = ['beli kopi 25rb', 'gaji masuk 5jt', 'olahraga selesai', 'beli beras 5 kg'];

export function QuickAdd() {
  const { overlay, startListening, close } = useCommandStore();
  const setTab = useUIStore(s => s.setTab);
  const open = overlay === 'quickadd';

  const [text, setText] = useState('');
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ParseResponse | null>(null);
  const [listening, setListening] = useState(false);

  // Editable proposal fields
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('');
  const [note, setNote] = useState('');

  const inputRef = useRef<HTMLInputElement>(null);
  const voiceRef = useRef<VoiceSession | null>(null);
  const voiceAvailable = useRef(isVoiceSupported());

  const reset = () => {
    setText('');
    setResult(null);
    setError(null);
    setParsing(false);
    setSaving(false);
    setAmount('');
    setCategory('');
    setNote('');
  };

  const handleClose = () => {
    voiceRef.current?.cancel();
    voiceRef.current = null;
    setListening(false);
    reset();
    close();
  };

  const beginListening = () => {
    if (listening) {
      voiceRef.current?.stop();
      return;
    }
    setError(null);
    const session = startVoiceInput({
      onPartial: setText,
      onResult: (final) => {
        setText(final);
        void parse(final);
      },
      onError: setError,
      onEnd: () => {
        setListening(false);
        voiceRef.current = null;
      },
    });
    if (session) {
      voiceRef.current = session;
      setListening(true);
    }
  };

  // Opening from the mic button starts dictation immediately; opening from the
  // text button focuses the field instead.
  useEffect(() => {
    if (!open) return;
    if (startListening && voiceAvailable.current) beginListening();
    else inputRef.current?.focus();
  }, [open, startListening]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const parse = async (raw: string) => {
    const value = raw.trim();
    if (!value) return;
    setParsing(true);
    setError(null);
    setResult(null);
    try {
      const res = await apiFetch<ParseResponse>('/quickadd/parse', {
        method: 'POST',
        body: JSON.stringify({ text: value }),
      });
      setResult(res);
      if (res.intent === 'expense' || res.intent === 'income') {
        setAmount(String(res.entry.amount));
        setCategory(res.entry.category);
        setNote(res.entry.note);
      } else if (res.intent === 'inventory') {
        setNote(res.item.name);
        setAmount(String(res.item.quantity));
      }
    } catch {
      setError('Gagal memproses. Coba kalimat yang lebih sederhana atau catat manual.');
    } finally {
      setParsing(false);
    }
  };

  const save = async () => {
    if (!result || saving) return;
    setSaving(true);
    setError(null);

    try {
      if (result.intent === 'expense' || result.intent === 'income') {
        const amt = parseInt(amount.replace(/\D/g, ''), 10);
        if (!amt || amt <= 0) {
          setError('Nominal tidak valid.');
          setSaving(false);
          return;
        }
        await apiFetch('/budget', {
          method: 'POST',
          body: JSON.stringify({
            type: result.entry.type,
            amount: amt,
            category,
            note,
            date: result.entry.date,
            bank_account_id: result.entry.bank_account_id ?? undefined,
          }),
        });
        notifyDataChanged('uang');
        setTab('uang');
      } else if (result.intent === 'habit') {
        await apiFetch(`/habits/${result.habit.id}/toggle`, {
          method: 'POST',
          body: JSON.stringify({}),
        });
        notifyDataChanged('kebiasaan');
        setTab('kebiasaan');
      } else if (result.intent === 'inventory') {
        const qty = parseInt(amount.replace(/\D/g, ''), 10);
        await apiFetch('/inventory', {
          method: 'POST',
          body: JSON.stringify({
            name: note,
            quantity: qty > 0 ? qty : 1,
            unit: result.item.unit,
          }),
        });
      }
      handleClose();
    } catch {
      setError('Gagal menyimpan. Periksa koneksi dan coba lagi.');
      setSaving(false);
    }
  };

  const categories =
    result?.intent === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-[60] flex items-start justify-center px-4 pt-20"
          style={{ background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(6px)' }}
          onClick={handleClose}
        >
          <motion.div
            initial={{ opacity: 0, y: -18, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -12, scale: 0.98 }}
            transition={springs.smooth}
            className="w-full rounded-3xl p-4"
            style={{ maxWidth: 400, background: 'var(--bg)', boxShadow: 'var(--neu-raised-lg)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 mb-3">
              <span className="text-[15px] font-bold" style={{ color: 'var(--text)' }}>
                Catat Cepat
              </span>
              <span
                className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                style={{ background: 'var(--accentFill)', color: '#fff' }}
              >
                AI
              </span>
              <button
                onClick={handleClose}
                aria-label="Tutup"
                className="ml-auto w-8 h-8 rounded-full neu-press flex items-center justify-center text-[15px]"
                style={{ color: 'var(--text2)' }}
              >
                ✕
              </button>
            </div>

            {/* Input row */}
            <div
              className="flex items-center gap-2 rounded-2xl px-3 py-2 neu-inset"
              style={{ background: 'var(--surface)' }}
            >
              <input
                ref={inputRef}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void parse(text);
                }}
                placeholder="beli kopi 25rb pakai BCA"
                className="flex-1 min-w-0 bg-transparent outline-none text-[15px]"
                style={{ color: 'var(--text)' }}
                enterKeyHint="go"
              />
              {voiceAvailable.current && (
                <motion.button
                  whileTap={press.control}
                  onClick={beginListening}
                  aria-label={listening ? 'Berhenti merekam' : 'Mulai bicara'}
                  aria-pressed={listening}
                  className="w-9 h-9 rounded-full flex items-center justify-center text-[16px] flex-shrink-0"
                  style={{
                    background: listening ? 'var(--accentFill)' : 'transparent',
                    color: listening ? '#fff' : 'var(--text2)',
                  }}
                >
                  {listening ? '⏹' : '🎤'}
                </motion.button>
              )}
              <motion.button
                whileTap={press.control}
                onClick={() => void parse(text)}
                disabled={!text.trim() || parsing}
                className="px-3 py-1.5 rounded-xl text-[13px] font-bold flex-shrink-0 disabled:opacity-40"
                style={{ background: 'var(--accentFill)', color: '#fff' }}
              >
                {parsing ? '…' : 'Baca'}
              </motion.button>
            </div>

            {listening && (
              <p className="text-[12px] mt-2 text-center" style={{ color: 'var(--accentFill2)' }}>
                Mendengarkan… ucapkan transaksi atau kebiasaan Anda
              </p>
            )}

            {!result && !parsing && !listening && (
              <div className="flex flex-wrap gap-1.5 mt-3">
                {EXAMPLES.map((ex) => (
                  <button
                    key={ex}
                    onClick={() => {
                      setText(ex);
                      void parse(ex);
                    }}
                    className="text-[11px] px-2.5 py-1 rounded-full neu-sm"
                    style={{ color: 'var(--text2)' }}
                  >
                    {ex}
                  </button>
                ))}
              </div>
            )}

            {error && (
              <p className="text-[12px] mt-3" style={{ color: 'var(--neg)' }}>
                {error}
              </p>
            )}

            {/* Proposal — always editable before it is saved */}
            <AnimatePresence>
              {result && result.intent !== 'unknown' && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={springs.gentle}
                  className="overflow-hidden"
                >
                  <div className="mt-4 rounded-2xl p-3 neu-sm">
                    {(result.intent === 'expense' || result.intent === 'income') && (
                      <>
                        <div className="flex items-center gap-2 mb-2">
                          <span
                            className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                            style={{
                              background: result.intent === 'income' ? 'var(--posFill)' : 'var(--negFill)',
                              color: '#fff',
                            }}
                          >
                            {result.intent === 'income' ? 'Pemasukan' : 'Pengeluaran'}
                          </span>
                          {result.entry.bank_name && (
                            <span className="text-[11px]" style={{ color: 'var(--text3)' }}>
                              via {result.entry.bank_name}
                            </span>
                          )}
                        </div>

                        <label className="text-[11px] font-semibold" style={{ color: 'var(--text3)' }}>
                          Nominal
                        </label>
                        <input
                          value={amount}
                          onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))}
                          inputMode="numeric"
                          className="w-full bg-transparent outline-none text-[20px] font-bold mb-2"
                          style={{ color: 'var(--text)' }}
                        />

                        <label className="text-[11px] font-semibold" style={{ color: 'var(--text3)' }}>
                          Kategori
                        </label>
                        <select
                          value={category}
                          onChange={(e) => setCategory(e.target.value)}
                          className="w-full bg-transparent outline-none text-[14px] mb-2"
                          style={{ color: 'var(--text)' }}
                        >
                          {categories.map((cat) => (
                            <option key={cat} value={cat}>
                              {cat}
                            </option>
                          ))}
                        </select>

                        <label className="text-[11px] font-semibold" style={{ color: 'var(--text3)' }}>
                          Catatan
                        </label>
                        <input
                          value={note}
                          onChange={(e) => setNote(e.target.value)}
                          className="w-full bg-transparent outline-none text-[14px]"
                          style={{ color: 'var(--text)' }}
                        />
                      </>
                    )}

                    {result.intent === 'habit' && (
                      <p className="text-[14px]" style={{ color: 'var(--text)' }}>
                        Tandai <span className="font-bold">{result.habit.name}</span> selesai hari ini?
                      </p>
                    )}

                    {result.intent === 'inventory' && (
                      <>
                        <span
                          className="text-[10px] font-bold px-2 py-0.5 rounded-full inline-block mb-2"
                          style={{ background: 'var(--accentFill)', color: '#fff' }}
                        >
                          Stok
                        </span>
                        <label className="text-[11px] font-semibold block" style={{ color: 'var(--text3)' }}>
                          Nama barang
                        </label>
                        <input
                          value={note}
                          onChange={(e) => setNote(e.target.value)}
                          className="w-full bg-transparent outline-none text-[15px] font-semibold mb-2"
                          style={{ color: 'var(--text)' }}
                        />
                        <label className="text-[11px] font-semibold block" style={{ color: 'var(--text3)' }}>
                          Jumlah ({result.item.unit})
                        </label>
                        <input
                          value={amount}
                          onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))}
                          inputMode="numeric"
                          className="w-full bg-transparent outline-none text-[15px]"
                          style={{ color: 'var(--text)' }}
                        />
                      </>
                    )}
                  </div>

                  <motion.button
                    whileTap={press.surface}
                    onClick={() => void save()}
                    disabled={saving}
                    className="w-full mt-3 py-3 rounded-2xl text-[15px] font-bold neu-cta disabled:opacity-50"
                    style={{ background: 'var(--accentFill)', color: '#fff' }}
                  >
                    {saving ? 'Menyimpan…' : 'Simpan'}
                  </motion.button>
                </motion.div>
              )}
            </AnimatePresence>

            {result?.intent === 'unknown' && (
              <p className="text-[13px] mt-3" style={{ color: 'var(--text2)' }}>
                Belum paham maksudnya. Sebutkan nominal untuk transaksi ("beli kopi 25rb"), atau
                nama kebiasaan yang sudah terdaftar.
              </p>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
