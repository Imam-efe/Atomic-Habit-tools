export interface ShortcutsError {
  error: string;
  message: string;
  suggestion?: string;
}

export function getErrorResponse(errorType: string): ShortcutsError {
  const responses: Record<string, ShortcutsError> = {
    invalid_plist: {
      error: 'invalid_plist',
      message: 'Tidak bisa membuat shortcut untuk ini. Coba deskripsi yang lebih spesifik.',
      suggestion: "Misalnya: 'set a 5-minute timer' atau 'send a message to mom'",
    },
    ai_timeout: {
      error: 'ai_timeout',
      message: 'Permintaan terlalu lama. Coba deskripsi yang lebih sederhana.',
      suggestion: 'Deskripsi pendek seperti "set timer" lebih cepat diproses.',
    },
    too_short: {
      error: 'too_short',
      message: 'Deskripsi harus minimal 3 karakter.',
    },
    too_long: {
      error: 'too_long',
      message: 'Deskripsi harus maksimal 500 karakter.',
    },
    rate_limit: {
      error: 'rate_limit',
      message: 'Terlalu banyak permintaan. Coba lagi dalam beberapa menit.',
    },
    server_error: {
      error: 'server_error',
      message: 'Terjadi kesalahan server. Hubungi support.',
    },
  };

  return responses[errorType] || responses.server_error;
}
