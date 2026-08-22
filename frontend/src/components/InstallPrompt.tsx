import { motion, AnimatePresence } from 'framer-motion';
import { springs } from '@/tokens/motion';
import { useInstallPrompt } from '@/hooks/useInstallPrompt';

/** iOS-only "Add to Home Screen" nudge — Safari has no native install prompt. */
export function InstallPrompt() {
  const { show, dismiss } = useInstallPrompt();

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 40 }}
          transition={springs.gentle}
          className="fixed left-4 right-4 z-40 rounded-2xl p-4 flex items-start gap-3"
          style={{
            bottom: 'calc(78px + env(safe-area-inset-bottom, 0px))',
            background: 'var(--surface)',
            boxShadow: 'var(--neu-raised-lg)',
            maxWidth: '400px',
            margin: '0 auto',
          }}
        >
          <div className="w-10 h-10 rounded-xl flex-shrink-0 flex items-center justify-center text-xl"
            style={{ background: 'var(--accentSoft)' }}>
            📲
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold" style={{ color: 'var(--text)' }}>
              Install Fayolla di Home Screen
            </p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text2)' }}>
              Tap <strong>Bagikan</strong>{' '}
              <span aria-hidden style={{ color: 'var(--accent)' }}>⬆️</span> lalu{' '}
              <strong>&quot;Tambah ke Layar Utama&quot;</strong> untuk akses lebih cepat.
            </p>
          </div>
          <button
            onClick={dismiss}
            className="text-xs font-bold px-2 py-1 flex-shrink-0"
            style={{ color: 'var(--text3)' }}
            aria-label="Tutup"
          >
            ✕
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
