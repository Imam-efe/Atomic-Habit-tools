const REQUESTS_PER_HOUR = 10;
const HOUR_MS = 3600000;

interface RateLimitState {
  count: number;
  resetAt: number;
}

interface RateLimitResult {
  allowed: boolean;
  retryAfter: number; // seconds
}

export function createRateLimitChecker(storage: Map<string, RateLimitState>) {
  return (clientIp: string): RateLimitResult => {
    const now = Date.now();
    const state = storage.get(clientIp) || {count: 0, resetAt: now + HOUR_MS};

    if (now > state.resetAt) {
      // Reset window
      state.count = 1;
      state.resetAt = now + HOUR_MS;
      storage.set(clientIp, state);
      return {allowed: true, retryAfter: 0};
    }

    if (state.count >= REQUESTS_PER_HOUR) {
      const retryAfter = Math.ceil((state.resetAt - now) / 1000);
      return {allowed: false, retryAfter};
    }

    state.count++;
    storage.set(clientIp, state);
    return {allowed: true, retryAfter: 0};
  };
}
