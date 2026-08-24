/**
 * Shortcut plist construction.
 *
 * The AI never writes plist XML directly — it only picks actions from the
 * catalog below and fills in their parameters. This file turns that picked
 * list into the plist structure the iOS Shortcuts app actually imports, so a
 * malformed model response can never become a malformed file.
 */

export type PlistValue =
  | string
  | number
  | boolean
  | PlistValue[]
  | { [key: string]: PlistValue };

export interface ShortcutAction {
  id: string;
  params?: Record<string, string | number>;
}

type ParamSpec = {
  /** Key the model supplies, mapped to the WF* parameter it fills. */
  from: string;
  type: 'string' | 'number' | 'minutes' | 'unitInterval';
  to: string;
  required?: boolean;
};

interface CatalogEntry {
  /** What the action does, shown to the model so it can pick sensibly. */
  summary: string;
  params: ParamSpec[];
  /**
   * One line naming this step in Indonesian, for the rebuild instructions the
   * app shows. Signing needs a Mac, so an unsigned file cannot be imported —
   * the steps are what actually lets someone recreate the shortcut by hand.
   */
  describe: (params: Record<string, string | number>) => string;
}

const quote = (value: unknown) => `"${String(value)}"`;
const percent = (value: unknown) => `${Math.round(Math.min(1, Math.max(0, Number(value))) * 100)}%`;

/**
 * Only these actions can ever reach a generated file. Anything the model
 * invents is dropped rather than passed through — an unknown identifier makes
 * the whole shortcut fail to import on device, with no useful error.
 */
export const ACTION_CATALOG: Record<string, CatalogEntry> = {
  'is.workflow.actions.notification': {
    summary: 'Show a notification. body (required), title (optional).',
    params: [
      { from: 'body', type: 'string', to: 'WFNotificationActionBody', required: true },
      { from: 'title', type: 'string', to: 'WFNotificationActionTitle' },
    ],
    describe: (p) => `Tampilkan notifikasi ${quote(p.body)}${p.title ? ` dengan judul ${quote(p.title)}` : ''}`,
  },
  'is.workflow.actions.timer.start': {
    summary: 'Start a countdown timer. minutes (required, number).',
    params: [{ from: 'minutes', type: 'minutes', to: 'WFTimerDuration', required: true }],
    describe: (p) => `Mulai timer ${p.minutes} menit`,
  },
  'is.workflow.actions.delay': {
    summary: 'Wait before continuing. seconds (required, number).',
    params: [{ from: 'seconds', type: 'number', to: 'WFDelayTime', required: true }],
    describe: (p) => `Tunggu ${p.seconds} detik`,
  },
  'is.workflow.actions.gettext': {
    summary: 'Produce a fixed piece of text. text (required).',
    params: [{ from: 'text', type: 'string', to: 'WFTextActionText', required: true }],
    describe: (p) => `Siapkan teks ${quote(p.text)}`,
  },
  'is.workflow.actions.speaktext': {
    summary: 'Speak text aloud. text (required).',
    params: [{ from: 'text', type: 'string', to: 'WFText', required: true }],
    describe: (p) => `Bacakan teks ${quote(p.text)}`,
  },
  'is.workflow.actions.alert': {
    summary: 'Show an alert dialog. message (required), title (optional).',
    params: [
      { from: 'message', type: 'string', to: 'WFAlertActionMessage', required: true },
      { from: 'title', type: 'string', to: 'WFAlertActionTitle' },
    ],
    describe: (p) => `Tampilkan peringatan ${quote(p.message)}${p.title ? ` dengan judul ${quote(p.title)}` : ''}`,
  },
  'is.workflow.actions.url': {
    summary: 'Produce a URL value. url (required).',
    params: [{ from: 'url', type: 'string', to: 'WFURLActionURL', required: true }],
    describe: (p) => `Siapkan URL ${p.url}`,
  },
  'is.workflow.actions.openurl': {
    summary: 'Open a URL in Safari. url (required).',
    params: [{ from: 'url', type: 'string', to: 'WFInput', required: true }],
    describe: (p) => `Buka URL ${p.url}`,
  },
  'is.workflow.actions.openapp': {
    summary: 'Open an app. bundleId (required, e.g. com.apple.MobileSMS).',
    params: [{ from: 'bundleId', type: 'string', to: 'WFAppIdentifier', required: true }],
    describe: (p) => `Buka aplikasi ${p.bundleId}`,
  },
  'is.workflow.actions.addnewreminder': {
    summary: 'Create a reminder. title (required).',
    params: [{ from: 'title', type: 'string', to: 'WFCalendarItemTitle', required: true }],
    describe: (p) => `Buat pengingat ${quote(p.title)}`,
  },
  'is.workflow.actions.sendmessage': {
    summary: 'Send a message; iOS asks for the recipient. text (required).',
    params: [{ from: 'text', type: 'string', to: 'WFSendMessageContent', required: true }],
    describe: (p) => `Kirim pesan ${quote(p.text)} (iOS menanyakan penerimanya)`,
  },
  'is.workflow.actions.setvolume': {
    summary: 'Set output volume. level (required, 0-1).',
    params: [{ from: 'level', type: 'unitInterval', to: 'WFVolume', required: true }],
    describe: (p) => `Atur volume ke ${percent(p.level)}`,
  },
  'is.workflow.actions.setbrightness': {
    summary: 'Set screen brightness. level (required, 0-1).',
    params: [{ from: 'level', type: 'unitInterval', to: 'WFBrightness', required: true }],
    describe: (p) => `Atur kecerahan layar ke ${percent(p.level)}`,
  },
  'is.workflow.actions.weather.currentconditions': {
    summary: 'Get current weather. No parameters.',
    params: [],
    describe: () => 'Ambil kondisi cuaca saat ini',
  },
  'is.workflow.actions.getcurrentlocation': {
    summary: 'Get the current location. No parameters.',
    params: [],
    describe: () => 'Ambil lokasi saat ini',
  },
  'is.workflow.actions.getclipboard': {
    summary: 'Read the clipboard. No parameters.',
    params: [],
    describe: () => 'Ambil isi papan klip',
  },
  'is.workflow.actions.copy': {
    summary: 'Copy the previous result to the clipboard. No parameters.',
    params: [],
    describe: () => 'Salin hasil sebelumnya ke papan klip',
  },
  'is.workflow.actions.takephoto': {
    summary: 'Take a photo with the camera. No parameters.',
    params: [],
    describe: () => 'Ambil foto dengan kamera',
  },
  'is.workflow.actions.playmusic': {
    summary: 'Play music. No parameters.',
    params: [],
    describe: () => 'Putar musik',
  },
};

/** Catalog rendered for the model's system prompt. */
export function catalogPrompt(): string {
  return Object.entries(ACTION_CATALOG)
    .map(([id, entry]) => `- ${id}: ${entry.summary}`)
    .join('\n');
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function serialize(value: PlistValue, indent: string): string {
  if (typeof value === 'string') {
    return `${indent}<string>${escapeXml(value)}</string>`;
  }
  if (typeof value === 'boolean') {
    return `${indent}<${value}/>`;
  }
  if (typeof value === 'number') {
    return Number.isInteger(value)
      ? `${indent}<integer>${value}</integer>`
      : `${indent}<real>${value}</real>`;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return `${indent}<array/>`;
    const items = value.map((item) => serialize(item, `${indent}\t`)).join('\n');
    return `${indent}<array>\n${items}\n${indent}</array>`;
  }
  const keys = Object.keys(value);
  if (keys.length === 0) return `${indent}<dict/>`;
  const entries = keys
    .map(
      (key) =>
        `${indent}\t<key>${escapeXml(key)}</key>\n${serialize(value[key], `${indent}\t`)}`
    )
    .join('\n');
  return `${indent}<dict>\n${entries}\n${indent}</dict>`;
}

/** A model-picked action that survived catalog and parameter checks. */
export interface PreparedAction {
  id: string;
  /** Parameters as supplied, for describing the step to a person. */
  supplied: Record<string, string | number>;
  /** Parameters mapped to their WF* keys, for the plist. */
  parameters: Record<string, PlistValue>;
}

/**
 * Drop anything the catalog does not know and anything missing a required
 * parameter. The plist and the human-readable steps are both derived from this
 * one result, so they can never describe different shortcuts.
 */
export function prepareActions(actions: ShortcutAction[]): PreparedAction[] {
  const prepared: PreparedAction[] = [];

  for (const action of actions) {
    const entry = ACTION_CATALOG[action.id];
    if (!entry) continue;

    const supplied = action.params ?? {};
    const parameters: Record<string, PlistValue> = {};
    let missingRequired = false;

    for (const spec of entry.params) {
      const raw = supplied[spec.from];
      if (raw === undefined || raw === null || raw === '') {
        if (spec.required) missingRequired = true;
        continue;
      }

      if (spec.type === 'string') {
        parameters[spec.to] = String(raw);
        continue;
      }

      const numeric = typeof raw === 'number' ? raw : Number(raw);
      if (!Number.isFinite(numeric)) {
        if (spec.required) missingRequired = true;
        continue;
      }

      if (spec.type === 'minutes') {
        parameters[spec.to] = {
          Value: { Magnitude: numeric, Unit: 'min' },
          WFSerializationType: 'WFQuantityFieldValue',
        };
      } else if (spec.type === 'unitInterval') {
        parameters[spec.to] = Math.min(1, Math.max(0, numeric));
      } else {
        parameters[spec.to] = numeric;
      }
    }

    if (missingRequired) continue;

    prepared.push({ id: action.id, supplied, parameters });
  }

  return prepared;
}

/** Map prepared actions to the WFWorkflowActions entries the plist carries. */
export function buildActions(actions: ShortcutAction[]): PlistValue[] {
  return prepareActions(actions).map((action) => ({
    WFWorkflowActionIdentifier: action.id,
    WFWorkflowActionParameters: action.parameters,
  }));
}

/**
 * Name each step in Indonesian so someone can rebuild the shortcut by hand in
 * the Shortcuts app — the only route open while the file cannot be signed.
 */
export function describeActions(actions: PreparedAction[]): string[] {
  return actions.map((action) => ACTION_CATALOG[action.id].describe(action.supplied));
}

/** Wrap built actions in the root structure Shortcuts expects, as plist XML. */
export function buildShortcutPlist(actions: PlistValue[]): string {
  const root: PlistValue = {
    WFWorkflowActions: actions,
    WFWorkflowClientVersion: '1128.2',
    WFWorkflowMinimumClientVersion: 411,
    WFWorkflowMinimumClientVersionString: '411',
    WFWorkflowIcon: {
      WFWorkflowIconGlyphNumber: 59511,
      WFWorkflowIconStartColor: 4282601983,
    },
    WFWorkflowImportQuestions: [],
    WFWorkflowInputContentItemClasses: [
      'WFAppStoreAppContentItem',
      'WFArticleContentItem',
      'WFContactContentItem',
      'WFDateContentItem',
      'WFEmailAddressContentItem',
      'WFGenericFileContentItem',
      'WFImageContentItem',
      'WFiTunesProductContentItem',
      'WFLocationContentItem',
      'WFDCMapsLinkContentItem',
      'WFAVAssetContentItem',
      'WFPDFContentItem',
      'WFPhoneNumberContentItem',
      'WFRichTextContentItem',
      'WFSafariWebPageContentItem',
      'WFStringContentItem',
      'WFURLContentItem',
    ],
    WFWorkflowTypes: [],
  };

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    serialize(root, ''),
    '</plist>',
    '',
  ].join('\n');
}
