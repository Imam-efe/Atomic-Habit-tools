import { create } from 'zustand';

interface UndoToastState {
  message: string | null;
  onUndo: (() => void) | null;
  onCommit: (() => void) | null;
  timerId: ReturnType<typeof setTimeout> | null;
  /** Show an undo toast. `onCommit` runs after `durationMs` unless `undo()` is called first. */
  show: (message: string, onUndo: () => void, onCommit: () => void, durationMs?: number) => void;
  undo: () => void;
}

const DEFAULT_DURATION = 4000;

export const useUndoToastStore = create<UndoToastState>((set, get) => ({
  message: null,
  onUndo: null,
  onCommit: null,
  timerId: null,

  show: (message, onUndo, onCommit, durationMs = DEFAULT_DURATION) => {
    const prev = get();
    if (prev.timerId) clearTimeout(prev.timerId);
    // A second delete before the first toast expired commits the first
    // immediately — two pending "undo"s at once would be ambiguous.
    prev.onCommit?.();

    const timerId = setTimeout(() => {
      const commit = get().onCommit;
      set({ message: null, onUndo: null, onCommit: null, timerId: null });
      commit?.();
    }, durationMs);

    set({ message, onUndo, onCommit, timerId });
  },

  undo: () => {
    const { timerId, onUndo } = get();
    if (timerId) clearTimeout(timerId);
    onUndo?.();
    set({ message: null, onUndo: null, onCommit: null, timerId: null });
  },
}));
