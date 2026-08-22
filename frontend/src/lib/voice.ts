/**
 * voice.ts — dictation for quick-add, via the Web Speech API.
 *
 * Typing on a phone is the reason daily logging gets abandoned, and this is
 * the shortest path from "beli kopi 25rb" to a saved row. Support is genuinely
 * partial (Safari and Chrome ship it under the `webkit` prefix, Firefox does
 * not ship it at all), so every caller checks `isVoiceSupported()` first and
 * simply hides the microphone when it returns false — the text field is always
 * there and never depends on this.
 */

// The DOM lib has no SpeechRecognition types, so the shape used here is
// declared locally rather than pulling in a dependency for one interface.
interface SpeechRecognitionAlternativeLike {
  transcript: string;
}
interface SpeechRecognitionResultLike {
  readonly length: number;
  isFinal: boolean;
  [index: number]: SpeechRecognitionAlternativeLike;
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: {
    readonly length: number;
    [index: number]: SpeechRecognitionResultLike;
  };
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function isVoiceSupported(): boolean {
  return getCtor() !== null;
}

export interface VoiceSession {
  /** Ask for the final transcript now. Safe to call twice. */
  stop(): void;
  /** Drop the session without delivering a transcript. */
  cancel(): void;
}

export interface VoiceHandlers {
  /** Fires repeatedly while speaking, for a live preview in the input. */
  onPartial?: (text: string) => void;
  /** Fires once with the full transcript. Not called if cancelled. */
  onResult: (text: string) => void;
  onError?: (message: string) => void;
  /** Always fires last, whether the session ended, errored or was cancelled. */
  onEnd?: () => void;
}

/**
 * Start dictating in Indonesian. Returns null when the API is missing, so the
 * caller can fall back to the keyboard.
 */
export function startVoiceInput(handlers: VoiceHandlers): VoiceSession | null {
  const Ctor = getCtor();
  if (!Ctor) return null;

  const recognition = new Ctor();
  recognition.lang = 'id-ID';
  // One utterance per tap: quick-add is a sentence, not a dictation session.
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  let cancelled = false;
  let transcript = '';

  recognition.onresult = (event) => {
    let text = '';
    for (let i = 0; i < event.results.length; i++) {
      text += event.results[i][0].transcript;
    }
    transcript = text.trim();
    handlers.onPartial?.(transcript);
  };

  recognition.onerror = (event) => {
    if (cancelled) return;
    // Ending a session with nothing said is normal, not a failure worth
    // showing — the user tapped the mic and changed their mind.
    if (event.error === 'no-speech' || event.error === 'aborted') return;
    handlers.onError?.(
      event.error === 'not-allowed'
        ? 'Izin mikrofon ditolak. Aktifkan di pengaturan browser.'
        : 'Gagal mengenali suara. Coba lagi atau ketik manual.'
    );
  };

  recognition.onend = () => {
    if (!cancelled && transcript) handlers.onResult(transcript);
    handlers.onEnd?.();
  };

  try {
    recognition.start();
  } catch {
    handlers.onError?.('Tidak bisa memulai mikrofon.');
    handlers.onEnd?.();
    return null;
  }

  return {
    stop: () => recognition.stop(),
    cancel: () => {
      cancelled = true;
      recognition.abort();
    },
  };
}
