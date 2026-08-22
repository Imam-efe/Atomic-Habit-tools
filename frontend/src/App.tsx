import { useEffect, useLayoutEffect } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AnimatePresence, MotionConfig, motion } from 'framer-motion';
import { useAuthStore } from '@/stores/authStore';
import { useUIStore } from '@/stores/uiStore';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { TabBar } from '@/components/TabBar';
import { LoginScreen } from '@/screens/LoginScreen';
import { Dashboard } from '@/screens/Dashboard';
import { Habits } from '@/screens/Habits';
import { Goals } from '@/screens/Goals';
import { Budget } from '@/screens/Budget';
import { Calendar } from '@/screens/Calendar';
import { More } from '@/screens/More';
import { Projects } from '@/screens/Projects';
import { Activity } from '@/screens/Activity';
import { Nutrition } from '@/screens/Nutrition';
import { Menstrual } from '@/screens/Menstrual';
import { Inventory } from '@/screens/Inventory';
import { KidsSchedule } from '@/screens/KidsSchedule';
import { FinancialReport } from '@/screens/FinancialReport';
import { WeeklyReview } from '@/screens/WeeklyReview';
import { HabitHeatmap } from '@/screens/HabitHeatmap';
import { DebtPlanner } from '@/screens/DebtPlanner';
import { NotificationCenter } from '@/screens/NotificationCenter';
import { applyTheme } from '@/tokens/theme';
import { screenTransition, screenVariants } from '@/tokens/motion';
import type { AccentName, ThemeName } from '@/types';

function AppShell() {
  const { activeTab, subScreen, setSubScreen, goBack } = useUIStore();

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

  const screens: Record<string, React.ReactNode> = {
    beranda: <Dashboard />,
    kebiasaan: <Habits />,
    kalender: <Calendar />,
    goals: <Goals />,
    uang: <Budget />,
    lainnya: <More />,
  };

  const subScreens: Record<string, React.ReactNode> = {
    projects: <Projects />,
    activity: <Activity />,
    nutrition: <Nutrition />,
    menstrual: <Menstrual />,
    inventory: <Inventory />,
    'kids-schedule': <KidsSchedule />,
    'financial-report': <FinancialReport />,
    'weekly-review': <WeeklyReview />,
    'habit-heatmap': <HabitHeatmap />,
    'debt-planner': <DebtPlanner />,
    'notification-center': <NotificationCenter />,
  };

  const screenKey = subScreen ?? activeTab;
  const currentScreen = subScreen ? subScreens[subScreen] : screens[activeTab];

  // The incoming screen starts at whatever scroll offset the outgoing one left
  // behind, which makes a clean crossfade look like a jump. Reset before paint
  // so the new screen is never seen at the wrong offset.
  useLayoutEffect(() => {
    window.scrollTo(0, 0);
  }, [screenKey]);

  return (
    <div className="max-w-[430px] mx-auto relative min-h-screen overflow-hidden">
      {/*
        `popLayout` takes the outgoing screen out of flow, so the two overlap
        and genuinely crossfade instead of stacking and shoving the page down.
        `initial={false}` skips the enter animation on first paint — an app that
        fades itself in on load reads as slow.
      */}
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.div
          key={screenKey}
          variants={screenVariants}
          initial="initial"
          animate="animate"
          exit="exit"
          transition={{
            duration: screenTransition.enter,
            ease: screenTransition.ease,
            exit: { duration: screenTransition.exit, ease: screenTransition.ease },
          }}
          // No will-change here on purpose. Motion adds it for the values it is
          // animating and drops it again afterwards; a permanent one would make
          // this div a containing block and reparent the fixed modals the
          // screens render inside it.
        >
          {currentScreen}
        </motion.div>
      </AnimatePresence>
      <TabBar />
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
