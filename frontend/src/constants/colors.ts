/**
 * Category and data visualization colors.
 * These are intentional design colors for charts, categories, and data visualization.
 * They are separate from theme tokens and remain consistent across theme changes.
 */

export const CHART_PALETTE = [
  '#7C5CFF',
  'var(--warn)',
  '#0A84FF',
  '#FF375F',
  'var(--pos)',
  '#5E5CE6',
  'var(--neg)',
  '#8E8E93',
  '#5AC8FA',
  '#FF1493',
  '#32CD32',
];

export const ACTIVITY_COLORS: Record<string, string> = {
  'Deep Work': '#7C5CFF',
  'Shallow Work': 'var(--warn)',
  'Rest': '#5AC8FA',
  'Learning': 'var(--pos)',
  'Social': '#FF375F',
  'Health': '#5E5CE6',
};

export const NUTRITION_MACROS = {
  protein: '#E63946',
  carbs: 'var(--warn)',
  fat: '#5FB0FF',
  fiber: 'var(--pos)',
};

export const CONFETTI_COLORS = [
  '#7C5CFF',
  'var(--pos)',
  'var(--warn)',
  '#FF375F',
  '#0A84FF',
  '#5E5CE6',
];
