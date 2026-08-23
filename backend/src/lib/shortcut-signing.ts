/**
 * Shortcut Signing via CocoCloud API
 *
 * Signs iOS Shortcuts (plist XML) using external CocoCloud signing service.
 * Falls back to unsigned if CocoCloud fails after retries.
 */

interface CocoCloudResponse {
  status: 'success' | 'error';
  signedData?: string; // base64-encoded signed plist
  message?: string;
}

interface RetryOptions {
  maxRetries: number;
  initialDelayMs: number;
  backoffMultiplier: number;
}

const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxRetries: 3,
  initialDelayMs: 100,
  backoffMultiplier: 2,
};

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Call CocoCloud API to sign a plist
 *
 * @param plistXml - The plist XML content to sign
 * @param apiKey - CocoCloud API key from env var COCOCLOUD_API_KEY
 * @param certId - Certificate ID from env var COCOCLOUD_CERT_ID
 * @returns Signed plist as Buffer
 */
export async function signShortcut(
  plistXml: string,
  apiKey: string,
  certId: string,
  retryOptions: RetryOptions = DEFAULT_RETRY_OPTIONS
): Promise<Buffer> {
  const cocoCloudUrl = 'https://api.cococloud.dev/v1/sign/plist';

  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= retryOptions.maxRetries; attempt++) {
    try {
      const response = await fetch(cocoCloudUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          plist: plistXml,
          certificateId: certId,
        }),
      });

      if (!response.ok) {
        // Non-2xx response
        if (response.status === 408 || response.status === 429) {
          // Timeout or rate limit - retry
          lastError = new Error(`CocoCloud returned ${response.status}`);
          if (attempt < retryOptions.maxRetries) {
            const delayMs = retryOptions.initialDelayMs * Math.pow(retryOptions.backoffMultiplier, attempt - 1);
            await sleep(delayMs);
            continue;
          }
        }
        // Other errors - don't retry
        throw new Error(`CocoCloud API error: ${response.status}`);
      }

      // Parse response
      const data: CocoCloudResponse = await response.json();

      if (data.status === 'success' && data.signedData) {
        // Decode base64-encoded signed plist
        const signedBuffer = Buffer.from(data.signedData, 'base64');
        return signedBuffer;
      } else {
        throw new Error(`CocoCloud returned status: ${data.status}`);
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Retry on timeout or other retriable errors
      if (attempt < retryOptions.maxRetries) {
        const delayMs = retryOptions.initialDelayMs * Math.pow(retryOptions.backoffMultiplier, attempt - 1);
        await sleep(delayMs);
        continue;
      }
    }
  }

  // All retries exhausted - fallback to unsigned plist
  console.warn(
    `[shortcut-signing] Failed to sign with CocoCloud after ${retryOptions.maxRetries} attempts. Error: ${lastError?.message}. Returning unsigned plist.`
  );

  return Buffer.from(plistXml, 'utf-8');
}
