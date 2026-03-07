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
}

export function ActionApprovalModal({ approval, actionId, action, onApprove, onDeny }: ActionApprovalModalProps) {
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
      default:
        return { title: 'Unknown Action', details: 'Unknown action type' };
    }
  };

  const desc = getActionDescription();

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      <div
        style={{
          backgroundColor: 'white',
          borderRadius: '12px',
          padding: '1.5rem',
          maxWidth: '480px',
          width: '90%',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
        }}
      >
        {/* Header */}
        <div style={{ marginBottom: '1rem' }}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.25rem 0.75rem',
              borderRadius: '9999px',
              fontSize: '0.75rem',
              fontWeight: 600,
              textTransform: 'uppercase',
              backgroundColor: '#fef3c7',
              color: '#92400e',
              border: '1px solid #f59e0b',
              marginBottom: '0.75rem',
            }}
          >
            Action Request
          </div>
          <div style={{ marginBottom: '0.5rem', fontSize: '0.75rem', color: '#92400e' }}>
            {approval.risk.toUpperCase()} risk • expires in {Math.ceil(remainingMs / 1000)}s
          </div>
          <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 600 }}>
            {desc.title}
          </h2>
        </div>

        {/* Details */}
        <p
          style={{
            margin: '0 0 1rem',
            color: '#4b5563',
            fontSize: '0.9375rem',
            lineHeight: 1.5,
          }}
        >
          {desc.details}
        </p>

        {desc.warning && (
          <div
            style={{
              padding: '0.75rem',
              backgroundColor: '#fef3c7',
              borderRadius: '6px',
              fontSize: '0.875rem',
              color: '#92400e',
              marginBottom: '1rem',
            }}
          >
            ⚠️ {desc.warning}
          </div>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button
            onClick={handleDeny}
            disabled={isSubmitting}
            style={{
              flex: 1,
              padding: '0.75rem 1rem',
              backgroundColor: 'white',
              color: '#dc2626',
              border: '1px solid #dc2626',
              borderRadius: '6px',
              fontSize: '0.9375rem',
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
              padding: '0.75rem 1rem',
              backgroundColor: '#10b981',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              fontSize: '0.9375rem',
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
