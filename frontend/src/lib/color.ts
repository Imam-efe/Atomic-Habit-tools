import type { ThemeName } from '@/types';

/**
 * Goal and habit colours are chosen by the user and stored as raw hex, then
 * used both as fills and as text. A palette picked to look right on the light
 * base lands around 2.3:1 as text on the dark base, so the same value cannot be
 * used verbatim in both themes.
 *
 * `readableOn` keeps the hue the user picked and moves only its lightness — up
 * toward white on the dark base, down toward black on the light one — until the
 * result clears AA against that theme's page colour. A colour that already
 * passes is returned untouched, so the common case costs nothing visually.
 *
 * These are pure functions of (hex, theme): no DOM reads, so they are safe to
 * call inside a list render without forcing layout.
 */

/** Page background per theme — mirrors `bg` in tokens/theme.ts. */
const PAGE: Record<ThemeName, RGB> = {
  light: [0xE6, 0xE9, 0xEF],
  dark: [0x22, 0x25, 0x2A],
};

type RGB = [number, number, number];

function hexToRgb(hex: string): RGB | null {
  let h = hex.trim().replace('#', '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  if (h.length !== 6 || !/^[0-9a-f]{6}$/i.test(h)) return null;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function rgbToHex([r, g, b]: RGB): string {
  return '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();
}

/** WCAG relative luminance. */
function luminance([r, g, b]: RGB): number {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function contrast(a: RGB, b: RGB): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * '#fff' or '#000', whichever a solid `hex` fill carries better as text on top
 * of it. For buttons filled with a user-picked accent: every one of the app's
 * six habit-colour swatches turns out to read under 4.5:1 for white text in at
 * least one theme (the purple and blue swatches fail in both — they were
 * tuned as accents against the page, not as a solid fill behind white type),
 * so the foreground has to be decided per colour rather than hardcoded.
 */
export function bestForegroundFor(hex: string): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return '#fff';
  const white: RGB = [255, 255, 255];
  const black: RGB = [0, 0, 0];
  return contrast(rgb, white) >= contrast(rgb, black) ? '#fff' : '#000';
}

function mix(from: RGB, to: RGB, t: number): RGB {
  return [
    from[0] + (to[0] - from[0]) * t,
    from[1] + (to[1] - from[1]) * t,
    from[2] + (to[2] - from[2]) * t,
  ];
}

/**
 * Returns `hex` adjusted until it clears `target` contrast against the theme's
 * page colour. Falls back to plain white/black only if even a full mix cannot
 * reach the target, which the 21:1 endpoints always can.
 */
export function readableOn(hex: string, theme: ThemeName, target = 4.5): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;

  const bg = PAGE[theme] ?? PAGE.light;
  if (contrast(rgb, bg) >= target) return hex;

  const toward: RGB = theme === 'dark' ? [255, 255, 255] : [0, 0, 0];
  for (let t = 0.05; t <= 1.0001; t += 0.05) {
    const candidate = mix(rgb, toward, t);
    if (contrast(candidate, bg) >= target) return rgbToHex(candidate);
  }
  return theme === 'dark' ? '#FFFFFF' : '#000000';
}
