export interface Env {
  ai: {
    run(model: string, options: { prompt: string }): Promise<{ response: string }>;
  };
}

const SHORTCUT_AI_PROMPT = (description: string) => `Generate an iOS Shortcut (plist XML format) that does: ${description}
Return ONLY valid plist XML, no explanation.
Use standard Shortcut actions available in iOS.
If the request is impossible or dangerous (e.g., hacking, malware), return an error plist that politely declines.`;

function isValidPlist(xml: string): boolean {
  if (!xml.includes('<?xml') || !xml.includes('</plist>')) {
    return false;
  }
  // Basic structure check: opening and closing tags
  try {
    // Try to parse with DOMParser if available (browser/Cloudflare Workers)
    if (typeof DOMParser !== 'undefined') {
      new DOMParser().parseFromString(xml, 'application/xml');
    }
    return true;
  } catch {
    return false;
  }
}

export async function generateShortcutPlist(env: Env, description: string): Promise<string> {
  let timeoutId: ReturnType<typeof setTimeout>;
  try {
    const controller = new AbortController();
    timeoutId = setTimeout(() => controller.abort(), 5000); // 5s timeout

    const response = await env.ai.run('@cf/meta/llama-2-7b-chat-int8', {
      prompt: SHORTCUT_AI_PROMPT(description),
    });

    clearTimeout(timeoutId);

    const plist = response.response.trim();

    if (!isValidPlist(plist)) {
      throw new Error('invalid_plist');
    }

    return plist;
  } catch (err) {
    if (timeoutId) clearTimeout(timeoutId);

    const message = err instanceof Error ? err.message : 'unknown';

    if (message === 'invalid_plist') {
      throw new Error('invalid_plist');
    }
    if (message.includes('abort') || message.includes('timeout')) {
      throw new Error('ai_timeout');
    }
    throw new Error('ai_error');
  }
}
