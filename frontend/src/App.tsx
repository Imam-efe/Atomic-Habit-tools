import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, lazy } from 'react';
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import { MotionConfig } from 'framer-motion';
import { useAuthStore } from '@/stores/authStore';
import { useUIStore } from '@/stores/uiStore';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { TabBar } from '@/components/TabBar';
import { InstallPrompt } from '@/components/InstallPrompt';
import { UndoToast } from '@/components/UndoToast';
import { QuickAdd } from '@/components/QuickAdd';
import { GlobalSearch } from '@/components/GlobalSearch';
import { LoginScreen } from '@/screens/LoginScreen';
import { Dashboard } from '@/screens/Dashboard';
import { Habits } from '@/screens/Habits';
import { Goals } from '@/screens/Goals';
import { Budget } from '@/screens/Budget';
import { Calendar } from '@/screens/Calendar';
import { Garden } from '@/screens/Garden';
import { More } from '@/screens/More';
import { useOnline } from '@/hooks/useOnline';
import { applyTheme } from '@/tokens/theme';
import type { AccentName, ThemeName, TabName } from '@/types';

// Code-split sub-screens: lazy-load when user navigates to "More" menu
const Projects = lazy(() => import('@/screens/Projects').then(m => ({ default: m.Projects })));
const Activity = lazy(() => import('@/screens/Activity').then(m => ({ default: m.Activity })));
const Nutrition = lazy(() => import('@/screens/Nutrition').then(m => ({ default: m.Nutrition })));
const Menstrual = lazy(() => import('@/screens/Menstrual').then(m => ({ default: m.Menstrual })));
const Inventory = lazy(() => import('@/screens/Inventory').then(m => ({ default: m.Inventory })));
const KidsSchedule = lazy(() => import('@/screens/KidsSchedule').then(m => ({ default: m.KidsSchedule })));
const FinancialReport = lazy(() => import('@/screens/FinancialReport').then(m => ({ default: m.FinancialReport })));
const WeeklyReview = lazy(() => import('@/screens/WeeklyReview').then(m => ({ default: m.WeeklyReview })));
const MonthlyReview = lazy(() => import('@/screens/MonthlyReview').then(m => ({ default: m.MonthlyReview })));
const HabitHeatmap = lazy(() => import('@/screens/HabitHeatmap').then(m => ({ default: m.HabitHeatmap })));
const DebtPlanner = lazy(() => import('@/screens/DebtPlanner').then(m => ({ default: m.DebtPlanner })));
const NotificationCenter = lazy(() => import('@/screens/NotificationCenter').then(m => ({ default: m.NotificationCenter })));
const Achievements = lazy(() => import('@/screens/Achievements').then(m => ({ default: m.Achievements })));
const Notes = lazy(() => import('@/screens/Notes').then(m => ({ default: m.Notes })));
const Shortcuts = lazy(() => import('@/screens/Shortcuts'));
const Harian = lazy(() => import('@/screens/Harian'));
const TutupHari = lazy(() => import('@/screens/TutupHari'));
const Pola = lazy(() => import('@/screens/Pola'));
const Pengaturan = lazy(() => import('@/screens/Pengaturan'));

/**
 * Keep-alive pane for a tab screen.
 *
 * The screen mounts on its first visit and never unmounts again; switching
 * away only sets `display: none`. Coming back is therefore instant — state,
 * fetched data and DOM are all still there, exactly like a UIKit tab bar
 * controller keeps its child view controllers alive.
 *
 * The enter animation is pure CSS (`.screen-enter`): a CSS animation restarts
 * automatically when an element goes from `display: none` to visible, so a
 * re-shown tab replays the entrance with zero JavaScript on the tap's
 * critical path.
 */
function TabPane({
  id,
  active,
  animated,
  children,
}: {
  id: string;
  active: boolean;
  animated: boolean;
  children: React.ReactNode;
}) {
  // Announce re-shows (not the first mount — the screen already fetches on
  // mount) so screens showing cross-tab aggregates can refresh silently.
  const wasActive = useRef(active);
  useEffect(() => {
    if (active && !wasActive.current) {
      window.dispatchEvent(new CustomEvent('fayolla:tab-shown', { detail: id }));
    }
    wasActive.current = active;
  }, [active, id]);

  return (
    <div
      className={animated ? 'screen-enter' : undefined}
      style={active ? undefined : { display: 'none' }}
    >
      {children}
    </div>
  );
}

const VALID_TABS = new Set(['beranda', 'kebiasaan', 'kalender', 'kebun', 'goals', 'uang', 'lainnya']);

function AppShell() {
  const { activeTab, subScreen, goBack, setTab, setSubScreen } = useUIStore();
  const isOnline = useOnline();
  const location = useLocation();

  // Lands a Home Screen shortcut (manifest.json `shortcuts`) on its target tab.
  // Runs once on mount; the param is stripped right after so back/refresh don't replay it.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get('tab');
    if (tab && VALID_TABS.has(tab)) {
      setTab(tab as TabName);
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, []);

  // Handle URL-based navigation to sub-screens (e.g., /shortcuts)
  useEffect(() => {
    const pathname = location.pathname;
    if (pathname === '/shortcuts') {
      setSubScreen('shortcuts');
    }
  }, [location.pathname, setSubScreen]);

  useEffect(() => {
    let startX = 0;
    let startY = 0;

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (e.changedTouches.length !== 1) return;
      const endX = e.changedTouches[0].clientX;
      const endY = e.changedTouches[0].clientY;

      const diffX = endX - startX;
      const diffY = Math.abs(endY - startY);

      // Swipe right from left edge (startX < 80) with horizontal intent
      if (startX < 80 && diffX > 60 && diffY < 80) {
        goBack();
      }
    };

    document.addEventListener('touchstart', handleTouchStart, { passive: true });
    document.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      document.removeEventListener('touchstart', handleTouchStart);
      document.removeEventListener('touchend', handleTouchEnd);
    };
  }, [goBack]);

  // Memoised so the elements keep their identity across renders: React then
  // bails out of re-rendering the hidden screens entirely, which makes a tab
  // switch re-render just the pane wrappers.
  const screens = useMemo<Record<string, React.ReactNode>>(
    () => ({
      beranda: <Dashboard />,
      kebiasaan: <Habits />,
      kalender: <Calendar />,
      kebun: <Garden />,
      goals: <Goals />,
      uang: <Budget />,
      lainnya: <More />,
    }),
    [],
  );

  const subScreens = useMemo<Record<string, React.ReactNode>>(
    () => ({
      projects: <Projects />,
      activity: <Activity />,
      nutrition: <Nutrition />,
      menstrual: <Menstrual />,
      inventory: <Inventory />,
      'kids-schedule': <KidsSchedule />,
      'financial-report': <FinancialReport />,
      'weekly-review': <WeeklyReview />,
      'monthly-review': <MonthlyReview />,
      'habit-heatmap': <HabitHeatmap />,
      'debt-planner': <DebtPlanner />,
      'notification-center': <NotificationCenter />,
      'achievements': <Achievements />,
      'notes': <Notes />,
      'shortcuts': <Shortcuts />,
      'harian': <Harian />,
      'tutup-hari': <TutupHari />,
      'pola': <Pola />,
      'pengaturan': <Pengaturan />,
    }),
    [],
  );

  const screenKey = subScreen ?? activeTab;

  // Lazy keep-alive: a tab mounts the first time it is visited and stays
  // mounted afterwards. Mutating the ref during render is deliberate — the
  // new tab must mount in the same commit as the switch, or it would paint
  // one frame late.
  const visitedTabs = useRef(new Set<string>([activeTab]));
  if (!subScreen) visitedTabs.current.add(activeTab);

  // The very first paint skips the enter animation — an app that fades itself
  // in on load reads as slow. The flag flips on the first navigation, in the
  // same render, so the outgoing pane is already hidden when the class lands.
  const initialKey = useRef(screenKey);
  const hasNavigated = useRef(false);
  if (screenKey !== initialKey.current) hasNavigated.current = true;

  // Native tab bars remember each tab's scroll offset. Track it continuously
  // (the window scroll position is shared), restore it before paint.
  const scrollPositions = useRef<Record<string, number>>({});
  const screenKeyRef = useRef(screenKey);
  screenKeyRef.current = screenKey;
  useEffect(() => {
    const onScroll = () => {
      scrollPositions.current[screenKeyRef.current] = window.scrollY;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useLayoutEffect(() => {
    // Sub-screens are pushed fresh each time, so they always start at the top;
    // tabs restore where the user left them.
    window.scrollTo(0, subScreen ? 0 : scrollPositions.current[screenKey] ?? 0);
  }, [screenKey, subScreen]);

  return (
    <div className="max-w-[430px] mx-auto relative min-h-screen overflow-hidden">
      {!isOnline && (
        <div className="fixed top-0 left-0 right-0 bg-warn text-white text-sm px-4 py-2 text-center z-50" style={{ background: 'var(--warn)', color: '#fff' }}>
          Offline — cached data only
        </div>
      )}
      {Object.entries(screens).map(([key, node]) =>
        visitedTabs.current.has(key) ? (
          <TabPane
            key={key}
            id={key}
            active={!subScreen && activeTab === key}
            animated={hasNavigated.current}
          >
            {node}
          </TabPane>
        ) : null,
      )}
      {/* Sub-screens mount fresh per push (keyed) and animate in via CSS. */}
      {subScreen && (
        <Suspense fallback={<div className="screen-enter flex items-center justify-center min-h-screen" />}>
          <div key={subScreen} className="screen-enter">
            {subScreens[subScreen]}
          </div>
        </Suspense>
      )}
      <TabBar />
      <InstallPrompt />
      <UndoToast />
      {/* Mounted at the root: both overlays work from any tab and drive the
          shell's navigation when the user picks a result. */}
      <GlobalSearch />
      <QuickAdd />
    </div>
  );
}

export default function App() {
  const { loadFromStorage } = useAuthStore();
  const { theme, accent } = useUIStore();

  useEffect(() => {
    loadFromStorage();
  }, []);

  useEffect(() => {
    applyTheme(theme as ThemeName, accent as AccentName);
  }, [theme, accent]);

  return (
    // `reducedMotion="user"` makes every motion component honour the OS setting
    // without each one having to check useReducedMotion itself.
    <MotionConfig reducedMotion="user">
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginScreen />} />
          <Route
            path="/*"
            element={
              <ProtectedRoute>
                <AppShell />
              </ProtectedRoute>
            }
          />
        </Routes>
      </BrowserRouter>
    </MotionConfig>
  );
}
