export const accents = {
  violet: { primary: '#7C5CFF', gradient: '#9D7CFF', soft: 'rgba(124,92,255,0.16)' },
  green: { primary: '#34C759', gradient: '#5BD97A', soft: 'rgba(52,199,89,0.16)' },
  blue: { primary: '#0A84FF', gradient: '#4AA8FF', soft: 'rgba(10,132,255,0.16)' },
  orange: { primary: '#FF9F0A', gradient: '#FFB740', soft: 'rgba(255,159,10,0.16)' },
} as const;

export type AccentName = keyof typeof accents;
export type ThemeName = 'dark' | 'light';

export const darkTokens = {
  bg: '#000000',
  surface: '#1C1C1E',
  text: '#FFFFFF',
  text2: 'rgba(235,235,245,0.62)',
  text3: 'rgba(235,235,245,0.30)',
  sep: 'rgba(84,84,88,0.50)',
  track: 'rgba(120,120,128,0.28)',
  blur: 'rgba(22,22,24,0.78)',
};

export const lightTokens = {
  bg: '#F2F2F7',
  surface: '#FFFFFF',
  text: '#000000',
  text2: 'rgba(60,60,67,0.60)',
  text3: 'rgba(60,60,67,0.30)',
  sep: 'rgba(60,60,67,0.14)',
  track: 'rgba(120,120,128,0.16)',
  blur: 'rgba(255,255,255,0.78)',
};

export function applyTheme(theme: ThemeName, accent: AccentName): void {
  const root = document.documentElement;
  const tokens = theme === 'dark' ? darkTokens : lightTokens;
  const accentTokens = accents[accent];

  Object.entries(tokens).forEach(([key, value]) => {
    root.style.setProperty(`--${key}`, value);
  });

  root.style.setProperty('--accent', accentTokens.primary);
  root.style.setProperty('--accent2', accentTokens.gradient);
  root.style.setProperty('--accentSoft', accentTokens.soft);
  root.setAttribute('data-theme', theme);
}
