export interface ShortcutsError {
  error: string;
  message: string;
  suggestion?: string;
}

const RESPONSES: Record<string, ShortcutsError> = {
  invalid_request: {
    error: 'invalid_request',
    message: 'Permintaan tidak valid.',
    suggestion: 'Muat ulang halaman lalu coba lagi.',
  },
  invalid_input: {
    error: 'invalid_input',
    message: 'Deskripsi tidak valid. Jelaskan tugas yang ingin diotomatiskan.',
    suggestion: 'Misalnya: "set a 5-minute timer" atau "ingatkan saya minum air".',
  },
  invalid_plist: {
    error: 'invalid_plist',
    message: 'Tidak bisa membuat shortcut untuk ini. Coba deskripsi yang lebih spesifik.',
    suggestion: 'Misalnya: "set a 5-minute timer" atau "kirim pesan ke ibu".',
  },
  ai_timeout: {
    error: 'ai_timeout',
    message: 'Permintaan terlalu lama. Coba deskripsi yang lebih sederhana.',
    suggestion: 'Deskripsi pendek seperti "set timer 10 menit" lebih cepat diproses.',
  },
  ai_error: {
    error: 'ai_error',
    message: 'Layanan AI sedang bermasalah. Coba lagi sebentar lagi.',
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

export function getErrorResponse(errorType: string, message?: string): ShortcutsError {
  const base = RESPONSES[errorType] ?? RESPONSES.server_error;
  // A caller with a more specific message (e.g. the validator's own wording)
  // overrides the catalog default, keeping the code and suggestion intact.
  return message ? { ...base, message } : base;
}
