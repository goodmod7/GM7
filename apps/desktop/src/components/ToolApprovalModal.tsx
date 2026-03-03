import { useState } from 'react';
import type { ToolCall } from '@ai-operator/shared';

interface ToolApprovalModalProps {
  toolCall: ToolCall;
  rationale: string;
  onApprove: () => void;
  onDeny: () => void;
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

export function ToolApprovalModal({ toolCall, rationale, onApprove, onDeny }: ToolApprovalModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const details = getToolDetails(toolCall);

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
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1001,
      }}
    >
      <div
        style={{
          backgroundColor: 'white',
          borderRadius: '12px',
          padding: '1.5rem',
          maxWidth: '520px',
          width: '90%',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
        }}
      >
        <div style={{ marginBottom: '1rem' }}>
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
          <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 600 }}>{details.title}</h2>
        </div>

        <div style={{ marginBottom: '1rem', fontSize: '0.9375rem', color: '#4b5563', lineHeight: 1.5 }}>
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
            backgroundColor: '#f9fafb',
            borderRadius: '6px',
            fontSize: '0.875rem',
            color: '#374151',
            lineHeight: 1.5,
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
            Approve Tool
          </button>
        </div>
      </div>
    </div>
  );
}
