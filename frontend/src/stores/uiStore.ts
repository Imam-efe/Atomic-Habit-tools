import { create } from 'zustand';
import type { TabName, AccentName, ThemeName } from '@/types';
import { applyTheme } from '@/tokens/theme';

interface UIState {
  activeTab: TabName;
  subScreen: string | null;
  tabHistory: TabName[];
  theme: ThemeName;
  accent: AccentName;
  setTab: (tab: TabName) => void;
  setSubScreen: (screen: string | null) => void;
  setTheme: (theme: ThemeName) => void;
  setAccent: (accent: AccentName) => void;
  goBack: () => void;
}

export const useUIStore = create<UIState>((set, get) => ({
  activeTab: 'beranda',
  subScreen: null,
  tabHistory: [],
  // Light is the neumorphic default: the shadow pair needs a mid-grey base to
  // read, and the light palette is where the effect is strongest.
  theme: 'light',
  accent: 'violet',

  setTab: (tab) => set(state => ({
    activeTab: tab,
    subScreen: null,
    // push current tab to history only if changing tabs (cap at 10 entries)
    tabHistory: state.activeTab !== tab
      ? [...state.tabHistory.slice(-9), state.activeTab]
      : state.tabHistory,
  })),

  setSubScreen: (screen) => set({ subScreen: screen }),

  goBack: () => set(state => {
    // Priority 1: close subscreen
    if (state.subScreen) return { subScreen: null };
    // Priority 2: go to previous tab in history
    if (state.tabHistory.length > 0) {
      const prev = state.tabHistory[state.tabHistory.length - 1];
      return { activeTab: prev, tabHistory: state.tabHistory.slice(0, -1) };
    }
    return {};
  }),

  setTheme: (theme) => {
    applyTheme(theme, get().accent);
    set({ theme });
  },

  setAccent: (accent) => {
    applyTheme(get().theme, accent);
    set({ accent });
  },
}));
