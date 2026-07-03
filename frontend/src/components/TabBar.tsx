import { motion } from 'framer-motion';
import { useUIStore } from '@/stores/uiStore';
import { springs } from '@/tokens/motion';
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

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 flex items-end justify-around px-2"
      style={{
        background: 'var(--blur)',
        backdropFilter: 'blur(22px)',
        WebkitBackdropFilter: 'blur(22px)',
        borderTop: '1px solid var(--sep)',
        paddingTop: '9px',
        paddingBottom: 'calc(26px + env(safe-area-inset-bottom))',
      }}
    >
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id;
        return (
          <motion.button
            key={tab.id}
            className="flex flex-col items-center gap-1 min-w-[48px]"
            onClick={() => setTab(tab.id)}
            whileTap={{ scale: 0.9 }}
            transition={springs.snappy}
          >
            <motion.div
              animate={{
                scale: isActive ? 1.1 : 1,
                color: isActive ? 'var(--accent)' : 'var(--text3)',
              }}
              transition={springs.bouncy}
            >
              {tab.icon}
            </motion.div>
            <span
              className="text-[10px] font-semibold"
              style={{ color: isActive ? 'var(--accent)' : 'var(--text3)' }}
            >
              {tab.label}
            </span>
          </motion.button>
        );
      })}
    </nav>
  );
}
