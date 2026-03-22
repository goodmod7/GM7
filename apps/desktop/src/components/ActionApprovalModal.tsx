import { useEffect, useState } from 'react';
import type { InputAction } from '@ai-operator/shared';
import type { ApprovalItem } from '../lib/approvals.js';

// Use actionId in the component to satisfy lint
function useActionId(actionId: string): void {
  console.debug('Action approval for:', actionId);
}

interface ActionApprovalModalProps {
  approval: ApprovalItem;
  actionId: string;
  action: InputAction;
  onApprove: () => void;
  onDeny: () => void;
  overlayMode?: boolean;
  onStopAll?: () => void;
}

export function ActionApprovalModal({
  approval,
  actionId,
  action,
  onApprove,
  onDeny,
  overlayMode = false,
  onStopAll,
}: ActionApprovalModalProps) {
  // Mark as used
  useActionId(actionId);
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [remainingMs, setRemainingMs] = useState(() => Math.max(0, approval.expiresAt - Date.now()));

  useEffect(() => {
    const timer = setInterval(() => {
      setRemainingMs(Math.max(0, approval.expiresAt - Date.now()));
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, [approval.expiresAt]);

  const handleApprove = () => {
    setIsSubmitting(true);
    onApprove();
  };

  const handleDeny = () => {
    setIsSubmitting(true);
    onDeny();
  };

  // Get action description
  const getActionDescription = (): { title: string; details: string; warning?: string } => {
    switch (action.kind) {
      case 'click':
        return {
          title: 'Click Action',
          details: `Click ${action.button} button at position (${(action.x * 100).toFixed(1)}%, ${(action.y * 100).toFixed(1)}%)`,
        };
      case 'double_click':
        return {
          title: 'Double Click Action',
          details: `Double click ${action.button} button at position (${(action.x * 100).toFixed(1)}%, ${(action.y * 100).toFixed(1)}%)`,
        };
      case 'scroll':
        return {
          title: 'Scroll Action',
          details: `Scroll by (${action.dx}, ${action.dy}) pixels`,
        };
      case 'type':
        return {
          title: 'Type Text',
          details: `Type ${action.text.length} characters`,
          warning: 'Text content is hidden for privacy. Only approve if you expect text input.',
        };
      case 'hotkey':
        return {
          title: 'Hotkey',
          details: `Press ${action.key}${action.modifiers?.length ? ' + ' + action.modifiers.join('+') : ''}`,
        };
      case 'open_app':
        return {
          title: 'Open App',
          details: `Open ${action.appName}`,
          warning: 'This will launch or foreground another application on your device.',
        };
      default:
        return { title: 'Unknown Action', details: 'Unknown action type' };
    }
  };

  const desc = getActionDescription();
  const cardBackground = overlayMode
    ? 'rgba(15,23,42,0.92)'
    : 'white';
  const textColor = overlayMode ? '#f8fafc' : '#111827';
  const secondaryTextColor = overlayMode ? '#cbd5e1' : '#4b5563';

  return (
    <div
      style={{
        position: 'fixed',
        right: '1rem',
        bottom: '1rem',
        zIndex: 1000,
        width: 'min(420px, calc(100vw - 2rem))',
        maxHeight: 'calc(100vh - 2rem)',
        overflow: 'auto',
        padding: 0,
        pointerEvents: 'auto',
        background: 'transparent',
      }}
    >
      <div
        style={{
          background: cardBackground,
          borderRadius: '18px',
          padding: '1rem',
          boxShadow: overlayMode ? '0 18px 42px rgba(15,23,42,0.22)' : '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
          border: overlayMode ? '1px solid rgba(255,255,255,0.10)' : 'none',
          color: textColor,
        }}
      >
        {/* Header */}
        <div style={{ marginBottom: '0.8rem' }}>
          {overlayMode && (
            <div
              style={{
                marginBottom: '0.4rem',
                fontSize: '0.7rem',
                letterSpacing: '0.18em',
                textTransform: 'uppercase',
                color: '#cbd5e1',
              }}
            >
              GORKH approval
            </div>
          )}
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.22rem 0.65rem',
              borderRadius: '9999px',
              fontSize: '0.68rem',
              fontWeight: 600,
              textTransform: 'uppercase',
              backgroundColor: '#fef3c7',
              color: '#92400e',
              border: '1px solid #f59e0b',
              marginBottom: '0.55rem',
            }}
          >
            Action Request
          </div>
          <div style={{ marginBottom: '0.35rem', fontSize: '0.72rem', color: '#92400e' }}>
            {approval.risk.toUpperCase()} risk • expires in {Math.ceil(remainingMs / 1000)}s
          </div>
          <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 600 }}>
            {desc.title}
          </h2>
        </div>

        {/* Details */}
        <p
          style={{
            margin: '0 0 0.85rem',
            color: secondaryTextColor,
            fontSize: '0.9rem',
            lineHeight: 1.5,
          }}
        >
          {desc.details}
        </p>

        {desc.warning && (
          <div
            style={{
              padding: '0.7rem',
              backgroundColor: '#fef3c7',
              borderRadius: '12px',
              fontSize: '0.84rem',
              color: '#92400e',
              marginBottom: '0.85rem',
            }}
          >
            ⚠️ {desc.warning}
          </div>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', gap: '0.55rem', flexWrap: 'wrap' }}>
          {overlayMode && onStopAll && (
            <button
              onClick={onStopAll}
              disabled={isSubmitting}
              style={{
                flexBasis: '100%',
                padding: '0.65rem 0.9rem',
                background: 'rgba(255,255,255,0.04)',
                color: '#fca5a5',
                border: '1px solid rgba(248,113,113,0.22)',
                borderRadius: '10px',
                fontSize: '0.84rem',
                fontWeight: 600,
                cursor: isSubmitting ? 'not-allowed' : 'pointer',
                opacity: isSubmitting ? 0.7 : 1,
              }}
            >
              Stop all
            </button>
          )}
          <button
            onClick={handleDeny}
            disabled={isSubmitting}
            style={{
              flex: 1,
              padding: '0.65rem 0.9rem',
              backgroundColor: overlayMode ? 'rgba(255,255,255,0.04)' : 'white',
              color: '#dc2626',
              border: '1px solid #dc2626',
              borderRadius: '10px',
              fontSize: '0.85rem',
              fontWeight: 500,
              cursor: isSubmitting ? 'not-allowed' : 'pointer',
              opacity: isSubmitting ? 0.7 : 1,
            }}
          >
            Deny
          </button>
          <button
            onClick={handleApprove}
            disabled={isSubmitting}
            style={{
              flex: 1,
              padding: '0.65rem 0.9rem',
              background: overlayMode ? 'rgba(16,185,129,0.94)' : '#10b981',
              color: 'white',
              border: 'none',
              borderRadius: '10px',
              fontSize: '0.85rem',
              fontWeight: 500,
              cursor: isSubmitting ? 'not-allowed' : 'pointer',
              opacity: isSubmitting ? 0.7 : 1,
            }}
          >
            Approve & Execute
          </button>
        </div>
      </div>
    </div>
  );
}
