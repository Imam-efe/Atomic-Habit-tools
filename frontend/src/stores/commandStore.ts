import { create } from 'zustand';

type Overlay = 'search' | 'quickadd' | null;

interface CommandState {
  overlay: Overlay;
  /** Quick-add opens straight into dictation when launched from the mic. */
  startListening: boolean;
  openSearch: () => void;
  openQuickAdd: (opts?: { listen?: boolean }) => void;
  close: () => void;
}

/**
 * Which global overlay is open. Kept in a store rather than local state so the
 * search and quick-add panels can be mounted once at the app root — they need
 * to work from every tab, and both navigate the shell when they finish.
 */
export const useCommandStore = create<CommandState>((set) => ({
  overlay: null,
  startListening: false,
  openSearch: () => set({ overlay: 'search', startListening: false }),
  openQuickAdd: (opts) => set({ overlay: 'quickadd', startListening: !!opts?.listen }),
  close: () => set({ overlay: null, startListening: false }),
}));

/**
 * Tell any mounted screen for `tab` to refetch.
 *
 * Screens stay mounted between tab switches, so a row created from a global
 * overlay is invisible until something asks them to reload. This reuses the
 * event the tab bar already fires on re-show rather than inventing a second
 * refresh channel.
 */
export function notifyDataChanged(tab: string) {
  window.dispatchEvent(new CustomEvent('fayolla:tab-shown', { detail: tab }));
}
