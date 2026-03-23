import { invoke } from '@tauri-apps/api/core';

export interface AssistantConversationMessage {
  role: string;
  text: string;
}

export type AssistantConversationTurnResult =
  | {
      kind: 'reply';
      message: string;
    }
  | {
      kind: 'confirm_task';
      goal: string;
      summary: string;
      prompt: string;
    };

interface AssistantConversationTurnParams {
  provider: string;
  baseUrl: string;
  model: string;
  messages: AssistantConversationMessage[];
  appContext?: string | null;
  apiKeyOverride?: string | null;
}

export async function assistantConversationTurn(
  params: AssistantConversationTurnParams
): Promise<AssistantConversationTurnResult> {
  return invoke('assistant_conversation_turn', {
    params: {
      provider: params.provider,
      baseUrl: params.baseUrl,
      model: params.model,
      messages: params.messages,
      appContext: params.appContext ?? null,
      apiKeyOverride: params.apiKeyOverride ?? null,
    },
  }) as Promise<AssistantConversationTurnResult>;
}
