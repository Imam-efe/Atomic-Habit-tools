interface ShareNavigator {
  share?: (data: { title?: string; text?: string; url?: string }) => Promise<void>;
}

/** Native share sheet when available; silently no-ops if the browser lacks it. */
export async function shareProgress(text: string) {
  const nav = navigator as unknown as ShareNavigator;
  if (!nav.share) return false;
  try {
    await nav.share({ title: 'Fayolla', text, url: window.location.origin });
    return true;
  } catch {
    // AbortError from a user-cancelled sheet is expected, not a failure to surface.
    return false;
  }
}

export function canShare() {
  return typeof (navigator as unknown as ShareNavigator).share === 'function';
}
