/**
 * ai.ts — shared Cloudflare Workers AI helpers.
 *
 * Everything AI in this backend runs on the [ai] binding in wrangler.toml:
 * no API key, no second vendor, 10,000 free neurons/day on the platform the
 * rest of the Worker already runs on.
 *
 * Two models, picked per job:
 *   TEXT_MODEL   — cheap prose. Free-form Indonesian paragraphs.
 *   SCHEMA_MODEL — structured extraction and vision. Understands images and
 *                  honours `guided_json`, so parsing can't drift.
 */

import type { Env } from '../types';

export const TEXT_MODEL = '@cf/meta/llama-3.1-8b-instruct';
export const SCHEMA_MODEL = '@cf/meta/llama-4-scout-17b-16e-instruct';

/** One OpenAI-style content part. Text-only messages may pass a bare string. */
export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export interface AiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ContentPart[];
}

/**
 * The workers-types version pinned here predates Llama 4, so its `Ai.run`
 * overloads reject both the model name and `guided_json`. The cast is confined
 * to these two helpers rather than sprinkled across every route.
 */
type LooseAi = { run(model: string, input: Record<string, unknown>): Promise<unknown> };

/** Plain text completion. Returns the trimmed response, or '' if the model said nothing. */
export async function runText(
  env: Env,
  messages: AiMessage[],
  opts: { model?: string; maxTokens?: number } = {}
): Promise<string> {
  if (!env.AI) throw new Error('AI binding not available');

  const res = (await (env.AI as unknown as LooseAi).run(opts.model ?? TEXT_MODEL, {
    messages,
    max_tokens: opts.maxTokens ?? 300,
  })) as { response?: string };

  return res.response?.trim() ?? '';
}

/**
 * Structured completion constrained by a JSON schema.
 *
 * `guided_json` makes the model emit schema-valid JSON rather than prose with
 * JSON somewhere inside it, but a model can still return an empty body or a
 * fenced string, so the result is parsed defensively and `null` on any failure.
 * Callers treat `null` as "AI could not help this time" and fall back to
 * whatever manual path already existed.
 */
export async function runJson<T>(
  env: Env,
  messages: AiMessage[],
  schema: Record<string, unknown>,
  opts: { model?: string; maxTokens?: number } = {}
): Promise<T | null> {
  const res = (await (env.AI as unknown as LooseAi).run(opts.model ?? SCHEMA_MODEL, {
    messages,
    guided_json: schema,
    max_tokens: opts.maxTokens ?? 600,
  })) as { response?: string | Record<string, unknown> };

  const raw = res.response;
  if (!raw) return null;

  // guided_json usually yields an object already; some model/runtime pairs
  // still hand back the serialised form.
  if (typeof raw === 'object') return raw as T;

  return parseJsonLoose<T>(raw);
}

/** Pull an object out of a string that may be fenced or padded with prose. */
export function parseJsonLoose<T>(text: string): T | null {
  const trimmed = text.trim();

  const direct = tryParse<T>(trimmed);
  if (direct !== null) return direct;

  // ```json ... ``` fences, or a lone object embedded in a sentence.
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    const inner = tryParse<T>(fenced[1].trim());
    if (inner !== null) return inner;
  }

  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start !== -1 && end > start) {
    return tryParse<T>(trimmed.slice(start, end + 1));
  }

  return null;
}

function tryParse<T>(s: string): T | null {
  try {
    const parsed = JSON.parse(s);
    return parsed && typeof parsed === 'object' ? (parsed as T) : null;
  } catch {
    return null;
  }
}
