import { useEffect } from 'react';

interface BadgeNavigator {
  setAppBadge?: (count?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
}

/** Mirrors the count onto the Home Screen app icon (Safari 16.4+, iOS 16.4+). */
export function useAppBadge(count: number) {
  useEffect(() => {
    const nav = navigator as unknown as BadgeNavigator;
    if (!nav.setAppBadge || !nav.clearAppBadge) return;

    if (count > 0) {
      nav.setAppBadge(count).catch(() => {});
    } else {
      nav.clearAppBadge().catch(() => {});
    }
  }, [count]);
}
