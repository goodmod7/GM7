import { useState } from 'react';
import type { ApprovalRequest } from '@ai-operator/shared';

interface ApprovalModalProps {
  approval: ApprovalRequest;
  onDecision: (decision: 'approved' | 'denied', comment?: string) => void;
  overlayMode?: boolean;
  onStopAll?: () => void;
}

export function ApprovalModal({ approval, onDecision, overlayMode = false, onStopAll }: ApprovalModalProps) {
  const [comment, setComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleDecision = (decision: 'approved' | 'denied') => {
    setIsSubmitting(true);
    onDecision(decision, comment.trim() || undefined);
  };

  const riskColors: Record<string, { bg: string; border: string; text: string }> = {
    low: { bg: '#f0fdf4', border: '#86efac', text: '#166534' },
    medium: { bg: '#fffbeb', border: '#fcd34d', text: '#92400e' },
    high: { bg: '#fef2f2', border: '#fca5a5', text: '#991b1b' },
  };

  const riskConfig = riskColors[approval.risk] || riskColors.medium;
  const cardBackground = overlayMode
    ? 'linear-gradient(180deg, rgba(5,7,10,0.94) 0%, rgba(8,10,14,0.97) 100%)'
    : 'white';
  const cardColor = overlayMode ? '#f8fafc' : '#111827';
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
          background: overlayMode
            ? 'rgba(15,23,42,0.92)'
            : cardBackground,
          borderRadius: '18px',
          padding: '1rem',
          boxShadow: overlayMode ? '0 18px 42px rgba(15,23,42,0.22)' : '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
          border: overlayMode ? '1px solid rgba(255,255,255,0.10)' : 'none',
          color: cardColor,
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
              backgroundColor: riskConfig.bg,
              color: riskConfig.text,
              border: `1px solid ${riskConfig.border}`,
              marginBottom: '0.55rem',
            }}
          >
            {approval.risk} Risk
          </div>
          <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 600 }}>
            {approval.title}
          </h2>
        </div>

        {/* Description */}
        <p
          style={{
            margin: '0 0 0.85rem',
            color: secondaryTextColor,
            fontSize: '0.9rem',
            lineHeight: 1.5,
          }}
        >
          {approval.description}
        </p>

        {/* Expiration warning */}
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
          <strong>⏱ Time Limit:</strong> This request expires at{' '}
          {new Date(approval.expiresAt).toLocaleTimeString()}
        </div>

        {/* Comment input */}
        <div style={{ marginBottom: '0.85rem' }}>
          <label
            style={{
              display: 'block',
              marginBottom: '0.25rem',
              fontSize: '0.82rem',
              fontWeight: 500,
              color: overlayMode ? '#e2e8f0' : '#374151',
            }}
          >
            Comment (optional)
          </label>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
              placeholder="Add a note about your decision..."
              disabled={isSubmitting}
              style={{
                width: '100%',
                padding: '0.5rem 0.75rem',
                borderRadius: '10px',
                border: overlayMode ? '1px solid rgba(255,255,255,0.12)' : '1px solid #d1d5db',
                fontSize: '0.84rem',
                fontFamily: 'inherit',
                resize: 'vertical',
                minHeight: '80px',
              background: overlayMode ? 'rgba(255,255,255,0.04)' : 'white',
              color: overlayMode ? '#f8fafc' : '#111827',
            }}
          />
        </div>

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
            onClick={() => handleDecision('denied')}
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
            onClick={() => handleDecision('approved')}
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
            Approve
          </button>
        </div>
      </div>
    </div>
  );
}
