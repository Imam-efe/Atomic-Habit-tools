import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { springs, collapse } from '@/tokens/motion';

export default function ShortcutsScreen() {
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ filename: string; file: Blob } | null>(null);
  const [error, setError] = useState<{ message: string; suggestion?: string } | null>(null);

  const handleGenerate = async () => {
    setError(null);
    setResult(null);
    setLoading(true);

    try {
      const response = await fetch('/api/shortcuts/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        setError(errorData);
        return;
      }

      const blob = await response.blob();
      const contentDisposition = response.headers.get('Content-Disposition');
      const filename =
        contentDisposition?.match(/filename="([^"]+)"/)?.[1] || 'shortcut.shortcut';

      setResult({ filename, file: blob });
    } catch (err) {
      setError({ message: 'Terjadi kesalahan jaringan. Coba lagi.' });
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

  return (
    <div className="min-h-screen px-5 pt-16 pb-tab-safe" style={{ background: 'var(--bg)' }}>
      <div className="max-w-600px mx-auto">
        {/* Header */}
        <h1
          className="text-3xl font-extrabold tracking-tight mb-6"
          style={{ color: 'var(--text)', letterSpacing: '-0.6px' }}
        >
          Pembuat Shortcut
        </h1>

        {/* Input Section */}
        <div
          className="rounded-[18px] p-4 mb-4 flex flex-col gap-3"
          style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}
        >
          <textarea
            placeholder="Deskripsi apa yang ingin Anda buat? (misal: set a 10-minute timer)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={loading}
            maxLength={500}
            className="w-full min-h-[120px] px-3 py-2.5 rounded-xl text-sm outline-none resize-vertical"
            style={{
              background: 'var(--bg)',
              color: 'var(--text)',
              boxShadow: 'var(--neu-inset)',
            }}
          />
          <div className="text-right text-xs" style={{ color: 'var(--text3)' }}>
            {description.length}/500
          </div>
        </div>

        {/* Error Alert */}
        <AnimatePresence>
          {error && (
            <motion.div
              className="rounded-[18px] p-4 mb-4 border-l-4 flex flex-col gap-2"
              style={{
                background: 'rgba(255, 159, 10, 0.1)',
                borderColor: '#ff9f0a',
              }}
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={collapse}
            >
              <div className="font-semibold text-sm" style={{ color: 'var(--text)' }}>
                {error.message}
              </div>
              {error.suggestion && (
                <div className="text-xs" style={{ color: 'var(--text2)' }}>
                  {error.suggestion}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Success Result */}
        <AnimatePresence>
          {result && (
            <motion.div
              className="rounded-[18px] p-6 mb-4 text-center flex flex-col items-center gap-3"
              style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={collapse}
            >
              <div className="text-4xl" style={{ color: '#34c759' }}>
                ✓
              </div>
              <div className="font-semibold text-sm" style={{ color: 'var(--text)' }}>
                Shortcut berhasil dibuat!
              </div>
              <motion.button
                onClick={handleDownload}
                className="w-full py-2.5 rounded-xl text-sm font-semibold text-white"
                style={{ background: 'var(--accentFill)' }}
                whileTap={{ scale: 0.97 }}
              >
                Download Shortcut
              </motion.button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Action Buttons */}
        <div className="flex gap-3">
          <motion.button
            onClick={handleGenerate}
            disabled={loading || description.trim().length < 3 || !!result}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white"
            style={{
              background: 'var(--accentFill)',
              opacity:
                loading || description.trim().length < 3 || result ? 0.6 : 1,
              cursor:
                loading || description.trim().length < 3 || result
                  ? 'not-allowed'
                  : 'pointer',
            }}
            whileTap={
              !loading && description.trim().length >= 3 && !result
                ? { scale: 0.97 }
                : {}
            }
          >
            {loading ? 'Membuat...' : 'Buat Shortcut'}
          </motion.button>
          {(result || error) && (
            <motion.button
              onClick={handleClear}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold"
              style={{
                background: 'var(--surface)',
                color: 'var(--text2)',
                boxShadow: 'var(--neu-raised-sm)',
              }}
              whileTap={{ scale: 0.97 }}
            >
              Bersihkan
            </motion.button>
          )}
        </div>
      </div>
    </div>
  );
}
