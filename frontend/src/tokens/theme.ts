/**
 * Neumorphic design tokens.
 *
 * Neumorphism has two hard requirements the previous flat theme did not:
 *
 *  1. Surfaces share the page background colour. Depth comes from a pair of
 *     shadows — a light one up-left, a dark one down-right — not from a fill
 *     that contrasts with the page, and not from borders.
 *  2. The base cannot be pure black or pure white, or the light shadow has
 *     nowhere to go. Light mode sits on a soft grey, dark mode on a lifted
 *     charcoal.
 *
 * Every foreground colour below clears WCAG AA (4.5:1) against its own base,
 * which is what keeps this readable — soft-grey-on-soft-grey text is the usual
 * way neumorphism fails.
 */

export type AccentName = 'violet' | 'green' | 'blue' | 'orange';
export type ThemeName = 'dark' | 'light';

interface AccentTokens {
  /** Fills and icons. Carries white text at AA. */
  primary: string;
  /** Lighter sibling, for gradient fills. */
  gradient: string;
  /** Translucent tint for icon chips and glows. */
  soft: string;
}

/**
 * Light accents are darkened from the usual iOS palette so they clear AA as
 * text on the grey base; dark accents are lightened for the same reason.
 */
const lightAccents: Record<AccentName, AccentTokens> = {
  violet: { primary: '#5B41D6', gradient: '#7C5CFF', soft: 'rgba(91,65,214,0.14)' },
  green: { primary: '#1B6E37', gradient: '#2E9C52', soft: 'rgba(27,110,55,0.14)' },
  blue: { primary: '#0A5FC8', gradient: '#2A86F0', soft: 'rgba(10,95,200,0.14)' },
  orange: { primary: '#8A5300', gradient: '#C07A10', soft: 'rgba(138,83,0,0.14)' },
};

const darkAccents: Record<AccentName, AccentTokens> = {
  violet: { primary: '#A48DFF', gradient: '#7C5CFF', soft: 'rgba(164,141,255,0.18)' },
  green: { primary: '#5BD97A', gradient: '#34C759', soft: 'rgba(91,217,122,0.18)' },
  blue: { primary: '#5FB0FF', gradient: '#0A84FF', soft: 'rgba(95,176,255,0.18)' },
  orange: { primary: '#FFB740', gradient: '#FF9F0A', soft: 'rgba(255,183,64,0.18)' },
};

export const accents = lightAccents;

/**
 * Shadow geometry is shared; only the two shadow colours change per theme, so
 * the depth reads the same in both.
 *
 * The offsets reference --neu-light / --neu-dark rather than baking the hex in,
 * so every shadow re-resolves the moment those two change. Baking them would
 * leave the shadows on the previous theme's colours until applyTheme reran.
 */
function neuShadows(light: string, dark: string) {
  const L = 'var(--neu-light)';
  const D = 'var(--neu-dark)';
  return {
    'neu-light': light,
    'neu-dark': dark,
    /** Default raised card. */
    'neu-raised': `6px 6px 14px ${D}, -6px -6px 14px ${L}`,
    /** Chips, small buttons, list rows — shallower so they nest inside cards. */
    'neu-raised-sm': `3px 3px 7px ${D}, -3px -3px 7px ${L}`,
    /** Hero surfaces that should float above the rest of the page. */
    'neu-raised-lg': `10px 10px 24px ${D}, -10px -10px 24px ${L}`,
    /** Progress tracks, inputs, wells. */
    'neu-inset': `inset 4px 4px 9px ${D}, inset -4px -4px 9px ${L}`,
    /** Active/selected state — the surface reads as pushed in. */
    'neu-pressed': `inset 6px 6px 12px ${D}, inset -6px -6px 12px ${L}`,
    /** Bottom sheets and the tab bar, lit from above only. */
    'neu-sheet': `0 -8px 24px ${D}`,
    /** Removes depth without changing layout. */
    'neu-flat': '0 0 0 0 rgba(0,0,0,0)',
  };
}

export const lightTokens = {
  bg: '#E6E9EF',
  // Same value as bg on purpose: a neumorphic surface is the page, raised.
  surface: '#E6E9EF',
  text: '#171A21',
  text2: '#4A5261',
  text3: '#5C6472',
  sep: 'rgba(195,201,212,0.55)',
  track: '#D5DAE3',
  blur: 'rgba(230,233,239,0.82)',
  // Income / expense / expiry. The iOS-bright versions the dark theme uses sit
  // around 2:1 on this grey, so light mode needs its own, deeper set.
  pos: '#1B6E37',
  neg: '#C0281A',
  warn: '#8A5300',
  info: '#0A5FC8',
  warnBorder: 'rgba(138,83,0,0.35)',
  ...neuShadows('#FFFFFF', '#C3C9D4'),
};

export const darkTokens = {
  bg: '#22252A',
  surface: '#22252A',
  text: '#F4F6F9',
  text2: '#B2B9C6',
  text3: '#8A92A1',
  sep: 'rgba(23,26,30,0.75)',
  track: '#1C1F24',
  blur: 'rgba(34,37,42,0.82)',
  pos: '#34C759',
  neg: '#FF453A',
  warn: '#FF9F0A',
  info: '#5FB0FF',
  warnBorder: 'rgba(255,159,10,0.35)',
  ...neuShadows('#2B2F36', '#171A1E'),
};

export function applyTheme(theme: ThemeName, accent: AccentName): void {
  const root = document.documentElement;
  const tokens = theme === 'dark' ? darkTokens : lightTokens;
  const accentTokens = (theme === 'dark' ? darkAccents : lightAccents)[accent];

  Object.entries(tokens).forEach(([key, value]) => {
    root.style.setProperty(`--${key}`, value);
  });

  root.style.setProperty('--accent', accentTokens.primary);
  root.style.setProperty('--accent2', accentTokens.gradient);
  root.style.setProperty('--accentSoft', accentTokens.soft);
  root.setAttribute('data-theme', theme);
}
