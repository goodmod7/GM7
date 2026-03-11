import { useState, useRef, useEffect } from 'react';
import type { ConnectionStatus } from '../lib/wsClient.js';
import { BrandWordmark } from './BrandWordmark.js';

interface ChatItem {
  id: string;
  role: 'user' | 'agent';
  text: string;
  timestamp: number;
}

interface ChatOverlayProps {
  messages: ChatItem[];
  status: ConnectionStatus;
  onSendMessage: (content: string) => void;
}

export function ChatOverlay({ messages, status, onSendMessage }: ChatOverlayProps) {
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
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

  const canSend = status === 'connected' && input.trim();

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
            Describe what you want done. The assistant will start working from chat.
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
                ? 'Examples: "Organize my Downloads", "Fix tests in this repo", or "Open Photoshop and remove the background".'
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
          gap: '8px',
          background: 'white',
        }}
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={status === 'connected' ? 'Ask the assistant to do something...' : 'Reconnect to send...'}
          disabled={status !== 'connected'}
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
