import { useState, useRef, useEffect } from 'react';
import type { ConnectionStatus } from '../lib/wsClient.js';
import { BrandWordmark } from './BrandWordmark.js';

interface ChatItem {
  id: string;
  role: 'user' | 'agent';
  text: string;
  timestamp: number;
}

interface PendingTaskConfirmation {
  goal: string;
  summary: string;
  prompt: string;
}

interface PendingFreeAiSetup {
  title: string;
  report: {
    summary: string;
    details: string;
    prompt: string;
  };
  retryLabel: string;
  cancelLabel: string;
  settingsLabel: string;
  stage: 'approval' | 'installing' | 'error';
  progressLabel: string | null;
  statusMessage: string | null;
  error: string | null;
}

interface ChatOverlayProps {
  messages: ChatItem[];
  status: ConnectionStatus;
  onSendMessage: (content: string) => void;
  busy?: boolean;
  pendingFreeAiSetup?: PendingFreeAiSetup | null;
  pendingFreeAiSetupBusy?: boolean;
  pendingTaskConfirmation?: PendingTaskConfirmation | null;
  pendingTaskConfirmationBusy?: boolean;
  onApprovePendingFreeAiSetup?: () => void;
  onRetryPendingFreeAiSetup?: () => void;
  onCancelPendingFreeAiSetup?: () => void;
  onOpenPendingFreeAiSetupSettings?: () => void;
  onConfirmPendingTask?: () => void;
  onCancelPendingTask?: () => void;
}

export function ChatOverlay({
  messages,
  status,
  onSendMessage,
  busy = false,
  pendingFreeAiSetup = null,
  pendingFreeAiSetupBusy = false,
  pendingTaskConfirmation = null,
  pendingTaskConfirmationBusy = false,
  onApprovePendingFreeAiSetup,
  onRetryPendingFreeAiSetup,
  onCancelPendingFreeAiSetup,
  onOpenPendingFreeAiSetupSettings,
  onConfirmPendingTask,
  onCancelPendingTask,
}: ChatOverlayProps) {
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, pendingFreeAiSetup, pendingTaskConfirmation]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || busy) return;
    onSendMessage(input);
    setInput('');
  };

  const statusLabels: Record<ConnectionStatus, string> = {
    connecting: 'Connecting...',
    connected: 'Connected',
    disconnected: 'Disconnected',
    error: 'Error',
  };

  const statusColors: Record<ConnectionStatus, string> = {
    connecting: '#f59e0b',
    connected: '#10b981',
    disconnected: '#6b7280',
    error: '#ef4444',
  };

  const canSend = status === 'connected' && !busy && input.trim();

  return (
    <div
      style={{
        width: '100%',
        minHeight: '520px',
        backgroundColor: 'white',
        borderRadius: '16px',
        boxShadow: '0 20px 45px rgba(15,23,42,0.08)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        border: '1px solid #dbe4f0',
      }}
    >
      <div
        style={{
          padding: '18px 20px',
          borderBottom: '1px solid #e5e7eb',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'linear-gradient(135deg, #eff6ff 0%, #f8fafc 100%)',
        }}
      >
        <div>
          <BrandWordmark width={132} />
          <div style={{ marginTop: '0.2rem', fontSize: '0.8125rem', color: '#475569' }}>
            Describe what you want done. GORKH will explain the plan, then wait for your confirmation before starting.
          </div>
        </div>
        <span
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: '12px',
            color: statusColors[status],
          }}
        >
          <span
            style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              backgroundColor: statusColors[status],
            }}
          />
          {statusLabels[status]}
        </span>
      </div>

      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '20px',
          display: 'flex',
          flexDirection: 'column',
          gap: '14px',
          background: '#fcfdff',
        }}
      >
        {messages.length === 0 ? (
          <div
            style={{
              marginTop: '24px',
              padding: '1.25rem',
              borderRadius: '14px',
              background: '#eff6ff',
              border: '1px solid #bfdbfe',
              color: '#1e3a8a',
            }}
          >
            <p style={{ margin: 0, fontWeight: 600 }}>Try asking something natural</p>
            <p style={{ margin: '0.5rem 0 0', fontSize: '0.875rem' }}>
              {status === 'connected'
                ? 'Examples: "Organize my Downloads", "Fix tests in this repo", or "Open Photoshop and remove the background". GORKH will tell you what it plans to do before it starts.'
                : 'The desktop needs to reconnect before the assistant can start working.'}
            </p>
          </div>
        ) : (
          messages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} />
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      <form
        onSubmit={handleSubmit}
        style={{
          padding: '16px 20px 20px',
          borderTop: '1px solid #e5e7eb',
          display: 'flex',
          flexWrap: 'wrap',
          gap: '8px',
          background: 'white',
        }}
      >
        {pendingFreeAiSetup && (
          <div
            style={{
              width: '100%',
              marginBottom: '0.9rem',
              padding: '0.95rem 1rem',
              borderRadius: '14px',
              background: pendingFreeAiSetup.stage === 'error' ? '#fff1f2' : '#eff6ff',
              border: `1px solid ${pendingFreeAiSetup.stage === 'error' ? '#fda4af' : '#93c5fd'}`,
              color: pendingFreeAiSetup.stage === 'error' ? '#9f1239' : '#1d4ed8',
            }}
          >
            <div style={{ fontWeight: 700, fontSize: '0.875rem' }}>{pendingFreeAiSetup.title}</div>
            <div style={{ marginTop: '0.45rem', fontSize: '0.875rem', lineHeight: 1.5 }}>
              {pendingFreeAiSetup.report.summary}
            </div>
            <div style={{ marginTop: '0.45rem', fontSize: '0.875rem', lineHeight: 1.5 }}>
              {pendingFreeAiSetup.report.details}
            </div>
            <div style={{ marginTop: '0.45rem', fontSize: '0.875rem', lineHeight: 1.5 }}>
              {pendingFreeAiSetup.report.prompt}
            </div>
            {(pendingFreeAiSetup.progressLabel || pendingFreeAiSetup.statusMessage) && (
              <div style={{ marginTop: '0.55rem', fontSize: '0.82rem', color: pendingFreeAiSetup.stage === 'error' ? '#be123c' : '#1e40af' }}>
                {pendingFreeAiSetup.progressLabel ? `${pendingFreeAiSetup.progressLabel}: ` : ''}
                {pendingFreeAiSetup.statusMessage}
              </div>
            )}
            {pendingFreeAiSetup.error && (
              <div style={{ marginTop: '0.45rem', fontSize: '0.82rem', color: '#be123c' }}>
                {pendingFreeAiSetup.error}
              </div>
            )}
            <div style={{ marginTop: '0.35rem', fontSize: '0.78rem', color: pendingFreeAiSetup.stage === 'error' ? '#be123c' : '#1d4ed8' }}>
              {pendingFreeAiSetup.stage === 'approval'
                ? 'GORKH will wait for your approval before installing anything on this desktop.'
                : pendingFreeAiSetup.stage === 'installing'
                  ? 'The original request is saved and will resume automatically as soon as Free AI is ready.'
                  : 'You can retry setup, cancel this saved task, or open Settings to choose another provider.'}
            </div>
            <div style={{ marginTop: '0.8rem', display: 'flex', gap: '0.65rem', flexWrap: 'wrap' }}>
              {pendingFreeAiSetup.stage !== 'installing' && (
                <button
                  type="button"
                  onClick={pendingFreeAiSetup.stage === 'error' ? onRetryPendingFreeAiSetup : onApprovePendingFreeAiSetup}
                  disabled={pendingFreeAiSetupBusy}
                  style={{
                    padding: '10px 14px',
                    borderRadius: '10px',
                    border: '1px solid #0f172a',
                    background: '#0f172a',
                    color: 'white',
                    cursor: pendingFreeAiSetupBusy ? 'not-allowed' : 'pointer',
                    opacity: pendingFreeAiSetupBusy ? 0.7 : 1,
                    fontWeight: 700,
                  }}
                >
                  {pendingFreeAiSetupBusy
                    ? 'Working...'
                    : pendingFreeAiSetup.stage === 'error'
                      ? pendingFreeAiSetup.retryLabel
                      : 'Proceed'}
                </button>
              )}
              <button
                type="button"
                onClick={onCancelPendingFreeAiSetup}
                style={{
                  padding: '10px 14px',
                  borderRadius: '10px',
                  border: '1px solid #bfdbfe',
                  background: 'white',
                  color: '#1d4ed8',
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
              >
                {pendingFreeAiSetup.cancelLabel}
              </button>
              <button
                type="button"
                onClick={onOpenPendingFreeAiSetupSettings}
                style={{
                  padding: '10px 14px',
                  borderRadius: '10px',
                  border: '1px solid #bfdbfe',
                  background: 'white',
                  color: '#1d4ed8',
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
              >
                {pendingFreeAiSetup.settingsLabel}
              </button>
            </div>
          </div>
        )}
        {pendingTaskConfirmation && (
          <div
            style={{
              width: '100%',
              marginBottom: '0.9rem',
              padding: '0.95rem 1rem',
              borderRadius: '14px',
              background: '#fff7ed',
              border: '1px solid #fdba74',
              color: '#9a3412',
            }}
          >
            <div style={{ fontWeight: 700, fontSize: '0.875rem' }}>Confirm task</div>
            <div style={{ marginTop: '0.45rem', fontSize: '0.875rem', lineHeight: 1.5 }}>
              {pendingTaskConfirmation.summary}
            </div>
            <div style={{ marginTop: '0.45rem', fontSize: '0.875rem', lineHeight: 1.5 }}>
              {pendingTaskConfirmation.prompt}
            </div>
            <div style={{ marginTop: '0.35rem', fontSize: '0.78rem', color: '#b45309' }}>
              GORKH will wait for your explicit confirmation before starting. You can also send a new message if I misunderstood.
            </div>
            <div style={{ marginTop: '0.8rem', display: 'flex', gap: '0.65rem', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={onCancelPendingTask}
                disabled={pendingTaskConfirmationBusy}
                style={{
                  padding: '10px 14px',
                  borderRadius: '10px',
                  border: '1px solid #fdba74',
                  background: 'white',
                  color: '#9a3412',
                  cursor: pendingTaskConfirmationBusy ? 'not-allowed' : 'pointer',
                  opacity: pendingTaskConfirmationBusy ? 0.7 : 1,
                  fontWeight: 600,
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onConfirmPendingTask}
                disabled={pendingTaskConfirmationBusy}
                style={{
                  padding: '10px 14px',
                  borderRadius: '10px',
                  border: '1px solid #0f172a',
                  background: '#0f172a',
                  color: 'white',
                  cursor: pendingTaskConfirmationBusy ? 'not-allowed' : 'pointer',
                  opacity: pendingTaskConfirmationBusy ? 0.7 : 1,
                  fontWeight: 700,
                }}
              >
                {pendingTaskConfirmationBusy ? 'Starting...' : 'Proceed'}
              </button>
            </div>
          </div>
        )}
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={
            status !== 'connected'
              ? 'Reconnect to send...'
              : busy
                ? 'GORKH is processing your last message...'
                : 'Ask the assistant to do something...'
          }
          disabled={status !== 'connected' || busy}
          style={{
            flex: 1,
            padding: '12px 14px',
            borderRadius: '10px',
            border: '1px solid #cbd5e1',
            fontSize: '14px',
            outline: 'none',
            backgroundColor: status === 'connected' ? 'white' : '#f5f5f5',
          }}
        />
        <button
          type="submit"
          disabled={!canSend}
          style={{
            padding: '12px 18px',
            backgroundColor: canSend ? '#0f172a' : '#cbd5e1',
            color: 'white',
            border: 'none',
            borderRadius: '10px',
            cursor: canSend ? 'pointer' : 'not-allowed',
            fontSize: '14px',
            fontWeight: 600,
          }}
        >
          Ask
        </button>
      </form>
    </div>
  );
}

function MessageBubble({ message }: { message: ChatItem }) {
  const isUser = message.role === 'user';
  return (
    <div
      style={{
        alignSelf: isUser ? 'flex-end' : 'flex-start',
        maxWidth: '85%',
        padding: '10px 14px',
        borderRadius: '12px',
        backgroundColor: isUser ? '#0070f3' : '#f0f0f0',
        color: isUser ? 'white' : '#333',
        fontSize: '14px',
        wordBreak: 'break-word',
      }}
    >
      {message.text}
    </div>
  );
}
