export type LlmProvider =
  | 'native_qwen_ollama'
  | 'openai'
  | 'claude'
  | 'deepseek'
  | 'minimax'
  | 'kimi'
  | 'openai_compat';

export type LlmRuntimeProvider = 'native_qwen_ollama' | 'openai' | 'claude' | 'openai_compat';

export interface LlmSettings {
  provider: LlmProvider;
  baseUrl: string;
  model: string;
}

export interface LlmProviderDefinition {
  provider: LlmProvider;
  label: string;
  shortLabel: string;
  baseUrl: string;
  model: string;
  runtimeProvider: LlmRuntimeProvider;
  requiresApiKey: boolean;
  paid: boolean;
  setupHint: string;
  billingHint?: string;
}

export const DEFAULT_LLM_PROVIDER: LlmProvider = 'native_qwen_ollama';

const PROVIDER_DEFINITIONS: Record<LlmProvider, LlmProviderDefinition> = {
  native_qwen_ollama: {
    provider: 'native_qwen_ollama',
    label: 'Local Qwen via Ollama',
    shortLabel: 'Local Qwen/Ollama',
    baseUrl: 'http://127.0.0.1:11434',
    model: 'qwen2.5:1.5b',
    runtimeProvider: 'native_qwen_ollama',
    requiresApiKey: false,
    paid: false,
    setupHint: 'Use Start Free AI in the desktop app to let the app prepare and run the managed local runtime. You can still point it at an existing Ollama service if you prefer.',
  },
  openai: {
    provider: 'openai',
    label: 'OpenAI',
    shortLabel: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4.1-mini',
    runtimeProvider: 'openai',
    requiresApiKey: true,
    paid: true,
    setupHint: 'Enter an OpenAI API key stored in the local OS keychain.',
    billingHint: 'Paid provider. Usage is billed by your OpenAI account.',
  },
  claude: {
    provider: 'claude',
    label: 'Claude',
    shortLabel: 'Claude',
    baseUrl: 'https://api.anthropic.com/v1',
    model: 'claude-3-5-sonnet-20241022',
    runtimeProvider: 'claude',
    requiresApiKey: true,
    paid: true,
    setupHint: 'Enter an Anthropic API key stored in the local OS keychain.',
    billingHint: 'Paid provider. Usage is billed by your Anthropic account.',
  },
  deepseek: {
    provider: 'deepseek',
    label: 'DeepSeek',
    shortLabel: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat',
    runtimeProvider: 'openai_compat',
    requiresApiKey: true,
    paid: true,
    setupHint: 'Uses DeepSeek’s OpenAI-compatible chat completions API.',
    billingHint: 'Paid provider. Usage is billed by your DeepSeek account.',
  },
  minimax: {
    provider: 'minimax',
    label: 'MiniMax',
    shortLabel: 'MiniMax',
    baseUrl: 'https://api.minimax.io',
    model: 'MiniMax-M2.5',
    runtimeProvider: 'openai_compat',
    requiresApiKey: true,
    paid: true,
    setupHint: 'Uses MiniMax’s OpenAI-compatible chat completions API.',
    billingHint: 'Paid provider. Usage is billed by your MiniMax account.',
  },
  kimi: {
    provider: 'kimi',
    label: 'Kimi',
    shortLabel: 'Kimi',
    baseUrl: 'https://api.moonshot.cn/v1',
    model: 'kimi-thinking-preview',
    runtimeProvider: 'openai_compat',
    requiresApiKey: true,
    paid: true,
    setupHint: 'Uses Moonshot/Kimi’s OpenAI-compatible chat completions API.',
    billingHint: 'Paid provider. Usage is billed by your Moonshot account.',
  },
  openai_compat: {
    provider: 'openai_compat',
    label: 'Local OpenAI-compatible',
    shortLabel: 'Local OpenAI-compatible',
    baseUrl: 'http://127.0.0.1:8000',
    model: 'qwen2.5-7b-instruct',
    runtimeProvider: 'openai_compat',
    requiresApiKey: false,
    paid: false,
    setupHint: 'Run a local OpenAI-compatible server such as vLLM or llama.cpp server.',
  },
};

const PROVIDER_ORDER: LlmProvider[] = [
  'native_qwen_ollama',
  'openai',
  'claude',
  'deepseek',
  'minimax',
  'kimi',
  'openai_compat',
];

export function isLlmProvider(value: string | undefined | null): value is LlmProvider {
  return value === 'native_qwen_ollama'
    || value === 'openai'
    || value === 'claude'
    || value === 'deepseek'
    || value === 'minimax'
    || value === 'kimi'
    || value === 'openai_compat';
}

export function normalizeLlmProvider(value: string | undefined | null): LlmProvider {
  return isLlmProvider(value) ? value : DEFAULT_LLM_PROVIDER;
}

export function getLlmDefaults(provider: LlmProvider): LlmSettings {
  const definition = PROVIDER_DEFINITIONS[provider];
  return {
    provider,
    baseUrl: definition.baseUrl,
    model: definition.model,
  };
}

export function mergeLlmSettings(input?: Partial<LlmSettings>): LlmSettings {
  const provider = normalizeLlmProvider(input?.provider);
  return {
    ...getLlmDefaults(provider),
    ...input,
    provider,
  };
}

export function providerRequiresApiKey(provider: LlmProvider): boolean {
  return PROVIDER_DEFINITIONS[provider].requiresApiKey;
}

export function isLocalLlmProvider(provider: LlmProvider): boolean {
  return !PROVIDER_DEFINITIONS[provider].paid;
}

export function getLlmProviderLabel(provider: LlmProvider): string {
  return PROVIDER_DEFINITIONS[provider].shortLabel;
}

export function isPaidLlmProvider(provider: LlmProvider): boolean {
  return PROVIDER_DEFINITIONS[provider].paid;
}

export function getLlmRuntimeProvider(provider: LlmProvider): LlmRuntimeProvider {
  return PROVIDER_DEFINITIONS[provider].runtimeProvider;
}

export function getLlmProviderDefinition(provider: LlmProvider): LlmProviderDefinition {
  return PROVIDER_DEFINITIONS[provider];
}

export function getSupportedLlmProviders(): LlmProviderDefinition[] {
  return PROVIDER_ORDER.map((provider) => PROVIDER_DEFINITIONS[provider]);
}
