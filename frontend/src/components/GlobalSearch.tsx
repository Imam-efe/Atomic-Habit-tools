import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { springs, press } from '@/tokens/motion';
import { apiFetch } from '@/lib/api';
import { useCommandStore } from '@/stores/commandStore';
import { useUIStore } from '@/stores/uiStore';

interface SearchHit {
  type: string;
  label: string;
  id: string;
  title: string;
  subtitle: string | null;
  date: string | null;
  tab?: string;
  subScreen?: string;
}

const ICONS: Record<string, string> = {
  budget: '💰',
  inventory: '📦',
  habit: '🔁',
  goal: '🎯',
  project: '🗂️',
  task: '✅',
  kid: '🧒',
  debt: '🤝',
  event: '📅',
};

/**
 * One search box across every module.
 *
 * Twenty screens and no way to answer "kapan aku beli beras?" without opening
 * Inventory and scrolling. Each hit carries its own navigation target, so
 * tapping one lands on the screen that holds it.
 */
export function GlobalSearch() {
  const { overlay, close } = useCommandStore();
  const { setTab, setSubScreen } = useUIStore();
  const open = overlay === 'search';

  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
    else {
      setQuery('');
      setHits([]);
      setSearched(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  // Debounced so a four-letter word costs one request rather than four. The
  // guard on `cancelled` drops a slow response that lost the race to a newer
  // keystroke, which is what otherwise makes results flicker backwards.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setHits([]);
      setSearched(false);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(() => {
      apiFetch<{ query: string; hits: SearchHit[] }>(`/search?q=${encodeURIComponent(q)}`)
        .then((res) => {
          if (cancelled) return;
          // A malformed or truncated response must not take the overlay down
          // with it — an empty result reads as "no matches", which is honest.
          setHits(Array.isArray(res?.hits) ? res.hits : []);
          setSearched(true);
        })
        .catch(() => {
          if (!cancelled) setHits([]);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 280);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  const goTo = (hit: SearchHit) => {
    if (hit.subScreen) {
      setSubScreen(hit.subScreen);
    } else if (hit.tab) {
      setTab(hit.tab as Parameters<typeof setTab>[0]);
    }
    close();
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-[60] flex items-start justify-center px-4 pt-16"
          style={{ background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(6px)' }}
          onClick={close}
        >
          <motion.div
            initial={{ opacity: 0, y: -18, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -12, scale: 0.98 }}
            transition={springs.smooth}
            className="w-full rounded-3xl p-4 flex flex-col"
            style={{
              maxWidth: 400,
              maxHeight: 'calc(100vh - 140px)',
              background: 'var(--bg)',
              boxShadow: 'var(--neu-raised-lg)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="flex items-center gap-2 rounded-2xl px-3 py-2 neu-inset flex-shrink-0"
              style={{ background: 'var(--surface)' }}
            >
              <span className="text-[15px]" aria-hidden>🔍</span>
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Cari transaksi, stok, kebiasaan…"
                className="flex-1 min-w-0 bg-transparent outline-none text-[15px]"
                style={{ color: 'var(--text)' }}
                enterKeyHint="search"
              />
              <button
                onClick={close}
                aria-label="Tutup"
                className="w-7 h-7 rounded-full flex items-center justify-center text-[14px] flex-shrink-0"
                style={{ color: 'var(--text3)' }}
              >
                ✕
              </button>
            </div>

            <div className="mt-3 overflow-y-auto flex-1 -mx-1 px-1">
              {query.trim().length < 2 && (
                <p className="text-[12px] py-6 text-center" style={{ color: 'var(--text3)' }}>
                  Ketik minimal 2 huruf. Pencarian mencakup keuangan, stok, kebiasaan, goal,
                  proyek, tugas, jadwal anak, utang dan agenda.
                </p>
              )}

              {loading && hits.length === 0 && query.trim().length >= 2 && (
                <p className="text-[12px] py-6 text-center" style={{ color: 'var(--text3)' }}>
                  Mencari…
                </p>
              )}

              {searched && !loading && hits.length === 0 && (
                <p className="text-[13px] py-6 text-center" style={{ color: 'var(--text2)' }}>
                  Tidak ada hasil untuk "{query.trim()}".
                </p>
              )}

              <div className="flex flex-col gap-1.5 pb-1">
                {hits.map((hit) => (
                  <motion.button
                    key={`${hit.type}-${hit.id}`}
                    whileTap={press.surface}
                    onClick={() => goTo(hit)}
                    className="w-full text-left rounded-2xl px-3 py-2.5 neu-sm flex items-center gap-3"
                  >
                    <span className="text-[17px] flex-shrink-0" aria-hidden>
                      {ICONS[hit.type] ?? '•'}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="flex items-baseline gap-2">
                        <span
                          className="text-[14px] font-semibold truncate"
                          style={{ color: 'var(--text)' }}
                        >
                          {hit.title}
                        </span>
                        <span
                          className="text-[10px] font-bold flex-shrink-0"
                          style={{ color: 'var(--text3)' }}
                        >
                          {hit.label}
                        </span>
                      </span>
                      {(hit.subtitle || hit.date) && (
                        <span
                          className="block text-[11px] truncate"
                          style={{ color: 'var(--text2)' }}
                        >
                          {[hit.subtitle, hit.date].filter(Boolean).join(' · ')}
                        </span>
                      )}
                    </span>
                  </motion.button>
                ))}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
