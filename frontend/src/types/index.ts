export interface User {
  id: string;
  name: string;
  role: string;
  accent: string;
  theme: string;
}

export interface Account {
  userId: string;
  name: string;
  refreshToken: string;
  role: string;
}

export interface Session {
  user: User;
  accessToken: string;
}

export type TabName = 'beranda' | 'kebiasaan' | 'goals' | 'uang' | 'lainnya';
export type AccentName = 'violet' | 'green' | 'blue' | 'orange';
export type ThemeName = 'dark' | 'light';
