import { useState } from 'react';
import type { RunWithSteps, AgentProposal, InputAction, ToolCall } from '@ai-operator/shared';
import type { ApprovalItem } from '../lib/approvals.js';
import type { LocalToolEvent } from '../lib/aiAssist.js';

interface RunPanelProps {
  run: RunWithSteps | null;
  onCancel?: () => void;
  // Iteration 6: AI Assist props
  isAiAssist?: boolean;
  aiState?: 'idle' | 'capturing' | 'thinking' | 'awaiting_approval' | 'executing' | 'asking_user' | 'paused' | 'done' | 'error';
  currentProposal?: AgentProposal;
  currentApproval?: ApprovalItem | null;
  actionCount?: number;
  maxActions?: number;
  onApproveAction?: () => void;
  onRejectAction?: () => void;
  onUserResponse?: (response: string) => void;
  onStopAi?: () => void;
  // Iteration 8: Tool props
  toolHistory?: LocalToolEvent[];
  onApproveTool?: () => void;
  onRejectTool?: () => void;
  workspaceConfigured?: boolean;
}

export function RunPanel({
  run,
  onCancel,
  isAiAssist,
  aiState,
  currentProposal,
  currentApproval,
  actionCount,
  maxActions,
  onApproveAction,
  onRejectAction,
  onUserResponse,
  onStopAi,
  toolHistory,
  onApproveTool,
  onRejectTool,
  workspaceConfigured,
}: RunPanelProps) {
  const [userResponse, setUserResponse] = useState('');
  const [expandedToolId, setExpandedToolId] = useState<string | null>(null);

  if (!run) {
    return (
      <div style={{ padding: '1rem', background: '#f9fafb', borderRadius: '8px', color: '#666' }}>
        No active task yet. Ask the assistant to start working from chat.
      </div>
    );
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'done': return '#10b981';
      case 'failed': return '#ef4444';
      case 'canceled': return '#6b7280';
      case 'running': return '#3b82f6';
      case 'waiting_for_user': return '#8b5cf6';
      default: return '#f59e0b';
    }
  };

  const getAiStateLabel = (state?: string) => {
    switch (state) {
      case 'capturing': return '📸 Capturing screen...';
      case 'thinking': return '🤔 Analyzing...';
      case 'awaiting_approval': return '⏳ Waiting for your approval...';
      case 'executing': return '⚡ Executing...';
      case 'asking_user': return '❓ Asking for input...';
      case 'paused': return '⏸ Paused';
      case 'done': return '✅ Complete';
      case 'error': return '❌ Error';
      default: return '💤 Idle';
    }
  };

  const summarizeAction = (action: InputAction): string => {
    switch (action.kind) {
      case 'type':
        return `Type (${action.text.length} chars)`;
      case 'click':
        return `Click at (${(action.x * 100).toFixed(0)}%, ${(action.y * 100).toFixed(0)}%)`;
      case 'double_click':
        return `Double-click at (${(action.x * 100).toFixed(0)}%, ${(action.y * 100).toFixed(0)}%)`;
      case 'scroll':
        return `Scroll (${action.dx}, ${action.dy})`;
      case 'hotkey':
        return `Press ${action.key}${action.modifiers?.length ? ' + ' + action.modifiers.join(', ') : ''}`;
      default:
        return 'Unknown action';
    }
  };

  const summarizeToolCall = (toolCall: ToolCall): string => {
    switch (toolCall.tool) {
      case 'fs.list':
        return `List directory: ${toolCall.path}`;
      case 'fs.read_text':
        return `Read file: ${toolCall.path}`;
      case 'fs.write_text':
        return `Write file: ${toolCall.path} (${toolCall.content.length} chars)`;
      case 'fs.apply_patch':
        return `Apply patch to: ${toolCall.path}`;
      case 'terminal.exec':
        return `Execute: ${toolCall.cmd}`;
      default:
        return 'Unknown tool';
    }
  };

  const getToolStatusColor = (status: LocalToolEvent['status']) => {
    switch (status) {
      case 'executed': return '#10b981';
      case 'failed': return '#ef4444';
      case 'awaiting_user': return '#f59e0b';
      case 'approved': return '#3b82f6';
      case 'denied': return '#6b7280';
      default: return '#9ca3af';
    }
  };

  return (
    <div style={{ padding: '1.5rem', background: 'white', borderRadius: '8px', border: '1px solid #e0e0e0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '1.125rem' }}>Task progress</h2>
          <p style={{ margin: '0.25rem 0 0', color: '#666', fontSize: '0.875rem' }}>{run.goal}</p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <span
            style={{
              padding: '0.25rem 0.75rem',
              backgroundColor: `${getStatusColor(run.status)}20`,
              color: getStatusColor(run.status),
              borderRadius: '9999px',
              fontSize: '0.75rem',
              fontWeight: 500,
              textTransform: 'uppercase',
            }}
          >
            {run.status}
          </span>
          {run.mode === 'ai_assist' && (
            <span
              style={{
                padding: '0.25rem 0.75rem',
                backgroundColor: '#8b5cf620',
                color: '#8b5cf6',
                borderRadius: '9999px',
                fontSize: '0.75rem',
                fontWeight: 500,
              }}
            >
              Assistant
            </span>
          )}
        </div>
      </div>

      {/* AI Assist Status */}
      {isAiAssist && (
        <div
          style={{
            marginBottom: '1rem',
            padding: '0.75rem',
            background: '#f3f4f6',
            borderRadius: '6px',
            fontSize: '0.875rem',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>{getAiStateLabel(aiState)}</span>
            {maxActions && (
              <span style={{ color: '#666', fontSize: '0.75rem' }}>
                Actions: {actionCount || 0} / {maxActions}
              </span>
            )}
          </div>
          {onStopAi && run.status === 'running' && (
            <button
              onClick={onStopAi}
              style={{
                marginTop: '0.5rem',
                padding: '0.25rem 0.75rem',
                backgroundColor: '#ef4444',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                fontSize: '0.75rem',
                cursor: 'pointer',
              }}
            >
              Stop AI Assist
            </button>
          )}
        </div>
      )}

      {/* AI Proposal Card */}
      {isAiAssist && currentProposal && (
        <div
          style={{
            marginBottom: '1rem',
            padding: '1rem',
            background: '#fef3c7',
            border: '2px solid #f59e0b',
            borderRadius: '8px',
          }}
        >
          <h3 style={{ margin: '0 0 0.75rem', fontSize: '0.875rem', color: '#92400e' }}>
            🤖 AI Proposal
          </h3>

          {currentProposal.kind === 'propose_action' && (
            <>
              <div style={{ marginBottom: '0.75rem' }}>
                <strong style={{ color: '#78350f' }}>Action:</strong>
                <div style={{ marginTop: '0.25rem', padding: '0.5rem', background: 'white', borderRadius: '4px', fontSize: '0.875rem' }}>
                  {summarizeAction(currentProposal.action)}
                </div>
              </div>
              <div style={{ marginBottom: '0.75rem' }}>
                <strong style={{ color: '#78350f' }}>Rationale:</strong>
                <p style={{ margin: '0.25rem 0 0', fontSize: '0.875rem', color: '#78350f' }}>
                  {currentProposal.rationale}
                </p>
              </div>
              {currentProposal.confidence !== undefined && (
                <div style={{ marginBottom: '0.75rem', fontSize: '0.75rem', color: '#78350f' }}>
                  Confidence: {Math.round(currentProposal.confidence * 100)}%
                </div>
              )}
              {currentApproval && (
                <div style={{ marginBottom: '0.75rem', fontSize: '0.75rem', color: '#78350f' }}>
                  State: {currentApproval.state} • expires at {new Date(currentApproval.expiresAt).toLocaleTimeString()}
                </div>
              )}
              {aiState === 'awaiting_approval' && (
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    onClick={onApproveAction}
                    style={{
                      flex: 1,
                      padding: '0.5rem',
                      backgroundColor: '#10b981',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontSize: '0.875rem',
                      fontWeight: 500,
                    }}
                  >
                    ✓ Approve & Execute
                  </button>
                  <button
                    onClick={onRejectAction}
                    style={{
                      flex: 1,
                      padding: '0.5rem',
                      backgroundColor: '#ef4444',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontSize: '0.875rem',
                    }}
                  >
                    ✗ Reject
                  </button>
                </div>
              )}
            </>
          )}

          {currentProposal.kind === 'propose_tool' && (
            <>
              <div style={{ marginBottom: '0.75rem' }}>
                <strong style={{ color: '#78350f' }}>Tool:</strong>
                <div style={{ marginTop: '0.25rem', padding: '0.5rem', background: 'white', borderRadius: '4px', fontSize: '0.875rem' }}>
                  {summarizeToolCall(currentProposal.toolCall)}
                </div>
              </div>
              <div style={{ marginBottom: '0.75rem' }}>
                <strong style={{ color: '#78350f' }}>Rationale:</strong>
                <p style={{ margin: '0.25rem 0 0', fontSize: '0.875rem', color: '#78350f' }}>
                  {currentProposal.rationale}
                </p>
              </div>
              {!workspaceConfigured && (
                <div
                  style={{
                    marginBottom: '0.75rem',
                    padding: '0.75rem',
                    background: '#fff7ed',
                    borderRadius: '6px',
                    fontSize: '0.8125rem',
                    color: '#9a3412',
                  }}
                >
                  Workspace not configured. Choose a folder in Settings.
                </div>
              )}
              {currentProposal.confidence !== undefined && (
                <div style={{ marginBottom: '0.75rem', fontSize: '0.75rem', color: '#78350f' }}>
                  Confidence: {Math.round(currentProposal.confidence * 100)}%
                </div>
              )}
              {aiState === 'awaiting_approval' && (
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    onClick={onApproveTool}
                    disabled={!workspaceConfigured}
                    style={{
                      flex: 1,
                      padding: '0.5rem',
                      backgroundColor: workspaceConfigured ? '#10b981' : '#d1d5db',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: workspaceConfigured ? 'pointer' : 'not-allowed',
                      fontSize: '0.875rem',
                      fontWeight: 500,
                    }}
                  >
                    Approve Tool
                  </button>
                  <button
                    onClick={onRejectTool}
                    style={{
                      flex: 1,
                      padding: '0.5rem',
                      backgroundColor: '#ef4444',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontSize: '0.875rem',
                    }}
                  >
                    Reject
                  </button>
                </div>
              )}
            </>
          )}

          {currentProposal.kind === 'ask_user' && (
            <>
              <div style={{ marginBottom: '0.75rem' }}>
                <strong style={{ color: '#78350f' }}>Question:</strong>
                <p style={{ margin: '0.25rem 0 0', fontSize: '0.875rem', color: '#78350f' }}>
                  {currentProposal.question}
                </p>
              </div>
              {aiState === 'asking_user' && (
                <>
                  <input
                    type="text"
                    value={userResponse}
                    onChange={(e) => setUserResponse(e.target.value)}
                    placeholder="Type your response..."
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && userResponse.trim()) {
                        onUserResponse?.(userResponse);
                        setUserResponse('');
                      }
                    }}
                    style={{
                      width: '100%',
                      padding: '0.5rem',
                      marginBottom: '0.5rem',
                      borderRadius: '4px',
                      border: '1px solid #ddd',
                      fontSize: '0.875rem',
                    }}
                  />
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button
                      onClick={() => {
                        if (userResponse.trim()) {
                          onUserResponse?.(userResponse);
                          setUserResponse('');
                        }
                      }}
                      disabled={!userResponse.trim()}
                      style={{
                        flex: 1,
                        padding: '0.5rem',
                        backgroundColor: userResponse.trim() ? '#3b82f6' : '#ccc',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: userResponse.trim() ? 'pointer' : 'not-allowed',
                        fontSize: '0.875rem',
                      }}
                    >
                      Send Response
                    </button>
                    <button
                      onClick={() => onUserResponse?.('stop')}
                      style={{
                        padding: '0.5rem 1rem',
                        backgroundColor: '#6b7280',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        fontSize: '0.875rem',
                      }}
                    >
                      Stop
                    </button>
                  </div>
                </>
              )}
            </>
          )}

          {currentProposal.kind === 'done' && (
            <>
              <div style={{ marginBottom: '0.75rem' }}>
                <strong style={{ color: '#78350f' }}>✅ Task Complete</strong>
                <p style={{ margin: '0.25rem 0 0', fontSize: '0.875rem', color: '#78350f' }}>
                  {currentProposal.summary}
                </p>
              </div>
            </>
          )}

        </div>
      )}

      {/* Steps */}
      <div style={{ marginBottom: '1rem' }}>
        <h3 style={{ margin: '0 0 0.5rem', fontSize: '0.875rem', color: '#666' }}>Steps</h3>
        <div style={{ display: 'grid', gap: '0.5rem' }}>
          {run.steps.map((step) => (
            <div
              key={step.stepId}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                padding: '0.5rem',
                background: step.status === 'done' ? '#f0fdf4' : step.status === 'failed' ? '#fef2f2' : '#f9fafb',
                borderRadius: '4px',
                fontSize: '0.875rem',
              }}
            >
              <span
                style={{
                  width: '20px',
                  height: '20px',
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor:
                    step.status === 'done'
                      ? '#10b981'
                      : step.status === 'failed'
                      ? '#ef4444'
                      : step.status === 'running'
                      ? '#3b82f6'
                      : '#d1d5db',
                  color: 'white',
                  fontSize: '0.75rem',
                }}
              >
                {step.status === 'done' ? '✓' : step.status === 'failed' ? '✗' : step.status === 'running' ? '●' : '○'}
              </span>
              <span style={{ flex: 1 }}>{step.title}</span>
              <span style={{ fontSize: '0.75rem', color: '#666' }}>{step.status}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Logs */}
      {run.steps.some((s) => s.logs.length > 0) && (
        <div style={{ marginBottom: '1rem' }}>
          <h3 style={{ margin: '0 0 0.5rem', fontSize: '0.875rem', color: '#666' }}>Recent Logs</h3>
          <div
            style={{
              maxHeight: '150px',
              overflow: 'auto',
              background: '#1f2937',
              borderRadius: '4px',
              padding: '0.5rem',
              fontFamily: 'monospace',
              fontSize: '0.75rem',
            }}
          >
            {run.steps
              .flatMap((s) => s.logs.map((l) => ({ ...l, stepTitle: s.title })))
              .slice(-20)
              .map((log, i) => (
                <div
                  key={i}
                  style={{
                    color: log.level === 'error' ? '#ef4444' : log.level === 'warn' ? '#f59e0b' : '#d1d5db',
                    marginBottom: '0.25rem',
                  }}
                >
                  <span style={{ color: '#6b7280' }}>[{new Date(log.at).toLocaleTimeString()}]</span>{' '}
                  {log.line}
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Tool History (Iteration 8) */}
      {toolHistory && toolHistory.length > 0 && (
        <div style={{ marginBottom: '1rem' }}>
          <h3 style={{ margin: '0 0 0.5rem', fontSize: '0.875rem', color: '#666' }}>
            Tool History ({toolHistory.length})
          </h3>
          <div style={{ display: 'grid', gap: '0.5rem' }}>
            {toolHistory.slice(0, 20).map((tool) => (
              <div
                key={tool.toolEventId}
                style={{
                  padding: '0.5rem',
                  background: '#f9fafb',
                  borderRadius: '4px',
                  fontSize: '0.75rem',
                  borderLeft: `3px solid ${getToolStatusColor(tool.status)}`,
                }}
              >
                <button
                  type="button"
                  onClick={() =>
                    setExpandedToolId((current) => (current === tool.toolEventId ? null : tool.toolEventId))
                  }
                  style={{
                    width: '100%',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    background: 'transparent',
                    border: 'none',
                    padding: 0,
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                >
                  <span style={{ fontWeight: 500 }}>{tool.tool}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span
                      style={{
                        padding: '0.125rem 0.375rem',
                        backgroundColor: `${getToolStatusColor(tool.status)}20`,
                        color: getToolStatusColor(tool.status),
                        borderRadius: '4px',
                        fontSize: '0.625rem',
                        textTransform: 'uppercase',
                      }}
                    >
                      {tool.status}
                    </span>
                    <span style={{ color: '#9ca3af', fontSize: '0.75rem' }}>
                      {expandedToolId === tool.toolEventId ? 'Hide' : 'Details'}
                    </span>
                  </div>
                </button>
                {tool.pathRel && (
                  <div style={{ color: '#666', marginTop: '0.125rem' }}>📄 {tool.pathRel}</div>
                )}
                {tool.cmd && (
                  <div style={{ color: '#666', marginTop: '0.125rem' }}>⚡ {tool.cmd}</div>
                )}
                {tool.exitCode !== undefined && (
                  <div style={{ color: '#666', marginTop: '0.125rem' }}>Exit code: {tool.exitCode}</div>
                )}
                {tool.errorCode && (
                  <div style={{ color: '#ef4444', marginTop: '0.125rem' }}>Error: {tool.errorCode}</div>
                )}
                {expandedToolId === tool.toolEventId && tool.preview?.text && (
                  <pre
                    style={{
                      marginTop: '0.5rem',
                      padding: '0.5rem',
                      background: 'white',
                      borderRadius: '4px',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      fontSize: '0.75rem',
                      maxHeight: '180px',
                      overflow: 'auto',
                    }}
                  >
                    {tool.preview.text}
                  </pre>
                )}
                {expandedToolId === tool.toolEventId && (tool.preview?.stdout || tool.preview?.stderr) && (
                  <div
                    style={{
                      marginTop: '0.5rem',
                      padding: '0.5rem',
                      background: '#111827',
                      borderRadius: '4px',
                      fontFamily: 'monospace',
                      color: '#e5e7eb',
                      maxHeight: '180px',
                      overflow: 'auto',
                    }}
                  >
                    {tool.preview.stdout && (
                      <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                        {tool.preview.stdout}
                      </pre>
                    )}
                    {tool.preview.stderr && (
                      <pre
                        style={{
                          margin: tool.preview.stdout ? '0.5rem 0 0' : 0,
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                          color: '#fca5a5',
                        }}
                      >
                        {tool.preview.stderr}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Cancel button */}
      {(run.status === 'queued' || run.status === 'running' || run.status === 'waiting_for_user') && onCancel && (
        <button
          onClick={onCancel}
          style={{
            width: '100%',
            padding: '0.75rem',
            backgroundColor: '#fee2e2',
            color: '#dc2626',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '0.875rem',
          }}
        >
          Cancel Run
        </button>
      )}
    </div>
  );
}
