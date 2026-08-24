import { Hono } from 'hono';
import { requireAuth, type AuthContext } from '../middleware/auth';
import { validateDescription } from '../lib/shortcut-validation';
import { generateShortcutPlist, type ShortcutAiEnv } from '../lib/shortcut-ai';
import { signShortcut, toBase64 } from '../lib/shortcut-signing';
import { getErrorResponse } from '../lib/shortcut-errors';
import { createRateLimitChecker } from '../lib/shortcut-ratelimit';

// Per-isolate counter. Workers may run several isolates, so this caps abuse
// rather than enforcing an exact global quota — enough for a stateless
// feature that costs neurons but writes nothing.
const rateLimitStorage = new Map<string, { count: number; resetAt: number }>();
const rateLimitChecker = createRateLimitChecker(rateLimitStorage);

const shortcuts = new Hono<AuthContext>();
shortcuts.use('/*', requireAuth);

/** Identify the caller for rate limiting: user id first, client IP as backup. */
function rateLimitKey(c: {
  get: (key: 'user') => { sub?: string } | undefined;
  req: { header: (name: string) => string | undefined };
}): string {
  const userId = c.get('user')?.sub;
  if (userId) return `user:${userId}`;

  const cfIp = c.req.header('cf-connecting-ip');
  if (cfIp) return `ip:${cfIp}`;

  const forwarded = c.req.header('x-forwarded-for');
  if (forwarded) return `ip:${forwarded.split(',')[0].trim()}`;

  return 'ip:unknown';
}

/** Filename stamp, YYYYMMDD-HHmmss in UTC so it does not drift by region. */
function generateTimestamp(): string {
  return new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
}

// POST /api/shortcuts/generate — description in, installable shortcut out.
shortcuts.post('/generate', async (c) => {
  const body = await c.req.json<{ description?: string }>().catch(() => null);
  if (!body) {
    return c.json(getErrorResponse('invalid_request'), 400);
  }

  const description = body.description ?? '';

  const validation = validateDescription(description);
  if (!validation.valid) {
    // Hand back the validator's own wording; a generic "server error" here
    // told the user nothing about what to change.
    return c.json(getErrorResponse(validation.code ?? 'invalid_input', validation.error), 400);
  }

  const key = rateLimitKey(c);
  if (!rateLimitChecker(key).allowed) {
    return c.json(getErrorResponse('rate_limit'), 429);
  }

  try {
    const { plist, steps } = await generateShortcutPlist(
      c.env as unknown as ShortcutAiEnv,
      description.trim()
    );

    const { data, signed } = await signShortcut(plist, {
      url: c.env.SHORTCUT_SIGNING_URL,
      apiKey: c.env.SHORTCUT_SIGNING_KEY,
    });

    return c.json({
      shortcut: toBase64(data),
      filename: `shortcut-${generateTimestamp()}.shortcut`,
      signed,
      // iOS 15+ refuses unsigned shortcut files outright, so when no signer is
      // configured the steps are the only way the user can actually get this
      // shortcut onto their device.
      steps,
    });
  } catch (err) {
    // The description itself is never logged — only the failure code.
    const code = err instanceof Error ? err.message : 'server_error';

    if (code === 'invalid_plist') {
      return c.json(getErrorResponse('invalid_plist'), 400);
    }
    if (code === 'ai_timeout') {
      return c.json(getErrorResponse('ai_timeout'), 504);
    }

    console.error(`[shortcuts] generation failed: ${code}`);
    if (code === 'ai_error') {
      return c.json(getErrorResponse('ai_error'), 502);
    }
    return c.json(getErrorResponse('server_error'), 500);
  }
});

export default shortcuts;
