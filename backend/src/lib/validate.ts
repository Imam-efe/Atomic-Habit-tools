/**
 * validate.ts — Input validation utility for backend routes.
 *
 * Usage:
 *   const err = validate(body, {
 *     name:   { type: 'string' },
 *     type:   { type: 'enum', values: ['income', 'expense'] },
 *     amount: { type: 'number', min: 1 },
 *   });
 *   if (err) return c.json({ error: err }, 400);
 */

type StringRule = { type: 'string'; min?: number };
type NumberRule = { type: 'number'; min?: number };
type EnumRule   = { type: 'enum'; values: readonly string[] };
type DateRule   = { type: 'date' };   // YYYY-MM-DD, required
type TimeRule   = { type: 'time' };   // HH:MM, required
type MonthRule  = { type: 'month' };  // YYYY-MM, required

type FieldRule = StringRule | NumberRule | EnumRule | DateRule | TimeRule | MonthRule;

/**
 * Validates body against rules.
 * Returns an error string on first failure, or null if valid.
 * All rules treat the field as required unless the field is absent and you only
 * need optional format checks — use the standalone helpers below for that.
 */
export function validate(
  body: Record<string, unknown>,
  rules: Record<string, FieldRule>
): string | null {
  for (const [field, rule] of Object.entries(rules)) {
    const value = body[field];

    switch (rule.type) {
      case 'string': {
        if (typeof value !== 'string' || !value.trim()) {
          return `${field} is required`;
        }
        if (rule.min !== undefined && value.trim().length < rule.min) {
          return `${field} must be at least ${rule.min} characters`;
        }
        break;
      }
      case 'number': {
        if (value === undefined || value === null || typeof value !== 'number' || isNaN(value)) {
          return `${field} must be a number`;
        }
        if (rule.min !== undefined && value < rule.min) {
          return `${field} must be >= ${rule.min}`;
        }
        break;
      }
      case 'enum': {
        if (typeof value !== 'string' || !rule.values.includes(value)) {
          return `${field} must be one of: ${rule.values.join(', ')}`;
        }
        break;
      }
      case 'date': {
        if (typeof value !== 'string' || !isDate(value)) {
          return `${field} must be a date (YYYY-MM-DD)`;
        }
        break;
      }
      case 'time': {
        if (typeof value !== 'string' || !isTime(value)) {
          return `${field} must be a time (HH:MM)`;
        }
        break;
      }
      case 'month': {
        if (typeof value !== 'string' || !isMonth(value)) {
          return `${field} must be a month (YYYY-MM)`;
        }
        break;
      }
    }
  }
  return null;
}

/** YYYY-MM-DD */
export const isDate  = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s);

/** HH:MM */
export const isTime  = (s: string): boolean => /^\d{2}:\d{2}$/.test(s);

/** YYYY-MM */
export const isMonth = (s: string): boolean => /^\d{4}-\d{2}$/.test(s);

/** #RRGGBB */
export const isHexColor = (s: string): boolean => /^#[0-9A-Fa-f]{6}$/.test(s);

/** Returns today's date in Jakarta timezone (UTC+7) as YYYY-MM-DD */
export function jakartaToday(): string {
  const now = new Date();
  const jakarta = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  return jakarta.toISOString().slice(0, 10);
}

/** Advance a YYYY-MM-DD date by the given recurrence interval */
export function advanceDate(dateStr: string, recurrence: 'daily' | 'weekly' | 'monthly'): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  if (recurrence === 'daily') dt.setDate(dt.getDate() + 1);
  else if (recurrence === 'weekly') dt.setDate(dt.getDate() + 7);
  else if (recurrence === 'monthly') dt.setMonth(dt.getMonth() + 1);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}
