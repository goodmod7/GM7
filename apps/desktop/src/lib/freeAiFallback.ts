import type { DesktopApiRuntimeConfig } from './desktopRuntimeConfig.js';
import { parseDesktopError } from './tauriError.js';

export const HOSTED_FREE_AI_MODEL = 'gorkh-free-ai';

export interface HostedFreeAiBinding {
  provider: 'openai_compat';
  baseUrl: string;
  model: string;
  apiKeyOverride: string;
  supportsVisionOverride: true;
}

export function buildHostedFreeAiBaseUrl(runtimeConfig: DesktopApiRuntimeConfig): string {
  return `${runtimeConfig.httpBase}/desktop/free-ai/v1`;
}

export function resolveHostedFreeAiBinding(
  runtimeConfig: DesktopApiRuntimeConfig,
  deviceToken: string
): HostedFreeAiBinding {
  return {
    provider: 'openai_compat',
    baseUrl: buildHostedFreeAiBaseUrl(runtimeConfig),
    model: HOSTED_FREE_AI_MODEL,
    apiKeyOverride: deviceToken,
    supportsVisionOverride: true,
  };
}

export async function testHostedFreeAiFallback(
  runtimeConfig: DesktopApiRuntimeConfig,
  deviceToken: string
): Promise<void> {
  const response = await fetch(`${buildHostedFreeAiBaseUrl(runtimeConfig)}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${deviceToken}`,
    },
    body: JSON.stringify({
      model: HOSTED_FREE_AI_MODEL,
      messages: [
        {
          role: 'user',
          content: 'Reply with the single word OK.',
        },
      ],
    }),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      typeof body?.error === 'string'
        ? body.error
        : `Hosted Free AI fallback test failed (${response.status}).`
    );
  }

  const content = body?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || content.trim().length === 0) {
    throw new Error('Hosted Free AI fallback returned an empty response.');
  }
}

export function shouldRetryWithHostedFreeAiFallback(error: unknown): boolean {
  const parsed = parseDesktopError(error, 'The assistant could not respond right now.');
  const normalizedCode = parsed.code?.trim().toUpperCase() || '';
  const normalizedMessage = parsed.message.trim().toLowerCase();

  if (normalizedCode === 'LOCAL_AI_COMPATIBILITY_ERROR') {
    return true;
  }

  return (
    normalizedMessage.includes('ollama')
    || normalizedMessage.includes('local ai service')
    || normalizedMessage.includes('free ai reached a mac graphics compatibility problem')
    || normalizedMessage.includes('failed to connect to local llm server')
    || normalizedMessage.includes('failed to connect to local server')
    || normalizedMessage.includes('this task needs vision boost')
  );
}
