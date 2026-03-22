/**
 * GORKH static knowledge base.
 *
 * Plain-English descriptions of GORKH features, settings, states, and guidance
 * injected into the assistant's context so it can answer product questions
 * accurately without relying on generic model training data.
 *
 * Privacy: this module contains no user data — only static product knowledge.
 */

// ---------------------------------------------------------------------------
// Feature descriptions
// ---------------------------------------------------------------------------

export interface GorkhFeatureDoc {
  name: string;
  description: string;
  howToUse: string;
  requirements?: string;
}

export const GORKH_FEATURES: Record<string, GorkhFeatureDoc> = {
  freeAi: {
    name: 'Free AI (local engine)',
    description:
      'GORKH can run an AI model directly on your Mac — no internet, no cloud, no subscription required. ' +
      'The model runs entirely on your device and your conversations stay private.',
    howToUse:
      'Go to the Free AI section and click "Set Up Free AI". GORKH will download and install ' +
      'the local engine automatically. Setup takes a few minutes depending on your connection speed.',
    requirements:
      'Requires at least 8 GB of free disk space and 8 GB of RAM. A faster Mac with more RAM ' +
      'can run a stronger model.',
  },
  remoteControl: {
    name: 'Remote control',
    description:
      'Lets GORKH (or a connected web session) perform actions on your screen — clicking, typing, ' +
      'scrolling, and keyboard shortcuts. Every action requires your explicit approval before it happens.',
    howToUse:
      'Enable "Allow remote control" in Settings. Each proposed action will appear in an approval ' +
      'dialog — you approve or deny it before anything happens.',
    requirements:
      'Requires Accessibility permission on macOS (Settings > Privacy & Security > Accessibility).',
  },
  screenPreview: {
    name: 'Screen preview',
    description:
      'Shares a live view of your screen with the GORKH web dashboard. Frames are never stored to ' +
      'disk or the server — they exist only in memory for 60 seconds.',
    howToUse: 'Enable "Screen preview" in Settings. You can stop it at any time from the same toggle.',
    requirements:
      'Requires Screen Recording permission on macOS (Settings > Privacy & Security > Screen Recording).',
  },
  workspace: {
    name: 'Workspace',
    description:
      'A folder on your computer that GORKH can read and write files in, and run terminal commands ' +
      'inside. This lets the assistant help with code, documents, and projects without needing GUI clicks.',
    howToUse:
      'Configure your workspace folder in Settings > Workspace. The assistant can then list files, ' +
      'read/write text files, and run commands — each action requires your approval.',
    requirements: 'No extra permissions required. Only files inside the configured folder are accessible.',
  },
  approvals: {
    name: 'Local approvals',
    description:
      'Every action GORKH proposes — clicking, typing, reading files, running commands — is shown ' +
      'to you before it happens. You approve or deny each one. Nothing runs without your confirmation.',
    howToUse:
      'Approvals appear automatically when the assistant proposes an action. You have 60 seconds to ' +
      'decide. "Stop All" immediately cancels everything.',
    requirements: 'Always on — cannot be disabled.',
  },
  visionBoost: {
    name: 'Vision Boost',
    description:
      'Upgrades the local AI engine to understand screenshots. Lets the assistant see what is on ' +
      'your screen and make more accurate decisions about where to click.',
    howToUse:
      'Available after the standard tier is installed. Requires additional model download (~3-6 GB).',
    requirements:
      'Requires the standard tier to be installed first, plus enough RAM and disk space.',
  },
};

// ---------------------------------------------------------------------------
// Setting descriptions
// ---------------------------------------------------------------------------

export interface GorkhSettingDoc {
  label: string;
  description: string;
  howToChange: string;
  default: string;
}

export const GORKH_SETTINGS: Record<string, GorkhSettingDoc> = {
  allowControl: {
    label: 'Allow remote control',
    description:
      'When enabled, the assistant can propose clicking, typing, and keyboard shortcuts on your screen. ' +
      'Every proposed action still requires your approval in a pop-up dialog.',
    howToChange: 'Toggle "Allow remote control" in the Settings panel.',
    default: 'Off',
  },
  screenPreview: {
    label: 'Screen preview',
    description:
      'Streams a live view of your screen to the GORKH web dashboard. Frames are never saved — ' +
      'they are discarded automatically after 60 seconds.',
    howToChange: 'Toggle "Screen preview" in the Settings panel.',
    default: 'Off',
  },
  autostart: {
    label: 'Start at login',
    description: 'Launches GORKH automatically when you log in to your Mac.',
    howToChange: 'Toggle "Start at login" in the Settings panel.',
    default: 'Off',
  },
  aiProvider: {
    label: 'AI provider',
    description:
      'Chooses which AI model powers the assistant. "Free AI" uses the local engine (no internet ' +
      'required). Paid providers (OpenAI, Claude, etc.) use your own API key and may incur usage costs.',
    howToChange: 'Select a provider in Settings > AI Provider.',
    default: 'Free AI (local engine)',
  },
};

// ---------------------------------------------------------------------------
// State label explanations (plain-English versions of enum values)
// ---------------------------------------------------------------------------

export const GORKH_INSTALL_STAGE_EXPLANATIONS: Record<string, string> = {
  not_started: 'Free AI has not been set up on this device yet.',
  planned: 'GORKH is preparing to set up the local AI engine.',
  installing: 'GORKH is downloading and installing the local AI engine. This may take several minutes.',
  installed: 'The local AI engine is installed. Starting it up now…',
  starting: 'The local AI engine is starting. This usually takes under a minute.',
  ready: 'Free AI is running and ready to use.',
  error: 'Something went wrong with the local AI engine. Check the Free AI section for details.',
};

export const GORKH_TIER_EXPLANATIONS: Record<string, string> = {
  light:
    'Light — a smaller, faster model suitable for most everyday tasks. ' +
    'Recommended for Macs with 8–16 GB RAM.',
  standard:
    'Standard — a stronger model with better reasoning and code understanding. ' +
    'Recommended for Macs with 16 GB+ RAM.',
  vision:
    'Vision Boost — adds screenshot understanding to the standard model. ' +
    'Lets the assistant see what is on your screen.',
};

export const GORKH_PROVIDER_EXPLANATIONS: Record<string, string> = {
  native_qwen_ollama:
    'Free AI — runs a local model on your Mac. No internet required, no usage fees, fully private.',
  openai:
    'OpenAI — uses your OpenAI API key. Charges apply per use. The model runs in the cloud.',
  claude:
    'Anthropic Claude — uses your Claude API key. Charges apply per use. The model runs in the cloud.',
  deepseek:
    'DeepSeek — uses your DeepSeek API key. Charges apply per use. The model runs in the cloud.',
  minimax:
    'MiniMax — uses your MiniMax API key. Charges apply per use. The model runs in the cloud.',
  kimi:
    'Kimi — uses your Kimi API key. Charges apply per use. The model runs in the cloud.',
  openai_compat:
    'Custom local model — a self-hosted OpenAI-compatible endpoint. Advanced use.',
};

export const GORKH_GPU_CLASS_EXPLANATIONS: Record<string, string> = {
  discrete: 'Dedicated GPU detected — the local model can use GPU acceleration.',
  integrated: 'Integrated graphics only — the local model will run on CPU.',
  unknown: 'GPU not detected — the local model will run on CPU.',
};

// ---------------------------------------------------------------------------
// Permission guidance
// ---------------------------------------------------------------------------

export const GORKH_PERMISSION_GUIDANCE: Record<string, string> = {
  screenRecording:
    'GORKH needs Screen Recording permission to capture your screen for the preview and for the ' +
    'AI assistant to see what is on your screen. ' +
    'Go to System Settings > Privacy & Security > Screen Recording and enable GORKH.',
  accessibility:
    'GORKH needs Accessibility permission to send clicks, keystrokes, and hotkeys on your behalf. ' +
    'Go to System Settings > Privacy & Security > Accessibility and enable GORKH.',
};

// ---------------------------------------------------------------------------
// Onboarding / help strings
// ---------------------------------------------------------------------------

export const GORKH_ONBOARDING = {
  firstGreeting:
    "Hi — I'm GORKH, your desktop AI assistant. I can help you automate tasks on your computer, " +
    "answer questions about my own settings and features, or guide you through setup. How can I help you today?",

  freeAiNotReady:
    "I notice Free AI hasn't been set up yet on this device. " +
    "I can set it up for you right now — it only takes a few minutes and runs entirely on your Mac. " +
    "Would you like me to get started, or would you prefer to use a paid AI provider instead?",

  providerNotConfigured:
    "I don't have an AI provider configured yet. To get started, " +
    "you can set up Free AI (runs locally on your Mac, no fees) or enter an API key for a paid provider like OpenAI or Claude.",

  screenRecordingNeeded:
    "To see what's on your screen, I need Screen Recording permission. " +
    "You can grant it in System Settings > Privacy & Security > Screen Recording.",

  accessibilityNeeded:
    "To control your Mac, I need Accessibility permission. " +
    "You can grant it in System Settings > Privacy & Security > Accessibility.",
};

// ---------------------------------------------------------------------------
// Common Q&A used in grounded responses
// ---------------------------------------------------------------------------

export interface GorkhQA {
  question: string;
  answer: string;
}

export const GORKH_FAQ: GorkhQA[] = [
  {
    question: 'What can GORKH do?',
    answer:
      'GORKH can automate tasks on your computer (clicking, typing, keyboard shortcuts), ' +
      'read and write files in a workspace folder, run terminal commands, ' +
      'explain its own settings and features, and guide you through setup — ' +
      'all with your explicit approval for every action.',
  },
  {
    question: 'Is my data private?',
    answer:
      'Yes. With Free AI, everything runs on your device — nothing is sent to the cloud. ' +
      'Screen frames are never stored to disk or the server. ' +
      'Typed text is never logged. Workspace file contents are never transmitted without your approval.',
  },
  {
    question: 'What is Free AI?',
    answer:
      'Free AI is a local AI model that runs entirely on your Mac — no internet, no API key, no fees. ' +
      'GORKH manages the download and setup for you.',
  },
  {
    question: 'Why do I need to approve every action?',
    answer:
      'GORKH requires your approval for every action — clicking, typing, file edits, terminal commands — ' +
      'because you stay in control at all times. Nothing happens on your computer without your confirmation.',
  },
  {
    question: 'How do I set up Free AI?',
    answer:
      'Go to the Free AI section in the GORKH sidebar. GORKH will check your hardware and recommend ' +
      'a model tier. Click "Set Up Free AI" and GORKH handles the rest. ' +
      'Setup usually takes 5–15 minutes depending on your internet speed.',
  },
];
