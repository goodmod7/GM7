import { redactToolCallForLog, type ToolCall } from '@ai-operator/shared';

export function redactToolCallForLogs(toolCall: ToolCall): { tool: ToolCall['tool']; pathRel?: string; cmd?: string } {
  return redactToolCallForLog(toolCall);
}
