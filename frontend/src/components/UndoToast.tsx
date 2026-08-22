import { motion, AnimatePresence } from 'framer-motion';
import { springs } from '@/tokens/motion';
import { useUndoToastStore } from '@/stores/toastStore';

/** Native-iOS-style "Deleted. Undo?" banner, mounted once at the app root. */
export function UndoToast() {
  const { message, undo } = useUndoToastStore();

  return (
    <AnimatePresence>
      {message && (
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 40 }}
          transition={springs.gentle}
          className="fixed left-4 right-4 z-50 rounded-2xl px-4 py-3 flex items-center gap-3"
          style={{
            bottom: 'calc(78px + env(safe-area-inset-bottom, 0px))',
            background: 'var(--text)',
            boxShadow: 'var(--neu-raised-lg)',
            maxWidth: '400px',
            margin: '0 auto',
          }}
        >
          <p className="text-sm flex-1 min-w-0 truncate" style={{ color: 'var(--bg)' }}>
            {message}
          </p>
          <button
            onClick={undo}
            className="text-sm font-bold flex-shrink-0"
            style={{ color: 'var(--accentFill2)' }}
          >
            Undo
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
