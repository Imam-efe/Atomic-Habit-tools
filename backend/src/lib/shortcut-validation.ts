export type ValidationCode = 'too_short' | 'too_long' | 'invalid_input';

export interface ValidationResult {
  valid: boolean;
  code?: ValidationCode;
  error?: string;
}

/**
 * Injection guards. A bare semicolon is deliberately not listed — the
 * description never reaches SQL, and rejecting it blocked ordinary requests
 * like "start a timer; then notify me".
 */
const INJECTION_PATTERNS = [
  /drop\s+table/i,
  /delete\s+from/i,
  /insert\s+into/i,
  /union\s+select/i,
  /ignore\s+(all\s+)?previous/i,
  /disregard\s+(all\s+)?previous/i,
  /system\s+prompt/i,
  /you\s+are\s+now/i,
];

export function validateDescription(description: string): ValidationResult {
  const trimmed = description.trim();

  if (trimmed.length < 3) {
    return {
      valid: false,
      code: 'too_short',
      error: 'Deskripsi harus minimal 3 karakter.',
    };
  }

  if (trimmed.length > 500) {
    return {
      valid: false,
      code: 'too_long',
      error: 'Deskripsi harus maksimal 500 karakter.',
    };
  }

  if (INJECTION_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return {
      valid: false,
      code: 'invalid_input',
      error: 'Deskripsi tidak valid. Jelaskan tugas yang ingin diotomatiskan.',
    };
  }

  return { valid: true };
}
