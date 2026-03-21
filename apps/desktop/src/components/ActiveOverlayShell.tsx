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
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2.5rem',
        pointerEvents: 'none',
        background:
          'radial-gradient(circle at 16% 18%, rgba(255,255,255,0.12), transparent 24%), radial-gradient(circle at 82% 16%, rgba(191,219,254,0.14), transparent 22%), linear-gradient(180deg, rgba(255,255,255,0.02) 0%, rgba(15,23,42,0.06) 100%)',
        backdropFilter: 'blur(18px) saturate(125%)',
        WebkitBackdropFilter: 'blur(18px) saturate(125%)',
      }}
    >
      <div
        style={{
          width: 'min(500px, 92vw)',
          padding: '1.4rem 1.55rem',
          borderRadius: '28px',
          background: 'linear-gradient(180deg, rgba(15,23,42,0.18) 0%, rgba(255,255,255,0.10) 100%)',
          border: '1px solid rgba(255,255,255,0.18)',
          boxShadow: '0 24px 60px rgba(15,23,42,0.16)',
          color: '#e5e7eb',
          textAlign: 'center',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <BrandWordmark width={180} subtitle={overlaySupported ? 'Overlay mode' : 'Focused active mode'} align="center" />
        </div>

        <div style={{ marginTop: '1.35rem' }}>
          <div style={{ fontSize: '1.2rem', fontWeight: 600, color: '#f8fafc' }}>{statusLabel}</div>
          {goal ? (
            <p style={{ margin: '0.75rem 0 0', color: '#cbd5e1', lineHeight: 1.6, fontSize: '0.96rem' }}>
              {goal}
            </p>
          ) : null}
        </div>

        <p style={{ margin: '1rem 0 0', color: '#94a3b8', fontSize: '0.82rem', lineHeight: 1.55 }}>
          This glass overlay stays lightweight so you can keep watching while GORKH works.
        </p>
      </div>
    </div>
  );
}
