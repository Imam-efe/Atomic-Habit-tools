import { useEffect } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { useUIStore } from '@/stores/uiStore';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { TabBar } from '@/components/TabBar';
import { LoginScreen } from '@/screens/LoginScreen';
import { Dashboard } from '@/screens/Dashboard';
import { Habits } from '@/screens/Habits';
import { Goals } from '@/screens/Goals';
import { Budget } from '@/screens/Budget';
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
import { applyTheme } from '@/tokens/theme';
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
  };

  const currentScreen = subScreen ? subScreens[subScreen] : screens[activeTab];

  return (
    <div className="max-w-[430px] mx-auto relative min-h-screen overflow-hidden">
      {currentScreen}
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
  );
}
