import { useAuthStore } from '@/stores/authStore';
import type { User } from '@/types';

const BASE_URL = import.meta.env.VITE_API_URL ?? '/api';

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const store = useAuthStore.getState();
  const { session, accounts, addAccount } = store;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (session?.accessToken) {
    headers['Authorization'] = `Bearer ${session.accessToken}`;
  }

  let res = await fetch(`${BASE_URL}${path}`, { ...options, headers, cache: 'no-store' });

  if (res.status === 401 && session) {
    const account = accounts.find((a) => a.userId === session.user.id);
    if (account) {
      const refreshRes = await fetch(`${BASE_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: account.refreshToken }),
      });

      if (refreshRes.ok) {
        const data = (await refreshRes.json()) as {
          access_token: string;
          refresh_token: string;
          user: User;
        };

        const updatedAccount = { ...account, refreshToken: data.refresh_token };
        addAccount(updatedAccount, data.access_token, data.user);

        headers['Authorization'] = `Bearer ${data.access_token}`;
        res = await fetch(`${BASE_URL}${path}`, { ...options, headers, cache: 'no-store' });
      }
    }
  }

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'unknown error' }));
    throw new Error((error as { error: string }).error ?? res.statusText);
  }

  return res.json() as Promise<T>;
}
