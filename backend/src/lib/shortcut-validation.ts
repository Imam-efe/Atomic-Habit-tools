export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export function validateDescription(description: string): ValidationResult {
  const trimmed = description.trim();

  if (trimmed.length < 3) {
    return {valid: false, error: 'Deskripsi harus minimal 3 karakter.'};
  }

  if (trimmed.length > 500) {
    return {valid: false, error: 'Deskripsi harus maksimal 500 karakter.'};
  }

  // Basic injection patterns
  const injectionPatterns = [
    /drop\s+table/i,
    /delete\s+from/i,
    /;/,
    /ignore\s+all\s+previous/i,
    /system\s+prompt/i,
    /you\s+are\s+now/i,
  ];

  if (injectionPatterns.some((pattern) => pattern.test(trimmed))) {
    return {valid: false, error: 'Deskripsi tidak valid.'};
  }

  return {valid: true};
}
