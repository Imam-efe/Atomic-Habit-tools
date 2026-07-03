import { create } from 'zustand';
import type { Session, Account, User } from '../types';

interface AuthStore {
  session: Session | null;
  accounts: Account[];
  isLoading: boolean;
  addAccount: (account: Account, accessToken: string, user: User) => void;
  switchAccount: (userId: string) => Promise<void>;
  removeAccount: (userId: string) => void;
  logout: () => void;
  loadFromStorage: () => Promise<void>;
}

const ACCOUNTS_KEY = 'fayolla_accounts';
const ACTIVE_USER_KEY = 'fayolla_active_user_id';
const API_URL = import.meta.env.VITE_API_URL as string;

export const useAuthStore = create<AuthStore>((set, get) => ({
  session: null,
  accounts: [],
  isLoading: true, // stays true until loadFromStorage finishes — prevents premature /login redirect

  addAccount: (account, accessToken, user) => {
    const accounts = get().accounts.filter(a => a.userId !== account.userId);
    accounts.push(account);
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
    localStorage.setItem(ACTIVE_USER_KEY, user.id);
    set({ accounts, session: { user, accessToken } });
  },

  switchAccount: async (userId) => {
    const accounts = get().accounts;
    const target = accounts.find(a => a.userId === userId);
    if (!target) return;

    set({ isLoading: true });
    try {
      const res = await fetch(`${API_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: target.refreshToken }),
      });
      if (!res.ok) throw new Error('refresh failed');
      const data = await res.json() as { access_token: string; refresh_token: string; user: User };

      const updated = accounts.map(a =>
        a.userId === userId ? { ...a, refreshToken: data.refresh_token } : a
      );
      localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(updated));
      localStorage.setItem(ACTIVE_USER_KEY, userId);
      set({ accounts: updated, session: { user: data.user, accessToken: data.access_token }, isLoading: false });
    } catch {
      set({ isLoading: false });
      throw new Error('Failed to switch account');
    }
  },

  removeAccount: (userId) => {
    const accounts = get().accounts.filter(a => a.userId !== userId);
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
    set({ accounts });
  },

  logout: () => {
    const { session, accounts } = get();
    if (session) {
      const target = accounts.find(a => a.userId === session.user.id);
      if (target) {
        fetch(`${API_URL}/auth/logout`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: target.refreshToken }),
        }).catch(() => {});
      }
    }
    localStorage.removeItem(ACCOUNTS_KEY);
    localStorage.removeItem(ACTIVE_USER_KEY);
    set({ session: null, accounts: [], isLoading: false });
  },

  loadFromStorage: async () => {
    const raw = localStorage.getItem(ACCOUNTS_KEY);
    const activeId = localStorage.getItem(ACTIVE_USER_KEY);

    if (!raw || !activeId) {
      set({ isLoading: false });
      return;
    }

    try {
      const accounts: Account[] = JSON.parse(raw);
      const target = accounts.find(a => a.userId === activeId);
      if (!target) {
        set({ accounts, isLoading: false });
        return;
      }

      const res = await fetch(`${API_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: target.refreshToken }),
      });

      if (res.ok) {
        const data = await res.json() as { access_token: string; refresh_token: string; user: User };
        const updated = accounts.map(a =>
          a.userId === activeId ? { ...a, refreshToken: data.refresh_token } : a
        );
        localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(updated));
        set({ accounts: updated, session: { user: data.user, accessToken: data.access_token }, isLoading: false });
      } else {
        // token expired — wipe and send to login
        localStorage.removeItem(ACCOUNTS_KEY);
        localStorage.removeItem(ACTIVE_USER_KEY);
        set({ accounts: [], isLoading: false });
      }
    } catch {
      set({ isLoading: false });
    }
  },
}));
