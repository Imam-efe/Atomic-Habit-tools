import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { springs, collapse } from '@/tokens/motion';
import { apiFetch, ApiError } from '@/lib/api';

interface GenerateResponse {
  shortcut: string; // base64 plist
  filename: string;
  signed: boolean;
  steps: string[];
}

/** Turn the base64 body into the bytes a .shortcut download needs. */
function base64ToBlob(base64: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: 'application/octet-stream' });
}

export default function ShortcutsScreen() {
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    filename: string;
    file: Blob;
    signed: boolean;
    steps: string[];
  } | null>(null);
  const [error, setError] = useState<{ message: string; suggestion?: string } | null>(null);

  const handleGenerate = async () => {
    setError(null);
    setResult(null);
    setLoading(true);

    try {
      // apiFetch carries the API base URL and the auth token; a bare
      // fetch('/api/...') resolved against the Pages origin in production.
      const data = await apiFetch<GenerateResponse>('/shortcuts/generate', {
        method: 'POST',
        body: JSON.stringify({ description: description.trim() }),
      });

      setResult({
        filename: data.filename,
        file: base64ToBlob(data.shortcut),
        signed: data.signed,
        steps: data.steps ?? [],
      });
    } catch (err) {
      if (err instanceof ApiError) {
        setError({
          message: err.body.message ?? 'Gagal membuat shortcut. Coba lagi.',
          suggestion: err.body.suggestion,
        });
      } else {
        setError({ message: 'Terjadi kesalahan jaringan. Coba lagi.' });
      }
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = () => {
    if (!result) return;
    const url = URL.createObjectURL(result.file);
    const a = document.createElement('a');
    a.href = url;
    a.download = result.filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleClear = () => {
    setDescription('');
    setResult(null);
    setError(null);
  };

  const isValidDescription = description.trim().length >= 3;

  return (
    <div
      className="min-h-screen px-5 pt-16 pb-tab-safe"
      style={{ background: 'var(--bg)' }}
    >
      {/* Header */}
      <div className="mb-6">
        <h1
          className="text-3xl font-extrabold tracking-tight"
          style={{
            color: 'var(--text)',
            letterSpacing: '-0.6px',
          }}
        >
          Pembuat Shortcut
        </h1>
      </div>

      {/* Input Card */}
      <motion.div
        className="rounded-[18px] p-5 mb-4 flex flex-col gap-3"
        style={{
          background: 'var(--surface)',
          boxShadow: 'var(--neu-raised)',
        }}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={springs.gentle}
      >
        <label
          className="text-sm font-bold"
          style={{ color: 'var(--text)' }}
        >
          Deskripsi Shortcut
        </label>
        <textarea
          className="w-full px-4 py-3 rounded-xl text-sm outline-none resize-none"
          style={{
            background: 'var(--bg)',
            color: 'var(--text)',
            boxShadow: 'var(--neu-inset)',
          }}
          placeholder="Deskripsi apa yang ingin Anda buat? Misalnya: set a 10-minute timer"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={loading}
          maxLength={500}
          rows={5}
        />
        <div className="flex justify-between items-center">
          <p
            className="text-xs font-semibold"
            style={{ color: 'var(--text3)' }}
          >
            Minimal 3 karakter untuk membuat shortcut
          </p>
          <p
            className="text-xs font-semibold"
            style={{ color: 'var(--text2)' }}
          >
            {description.length}/500
          </p>
        </div>
      </motion.div>

      {/* Error Alert */}
      <AnimatePresence>
        {error && (
          <motion.div
            className="rounded-[18px] p-4 mb-4 border-l-[3px] flex flex-col gap-2"
            style={{
              background: 'rgba(255, 159, 10, 0.1)',
              borderColor: '#ff9f0a',
            }}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={collapse}
          >
            <div
              className="font-semibold text-sm"
              style={{ color: 'var(--text)' }}
            >
              {error.message}
            </div>
            {error.suggestion && (
              <div
                className="text-xs"
                style={{ color: 'var(--text2)' }}
              >
                {error.suggestion}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Success Result Panel */}
      <AnimatePresence>
        {result && (
          <motion.div
            className="rounded-[18px] p-5 mb-4 text-center flex flex-col items-center gap-4"
            style={{
              background: 'var(--surface)',
              boxShadow: 'var(--neu-raised)',
            }}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={collapse}
          >
            <div
              className="text-4xl"
              style={{ color: '#34c759' }}
            >
              ✓
            </div>
            <div className="flex flex-col gap-1">
              <p
                className="font-semibold text-base"
                style={{ color: 'var(--text)' }}
              >
                Shortcut berhasil dibuat!
              </p>
              <p
                className="text-xs"
                style={{ color: 'var(--text2)' }}
              >
                {result.filename}
              </p>
            </div>

            {/* Steps to rebuild by hand — the only route onto a device while
                the file is unsigned, since iOS rejects unsigned shortcuts. */}
            {result.steps.length > 0 && (
              <div className="w-full text-left flex flex-col gap-2">
                <p className="text-xs font-bold" style={{ color: 'var(--text)' }}>
                  Langkah di app Shortcuts:
                </p>
                <ol className="flex flex-col gap-1.5">
                  {result.steps.map((step, i) => (
                    <li
                      key={i}
                      className="text-xs leading-relaxed"
                      style={{ color: 'var(--text2)' }}
                    >
                      {i + 1}. {step}
                    </li>
                  ))}
                </ol>
              </div>
            )}

            {!result.signed && (
              <div
                className="w-full text-left rounded-xl p-3 border-l-[3px] flex flex-col gap-1"
                style={{
                  background: 'rgba(255, 159, 10, 0.1)',
                  borderColor: '#ff9f0a',
                }}
              >
                <p className="text-xs font-semibold" style={{ color: 'var(--text)' }}>
                  File belum bisa dipasang langsung
                </p>
                <p className="text-xs leading-relaxed" style={{ color: 'var(--text2)' }}>
                  Sejak iOS 15, Apple menolak file shortcut yang belum
                  ditandatangani, dan menandatanganinya butuh Mac. Untuk sekarang
                  buat ulang lewat langkah di atas — buka app Shortcuts, tap +,
                  lalu tambahkan tiap aksi berurutan. Unduhan di bawah berguna
                  bila nanti Anda punya akses Mac untuk menandatanganinya.
                </p>
              </div>
            )}
            <motion.button
              className="w-full py-3 rounded-xl text-sm font-semibold text-white"
              style={{ background: 'var(--accentFill)' }}
              onClick={handleDownload}
              whileTap={{ scale: 0.97 }}
              transition={springs.snappy}
            >
              {result.signed ? 'Download Shortcut' : 'Unduh file mentah (.shortcut)'}
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Action Buttons */}
      <div className="flex gap-3">
        <motion.button
          className="flex-1 py-3 rounded-xl text-sm font-semibold text-white"
          style={{
            background: isValidDescription && !loading && !result
              ? 'var(--accentFill)'
              : 'var(--track)',
            color: isValidDescription && !loading && !result
              ? 'white'
              : 'var(--text3)',
            opacity: loading ? 0.6 : 1,
            cursor:
              isValidDescription && !loading && !result
                ? 'pointer'
                : 'not-allowed',
          }}
          onClick={handleGenerate}
          disabled={!isValidDescription || loading || !!result}
          whileTap={
            isValidDescription && !loading && !result
              ? { scale: 0.97 }
              : {}
          }
          transition={springs.snappy}
        >
          {loading ? 'Membuat Shortcut...' : 'Buat Shortcut'}
        </motion.button>

        {(result || error) && (
          <motion.button
            className="flex-1 py-3 rounded-xl text-sm font-semibold"
            style={{
              background: 'var(--surface)',
              color: 'var(--text2)',
              boxShadow: 'var(--neu-raised-sm)',
            }}
            onClick={handleClear}
            whileTap={{ scale: 0.97 }}
            transition={springs.snappy}
          >
            Bersihkan
          </motion.button>
        )}
      </div>

      {/* Help Text */}
      <div className="mt-6 px-4 py-4 rounded-[16px]" style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}>
        <p className="text-xs font-semibold mb-3" style={{ color: 'var(--text)' }}>
          Contoh Deskripsi:
        </p>
        <ul className="flex flex-col gap-2">
          <li className="text-xs" style={{ color: 'var(--text2)' }}>
            • Set a 10-minute timer
          </li>
          <li className="text-xs" style={{ color: 'var(--text2)' }}>
            • Send a message to mom
          </li>
          <li className="text-xs" style={{ color: 'var(--text2)' }}>
            • Play music by Taylor Swift
          </li>
          <li className="text-xs" style={{ color: 'var(--text2)' }}>
            • Get current weather
          </li>
        </ul>
      </div>
    </div>
  );
}
