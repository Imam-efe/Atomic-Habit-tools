import {
  ACTION_CATALOG,
  buildShortcutPlist,
  catalogPrompt,
  describeActions,
  prepareActions,
  type ShortcutAction,
} from './shortcut-plist';

export interface GeneratedShortcut {
  /** Shortcut plist XML. */
  plist: string;
  /** The same actions written as steps a person can follow. */
  steps: string[];
}

/**
 * Only the AI binding is needed here. Typed structurally rather than against
 * the full backend Env so the module stays testable with a stub.
 */
export interface ShortcutAiEnv {
  AI: {
    run(model: string, options: Record<string, unknown>): Promise<unknown>;
  };
}

/** Same model the rest of the backend's AI features run on. */
const MODEL = '@cf/meta/llama-3.1-8b-instruct';

const AI_TIMEOUT_MS = 8000;

const SYSTEM_PROMPT = `You convert a plain-language request into iOS Shortcuts actions.

Reply with ONLY a JSON object, no prose and no markdown fences:
{"actions":[{"id":"<action id>","params":{...}}]}

Pick ids ONLY from this catalog:
${catalogPrompt()}

Rules:
- Use the fewest actions that satisfy the request, at most 6.
- Every required parameter must be present; numbers must be plain numbers.
- If the request is impossible, unsafe, or not something a Shortcut can do,
  reply with a single is.workflow.actions.notification action whose body
  explains briefly that it cannot be built.`;

/** Pull the JSON object out of a model reply that may carry fences or prose. */
function extractJson(text: string): unknown {
  const withoutFences = text.replace(/```(?:json)?/gi, '').trim();

  const start = withoutFences.indexOf('{');
  const end = withoutFences.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('invalid_plist');
  }

  try {
    return JSON.parse(withoutFences.slice(start, end + 1));
  } catch {
    throw new Error('invalid_plist');
  }
}

function parseActions(payload: unknown): ShortcutAction[] {
  if (typeof payload !== 'object' || payload === null) {
    throw new Error('invalid_plist');
  }

  const raw = (payload as { actions?: unknown }).actions;
  if (!Array.isArray(raw)) {
    throw new Error('invalid_plist');
  }

  const actions: ShortcutAction[] = [];
  for (const item of raw.slice(0, 6)) {
    if (typeof item !== 'object' || item === null) continue;
    const { id, params } = item as { id?: unknown; params?: unknown };
    if (typeof id !== 'string' || !(id in ACTION_CATALOG)) continue;

    actions.push({
      id,
      params:
        typeof params === 'object' && params !== null
          ? (params as Record<string, string | number>)
          : {},
    });
  }

  return actions;
}

/**
 * Ask the model for actions and assemble them into shortcut plist XML.
 *
 * Workers AI has no abort signal, so the timeout is a race — a hung call stops
 * blocking the request even though it keeps running in the background.
 *
 * @throws Error('ai_timeout' | 'invalid_plist' | 'ai_error')
 */
export async function generateShortcutPlist(
  env: ShortcutAiEnv,
  description: string
): Promise<GeneratedShortcut> {
  let response: unknown;

  try {
    response = await Promise.race([
      env.AI.run(MODEL, {
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: description },
        ],
        max_tokens: 600,
      }),
      new Promise((_resolve, reject) =>
        setTimeout(() => reject(new Error('ai_timeout')), AI_TIMEOUT_MS)
      ),
    ]);
  } catch (err) {
    const message = err instanceof Error ? err.message : '';
    if (message === 'ai_timeout') throw new Error('ai_timeout');
    throw new Error('ai_error');
  }

  const text = (response as { response?: string })?.response;
  if (typeof text !== 'string' || text.trim() === '') {
    throw new Error('invalid_plist');
  }

  const actions = prepareActions(parseActions(extractJson(text)));
  if (actions.length === 0) {
    // Every action the model named was unknown or missing a required
    // parameter, so there is nothing installable to hand back.
    throw new Error('invalid_plist');
  }

  return {
    plist: buildShortcutPlist(
      actions.map((action) => ({
        WFWorkflowActionIdentifier: action.id,
        WFWorkflowActionParameters: action.parameters,
      }))
    ),
    steps: describeActions(actions),
  };
}
