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
          'radial-gradient(circle at 20% 20%, rgba(255,255,255,0.08), transparent 28%), radial-gradient(circle at 82% 18%, rgba(148,163,184,0.10), transparent 24%), linear-gradient(180deg, rgba(0,0,0,0.28) 0%, rgba(0,0,0,0.62) 100%)',
        backdropFilter: 'blur(24px) saturate(120%)',
        WebkitBackdropFilter: 'blur(24px) saturate(120%)',
      }}
    >
      <div
        style={{
          width: 'min(500px, 92vw)',
          padding: '1.4rem 1.55rem',
          borderRadius: '28px',
          background: 'linear-gradient(180deg, rgba(10,12,16,0.34) 0%, rgba(3,5,8,0.46) 100%)',
          border: '1px solid rgba(255,255,255,0.08)',
          boxShadow: '0 24px 80px rgba(0,0,0,0.38)',
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
          The normal dashboard surface is dimmed while GORKH is actively executing.
        </p>
      </div>
    </div>
  );
}
