import { useEffect, useState } from 'react';

const DISMISS_KEY = 'fayolla_install_dismissed';

function isStandalone() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // iOS Safari's own flag — not covered by the standalone media query there
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

/**
 * iOS Safari never fires `beforeinstallprompt` — there is no native install
 * prompt to hook into, only the manual Share -> Add to Home Screen flow. This
 * hook just tells the UI when it's worth telling the user how to do that:
 * on an iOS browser, not already installed, and not dismissed before.
 */
export function useInstallPrompt() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (isStandalone() || !isIOS()) return;
    if (localStorage.getItem(DISMISS_KEY) === '1') return;
    setShow(true);
  }, []);

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, '1');
    setShow(false);
  };

  return { show, dismiss };
}
