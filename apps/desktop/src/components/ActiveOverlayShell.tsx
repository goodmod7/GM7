import { BrandWordmark } from './BrandWordmark.js';

interface ActiveOverlayShellProps {
  statusLabel: string;
  goal?: string | null;
  overlaySupported: boolean;
}

export function ActiveOverlayShell({
  statusLabel,
  goal,
  overlaySupported,
}: ActiveOverlayShellProps) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 120,
        pointerEvents: 'none',
        background: 'transparent',
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: '1.25rem',
          top: '1rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.85rem',
          padding: '0.6rem 0.85rem',
          borderRadius: '999px',
          background: 'rgba(15,23,42,0.26)',
          border: '1px solid rgba(148,163,184,0.22)',
          color: '#f8fafc',
          boxShadow: '0 10px 30px rgba(15,23,42,0.12)',
        }}
      >
        <BrandWordmark width={120} subtitle={overlaySupported ? 'GORKH overlay mode' : 'GORKH focused active mode'} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#f8fafc' }}>{statusLabel}</div>
          {goal ? (
            <div style={{ marginTop: '0.2rem', color: '#cbd5e1', lineHeight: 1.35, fontSize: '0.8rem', maxWidth: '28rem' }}>
              {goal}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
