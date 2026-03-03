import type { ToolSummary } from '@ai-operator/shared';

// In-memory tool summary store
// Stores only metadata about tool executions, not the actual content
const toolSummaries = new Map<string, ToolSummary>();

export const toolStore = {
  load(summaries: ToolSummary[]): void {
    toolSummaries.clear();
    for (const summary of summaries) {
      toolSummaries.set(summary.toolEventId, summary);
    }
  },

  // Get by toolEventId (primary key)
  get(toolEventId: string): ToolSummary | undefined {
    return toolSummaries.get(toolEventId);
  },

  // Get by toolCallId (secondary lookup)
  getByToolCallId(toolCallId: string): ToolSummary | undefined {
    for (const summary of toolSummaries.values()) {
      if (summary.toolCallId === toolCallId) {
        return summary;
      }
    }
    return undefined;
  },

  // Get by run - returns last 50, ordered newest first
  getByRun(runId: string, limit: number = 50): ToolSummary[] {
    return Array.from(toolSummaries.values())
      .filter((t) => t.runId === runId)
      .sort((a, b) => b.at - a.at) // Newest first
      .slice(0, limit);
  },

  // Get by device - returns last 50, ordered newest first
  getByDevice(deviceId: string, limit: number = 50): ToolSummary[] {
    return Array.from(toolSummaries.values())
      .filter((t) => t.deviceId === deviceId)
      .sort((a, b) => b.at - a.at) // Newest first
      .slice(0, limit);
  },

  add(summary: ToolSummary): ToolSummary {
    toolSummaries.set(summary.toolEventId, summary);
    return summary;
  },

  // Update an existing tool summary
  update(toolEventId: string, updates: Partial<ToolSummary>): ToolSummary | undefined {
    const existing = toolSummaries.get(toolEventId);
    if (existing) {
      Object.assign(existing, updates);
      return existing;
    }
    return undefined;
  },

  // Cleanup old tool summaries (call periodically)
  cleanupOldSummaries(maxAgeMs: number = 24 * 60 * 60 * 1000): number {
    const cutoff = Date.now() - maxAgeMs;
    let count = 0;

    for (const [id, summary] of toolSummaries) {
      if (summary.at < cutoff) {
        toolSummaries.delete(id);
        count++;
      }
    }

    return count;
  },
};

// Cleanup old summaries every hour
setInterval(() => {
  const cleaned = toolStore.cleanupOldSummaries();
  if (cleaned > 0) {
    console.log(`[ToolStore] Cleaned up ${cleaned} old tool summaries`);
  }
}, 60 * 60_000);
