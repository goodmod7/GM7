import { useEffect, useState } from 'react';
import type { ToolCall } from '@ai-operator/shared';
import type { ApprovalItem } from '../lib/approvals.js';

interface ToolApprovalModalProps {
  approval: ApprovalItem;
  toolCall: ToolCall;
  rationale: string;
  onApprove: () => void;
  onDeny: () => void;
  overlayMode?: boolean;
  onStopAll?: () => void;
}

function getToolDetails(toolCall: ToolCall): {
  title: string;
  target?: string;
  warning?: string;
} {
  switch (toolCall.tool) {
    case 'fs.list':
      return { title: 'List Workspace Directory', target: toolCall.path };
    case 'fs.read_text':
      return { title: 'Read Workspace File', target: toolCall.path };
    case 'fs.write_text':
      return {
        title: 'Write Workspace File',
        target: toolCall.path,
        warning: 'This will modify a file inside the configured workspace.',
      };
    case 'fs.apply_patch':
      return {
        title: 'Apply Patch',
        target: toolCall.path,
        warning: 'This will edit a file inside the configured workspace.',
      };
    case 'terminal.exec':
      return {
        title: 'Execute Terminal Command',
        target: toolCall.cmd,
        warning: 'Only the command name is shown here. Review carefully before approving.',
      };
    default:
      return { title: 'Tool Request' };
  }
}

export function ToolApprovalModal({
  approval,
  toolCall,
  rationale,
  onApprove,
  onDeny,
  overlayMode = false,
  onStopAll,
}: ToolApprovalModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [remainingMs, setRemainingMs] = useState(() => Math.max(0, approval.expiresAt - Date.now()));
  const details = getToolDetails(toolCall);
  const cardBackground = overlayMode
    ? 'linear-gradient(180deg, rgba(5,7,10,0.94) 0%, rgba(8,10,14,0.97) 100%)'
    : 'white';
  const textColor = overlayMode ? '#f8fafc' : '#111827';
  const secondaryTextColor = overlayMode ? '#cbd5e1' : '#4b5563';

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

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: overlayMode ? 'rgba(0, 0, 0, 0.72)' : 'rgba(0, 0, 0, 0.5)',
        backdropFilter: overlayMode ? 'blur(12px)' : undefined,
        WebkitBackdropFilter: overlayMode ? 'blur(12px)' : undefined,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1001,
      }}
    >
      <div
        style={{
          background: cardBackground,
          borderRadius: '12px',
          padding: '1.5rem',
          maxWidth: '520px',
          width: '90%',
          boxShadow: overlayMode ? '0 24px 80px rgba(0, 0, 0, 0.55)' : '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
          border: overlayMode ? '1px solid rgba(255,255,255,0.10)' : 'none',
          color: textColor,
        }}
      >
        <div style={{ marginBottom: '1rem' }}>
          {overlayMode && (
            <div
              style={{
                marginBottom: '0.75rem',
                fontSize: '0.76rem',
                letterSpacing: '0.22em',
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
              padding: '0.25rem 0.75rem',
              borderRadius: '9999px',
              fontSize: '0.75rem',
              fontWeight: 600,
              textTransform: 'uppercase',
              backgroundColor: '#dbeafe',
              color: '#1d4ed8',
              border: '1px solid #60a5fa',
              marginBottom: '0.75rem',
            }}
          >
            Tool Request
          </div>
          <div style={{ marginBottom: '0.5rem', fontSize: '0.75rem', color: '#1d4ed8' }}>
            {approval.risk.toUpperCase()} risk • expires in {Math.ceil(remainingMs / 1000)}s
          </div>
          <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 600 }}>{details.title}</h2>
        </div>

        <div style={{ marginBottom: '1rem', fontSize: '0.9375rem', color: secondaryTextColor, lineHeight: 1.5 }}>
          <div>
            <strong>Tool:</strong> {toolCall.tool}
          </div>
          {toolCall.tool.startsWith('fs.') && details.target && (
            <div style={{ marginTop: '0.375rem' }}>
              <strong>Relative path:</strong> {details.target}
            </div>
          )}
          {toolCall.tool === 'terminal.exec' && details.target && (
            <div style={{ marginTop: '0.375rem' }}>
              <strong>Command:</strong> {details.target}
            </div>
          )}
        </div>

        <div
          style={{
            marginBottom: '1rem',
            padding: '0.75rem',
            backgroundColor: overlayMode ? 'rgba(255,255,255,0.04)' : '#f9fafb',
            borderRadius: '6px',
            fontSize: '0.875rem',
            color: overlayMode ? '#e2e8f0' : '#374151',
            lineHeight: 1.5,
            border: overlayMode ? '1px solid rgba(255,255,255,0.06)' : undefined,
          }}
        >
          <strong>Rationale:</strong> {rationale}
        </div>

        {details.warning && (
          <div
            style={{
              marginBottom: '1rem',
              padding: '0.75rem',
              backgroundColor: '#fef3c7',
              borderRadius: '6px',
              fontSize: '0.875rem',
              color: '#92400e',
            }}
          >
            {details.warning}
          </div>
        )}

        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          {overlayMode && onStopAll && (
            <button
              onClick={onStopAll}
              disabled={isSubmitting}
              style={{
                flexBasis: '100%',
                padding: '0.75rem 1rem',
                background: 'transparent',
                color: '#fca5a5',
                border: '1px solid rgba(248,113,113,0.28)',
                borderRadius: '6px',
                fontSize: '0.875rem',
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
              padding: '0.75rem 1rem',
              backgroundColor: overlayMode ? 'rgba(255,255,255,0.03)' : 'white',
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
              background: overlayMode ? 'linear-gradient(180deg, rgba(16,185,129,0.92), rgba(5,150,105,0.94))' : '#10b981',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              fontSize: '0.9375rem',
              fontWeight: 500,
              cursor: isSubmitting ? 'not-allowed' : 'pointer',
              opacity: isSubmitting ? 0.7 : 1,
            }}
          >
            Approve Tool
          </button>
        </div>
      </div>
    </div>
  );
}
