// Local device-lock gate using the platform WebAuthn authenticator (Face ID /
// Touch ID / device passcode). There is no backend: the credential id lives
// only in this device's localStorage, and unlocking never touches the
// network. This is a privacy screen, not account authentication — the
// budget and menstrual-cycle data in this app deserve more than "anyone who
// picks up the phone can look", but the actual login is still Google OAuth.
// The security property comes entirely from the OS: `credentials.get()`
// only resolves if the platform authenticator ceremony (biometric or device
// passcode) succeeds.

const CRED_ID_KEY = 'fayolla_applock_cred_id';
const ENABLED_KEY = 'fayolla_applock_enabled';

function randomBytes(len: number) {
  return crypto.getRandomValues(new Uint8Array(len));
}

function toBase64(bytes: ArrayBuffer) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

function fromBase64(b64: string) {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

export async function isBiometricAvailable(): Promise<boolean> {
  if (typeof PublicKeyCredential === 'undefined' || !PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable) {
    return false;
  }
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

export function isAppLockEnabled(): boolean {
  return localStorage.getItem(ENABLED_KEY) === '1' && !!localStorage.getItem(CRED_ID_KEY);
}

export async function enableAppLock(): Promise<boolean> {
  try {
    const cred = (await navigator.credentials.create({
      publicKey: {
        challenge: randomBytes(32),
        rp: { name: 'Fayolla' },
        user: { id: randomBytes(16), name: 'fayolla-device', displayName: 'Fayolla' },
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 },
          { type: 'public-key', alg: -257 },
        ],
        authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required' },
        timeout: 60000,
      },
    })) as PublicKeyCredential | null;

    if (!cred) return false;
    localStorage.setItem(CRED_ID_KEY, toBase64(cred.rawId));
    localStorage.setItem(ENABLED_KEY, '1');
    return true;
  } catch {
    return false;
  }
}

export function disableAppLock() {
  localStorage.removeItem(ENABLED_KEY);
  localStorage.removeItem(CRED_ID_KEY);
}

export async function verifyAppLock(): Promise<boolean> {
  const credIdB64 = localStorage.getItem(CRED_ID_KEY);
  if (!credIdB64) return false;
  try {
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge: randomBytes(32),
        allowCredentials: [{ id: fromBase64(credIdB64), type: 'public-key' }],
        userVerification: 'required',
        timeout: 60000,
      },
    });
    return !!assertion;
  } catch {
    return false;
  }
}
