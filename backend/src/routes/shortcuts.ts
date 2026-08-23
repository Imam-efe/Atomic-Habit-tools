import { Hono } from 'hono';
import type { Env } from '../types';
import { validateDescription } from '../lib/shortcut-validation';
import { generateShortcutPlist } from '../lib/shortcut-ai';
import type { Env as AiEnv } from '../lib/shortcut-ai';
import { signShortcut } from '../lib/shortcut-signing';
import { getErrorResponse } from '../lib/shortcut-errors';
import { createRateLimitChecker } from '../lib/shortcut-ratelimit';

// Rate limit storage: Map<clientIp, RateLimitState>
const rateLimitStorage = new Map<string, { count: number; resetAt: number }>();

type ShortcutsContext = {
  Bindings: Env;
};

const shortcuts = new Hono<ShortcutsContext>();
const rateLimitChecker = createRateLimitChecker(rateLimitStorage);

/**
 * Extract client IP from request headers
 */
function getClientIp(c: any): string {
  // Check CF-Connecting-IP (Cloudflare Workers)
  const cfConnectingIp = c.req.header('cf-connecting-ip');
  if (cfConnectingIp) {
    return cfConnectingIp;
  }

  // Check X-Forwarded-For
  const xForwardedFor = c.req.header('x-forwarded-for');
  if (xForwardedFor) {
    return xForwardedFor.split(',')[0].trim();
  }

  // Fallback to 127.0.0.1 (should not happen in production)
  return '127.0.0.1';
}

/**
 * Generate ISO timestamp (YYYYMMDD-HHmmss)
 */
function generateTimestamp(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  return `${year}${month}${day}-${hours}${minutes}${seconds}`;
}

// POST /api/shortcuts/generate - Generate a shortcut from description
shortcuts.post('/generate', async (c) => {
  const clientIp = getClientIp(c);

  // Parse request body
  let body: { description?: string };
  try {
    body = await c.req.json();
  } catch {
    const err = getErrorResponse('server_error');
    return c.json(err, 400);
  }

  const { description } = body;

  // Validate input
  const validation = validateDescription(description || '');
  if (!validation.valid) {
    const err = getErrorResponse('server_error');
    return c.json(err, 400);
  }

  // Check rate limit
  const rateLimitResult = rateLimitChecker(clientIp);
  if (!rateLimitResult.allowed) {
    const err = getErrorResponse('rate_limit');
    return c.json(err, 429);
  }

  try {
    // Generate plist from description using AI
    // Cast to AiEnv which has the 'ai' property
    const plistXml = await generateShortcutPlist(c.env as unknown as AiEnv, description!);

    // Sign the plist using CocoCloud
    const apiKey = c.env.COCOCLOUD_API_KEY;
    const certId = c.env.COCOCLOUD_CERT_ID;

    let signedBuffer: any;
    if (apiKey && certId) {
      signedBuffer = await signShortcut(plistXml, apiKey, certId);
    } else {
      // Fallback to unsigned if no signing credentials
      console.warn('[shortcuts] Missing COCOCLOUD credentials, returning unsigned shortcut');
      // Use type any to avoid Buffer type issues in Cloudflare Workers
      signedBuffer = (globalThis as any).Buffer.from(plistXml, 'utf-8');
    }

    // Encode signed plist as base64
    const base64Shortcut = (signedBuffer as any).toString('base64');

    // Generate filename
    const timestamp = generateTimestamp();
    const filename = `shortcut-${timestamp}.shortcut`;

    // Return success response
    return c.json(
      {
        shortcut: base64Shortcut,
        filename,
      },
      200 as any
    );
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'unknown';

    // Determine error type from message
    let errorType = 'server_error';
    let statusCode: any = 500;

    if (errorMessage === 'invalid_plist') {
      errorType = 'invalid_plist';
      statusCode = 400;
    } else if (errorMessage === 'ai_timeout') {
      errorType = 'ai_timeout';
      statusCode = 504;
    } else if (errorMessage === 'too_short') {
      errorType = 'too_short';
      statusCode = 400;
    } else if (errorMessage === 'too_long') {
      errorType = 'too_long';
      statusCode = 400;
    }

    const errorResponse = getErrorResponse(errorType);
    return c.json(errorResponse, statusCode as any);
  }
});

export default shortcuts;
