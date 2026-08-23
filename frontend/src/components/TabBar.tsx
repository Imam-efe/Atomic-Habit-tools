import { useLayoutEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { useUIStore } from '@/stores/uiStore';
import { press, springs } from '@/tokens/motion';
import type { TabName } from '@/types';

const tabs: { id: TabName; label: string; icon: React.ReactNode }[] = [
  {
    id: 'beranda',
    label: 'Beranda',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <polyline points="9 22 9 12 15 12 15 22" />
      </svg>
    ),
  },
  {
    id: 'kebiasaan',
    label: 'Kebiasaan',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
        <polyline points="22 4 12 14.01 9 11.01" />
      </svg>
    ),
  },
  {
    id: 'kalender',
    label: 'Kalender',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect width="18" height="18" x="3" y="4" rx="2" />
        <line x1="3" x2="21" y1="10" y2="10" />
        <line x1="8" x2="8" y1="2" y2="6" />
        <line x1="16" x2="16" y1="2" y2="6" />
      </svg>
    ),
  },
  {
    id: 'goals',
    label: 'Goals',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <circle cx="12" cy="12" r="6" />
        <circle cx="12" cy="12" r="2" />
      </svg>
    ),
  },
  {
    id: 'uang',
    label: 'Uang',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect width="20" height="14" x="2" y="5" rx="2" />
        <line x1="2" x2="22" y1="10" y2="10" />
      </svg>
    ),
  },
  {
    id: 'lainnya',
    label: 'Lainnya',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect width="7" height="7" x="3" y="3" rx="1" />
        <rect width="7" height="7" x="14" y="3" rx="1" />
        <rect width="7" height="7" x="14" y="14" rx="1" />
        <rect width="7" height="7" x="3" y="14" rx="1" />
      </svg>
    ),
  },
];

export function TabBar() {
  const { activeTab, setTab } = useUIStore();
  const navRef = useRef<HTMLElement>(null);

  /*
   * Publish the bar's real height so screens can pad exactly past it.
   *
   * The height is not a constant worth hardcoding: env(safe-area-inset-bottom)
   * adds to it on a device with a home indicator, and the icon/label block
   * grows again when the user scales text up. Measuring means .pb-tab-safe is
   * right on every device instead of tracking a copy of one device's number,
   * which is how the screens ended up 12px short on an iPhone.
   */
  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return;

    const publish = () => {
      document.documentElement.style.setProperty('--tab-bar-height', `${nav.offsetHeight}px`);
    };
    publish();

    // ResizeObserver is unavailable in some older WebViews; the CSS fallback in
    // index.css already covers that case, so the measurement is best-effort.
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(publish);
    observer.observe(nav);
    return () => observer.disconnect();
  }, []);

  return (
    <nav
      ref={navRef}
      className="tab-bar-layer fixed bottom-0 left-0 right-0 flex items-end justify-around px-2"
      style={{
        background: 'var(--blur)',
        // 22px cost noticeably more than it showed. The backdrop is re-sampled
        // whenever content moves underneath, and the sample area grows with the
        // radius, so this is the single cheapest frame-rate win on the screen.
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        boxShadow: 'var(--neu-sheet)',
        paddingTop: '9px',
        paddingBottom: 'calc(26px + env(safe-area-inset-bottom))',
      }}
    >
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id;
        return (
          <motion.button
            key={tab.id}
            className="flex flex-col items-center gap-1 min-w-[44px]"
            onClick={() => setTab(tab.id)}
            aria-current={isActive ? 'page' : undefined}
            whileTap={press.control}
            transition={springs.snappy}
          >
            {/*
              The active tab is a well the icon sits inside, rather than a tinted
              pill. Both the well and the colour change are CSS transitions:
              driving them through Motion meant a main-thread tick per frame for
              two paint properties, which is exactly the work a tab change
              cannot afford while the screens are crossfading.
            */}
            <div
              className="tab-well px-2.5 py-1.5 rounded-2xl"
              data-active={isActive}
              style={{ color: isActive ? 'var(--accent)' : 'var(--text3)' }}
            >
              {tab.icon}
            </div>
            <span
              className="text-[10px] font-semibold"
              style={{
                color: isActive ? 'var(--accent)' : 'var(--text3)',
                transition: 'color 200ms var(--ease-depth)',
              }}
            >
              {tab.label}
            </span>
          </motion.button>
        );
      })}
    </nav>
  );
}
