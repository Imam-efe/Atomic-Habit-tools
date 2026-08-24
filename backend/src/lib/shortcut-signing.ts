/**
 * Optional shortcut signing.
 *
 * Signing a shortcut needs Apple's own tooling, which cannot run on Workers,
 * so it has to be delegated to an external signer. No signer is configured by
 * default: unsigned shortcuts still install on iOS once "Allow Untrusted
 * Shortcuts" is on in Settings > Shortcuts, which is the honest fallback.
 *
 * Point SHORTCUT_SIGNING_URL at a service that accepts
 * `{ plist: string }` and returns `{ signed: "<base64>" }` to enable it;
 * SHORTCUT_SIGNING_KEY is sent as a bearer token when set.
 */

export interface SigningConfig {
  url?: string;
  apiKey?: string;
}

export interface SignResult {
  /** The bytes to hand back to the caller, signed or not. */
  data: Uint8Array;
  signed: boolean;
}

const SIGNING_TIMEOUT_MS = 5000;

function encodeUtf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** Base64 for arbitrary bytes, chunked so large files do not blow the stack. */
export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

/**
 * Sign the plist if a signer is configured, otherwise return it as-is.
 *
 * Never throws: a signer that is down or misbehaving degrades to an unsigned
 * shortcut rather than failing the user's request.
 */
export async function signShortcut(
  plistXml: string,
  config: SigningConfig = {}
): Promise<SignResult> {
  const unsigned: SignResult = { data: encodeUtf8(plistXml), signed: false };

  if (!config.url) return unsigned;

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (config.apiKey) headers['Authorization'] = `Bearer ${config.apiKey}`;

    const response = await fetch(config.url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ plist: plistXml }),
      signal: AbortSignal.timeout(SIGNING_TIMEOUT_MS),
    });

    if (!response.ok) {
      console.warn(`[shortcut-signing] signer returned ${response.status}; sending unsigned`);
      return unsigned;
    }

    const body = (await response.json()) as { signed?: unknown };
    if (typeof body.signed !== 'string' || body.signed === '') {
      console.warn('[shortcut-signing] signer response missing "signed"; sending unsigned');
      return unsigned;
    }

    return { data: decodeBase64(body.signed), signed: true };
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'unknown';
    console.warn(`[shortcut-signing] signing failed (${reason}); sending unsigned`);
    return unsigned;
  }
}
