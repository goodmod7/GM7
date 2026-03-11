interface OverlayDetailsBlocker {
  id: string;
  label: string;
  detail: string;
}

interface OverlayDetailsApproval {
  id: string;
  summary: string;
  source: string;
  kind: string;
  expiresAt: number;
}

interface OverlayDetailsPanelProps {
  goal?: string | null;
  statusLabel: string;
  runStatus?: string | null;
  providerLabel: string;
  workspaceLabel: string;
  readinessBlockers: OverlayDetailsBlocker[];
  pendingApprovals: OverlayDetailsApproval[];
  onOpenSettings: () => void;
  onClose: () => void;
}

export function OverlayDetailsPanel({
  goal,
  statusLabel,
  runStatus,
  providerLabel,
  workspaceLabel,
  readinessBlockers,
  pendingApprovals,
  onOpenSettings,
  onClose,
}: OverlayDetailsPanelProps) {
  return (
    <aside
      style={{
        position: 'fixed',
        top: '1.5rem',
        right: '1.5rem',
        bottom: '12.5rem',
        zIndex: 135,
        width: 'min(420px, calc(100vw - 2rem))',
        borderRadius: '28px',
        background: 'linear-gradient(180deg, rgba(5,7,10,0.94) 0%, rgba(8,10,14,0.97) 100%)',
        border: '1px solid rgba(255,255,255,0.10)',
        boxShadow: '0 24px 80px rgba(0,0,0,0.55)',
        color: '#f8fafc',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        backdropFilter: 'blur(24px) saturate(130%)',
        WebkitBackdropFilter: 'blur(24px) saturate(130%)',
      }}
    >
      <div
        style={{
          padding: '1rem 1rem 0.9rem',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          background: 'linear-gradient(180deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.01) 100%)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.75rem' }}>
          <div>
            <div
              style={{
                fontSize: '0.76rem',
                letterSpacing: '0.18em',
                textTransform: 'uppercase',
                color: '#cbd5e1',
                marginBottom: '0.35rem',
              }}
            >
              Task details
            </div>
            <div style={{ fontSize: '0.95rem', fontWeight: 600, color: '#ffffff' }}>{statusLabel}</div>
          </div>
          <button
            onClick={onClose}
            style={{
              padding: '0.55rem 0.8rem',
              borderRadius: '999px',
              border: '1px solid rgba(255,255,255,0.12)',
              background: 'transparent',
              color: '#cbd5e1',
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            Hide details
          </button>
        </div>

        {goal ? (
          <p style={{ margin: '0.6rem 0 0', color: '#94a3b8', fontSize: '0.84rem', lineHeight: 1.5 }}>
            {goal}
          </p>
        ) : null}
      </div>

      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '0.95rem 1rem 1rem',
          display: 'grid',
          gap: '0.9rem',
        }}
      >
        <section
          style={{
            padding: '0.9rem',
            borderRadius: '18px',
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.06)',
            display: 'grid',
            gap: '0.45rem',
          }}
        >
          <div style={{ fontSize: '0.82rem', fontWeight: 600, color: '#e2e8f0' }}>Overview</div>
          <div style={{ fontSize: '0.8rem', color: '#cbd5e1' }}>
            <strong>Status:</strong> {runStatus || 'running'}
          </div>
          <div style={{ fontSize: '0.8rem', color: '#cbd5e1' }}>
            <strong>Provider:</strong> {providerLabel}
          </div>
          <div style={{ fontSize: '0.8rem', color: '#cbd5e1' }}>
            <strong>Workspace:</strong> {workspaceLabel}
          </div>
        </section>

        <section
          style={{
            padding: '0.9rem',
            borderRadius: '18px',
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.06)',
            display: 'grid',
            gap: '0.6rem',
          }}
        >
          <div style={{ fontSize: '0.82rem', fontWeight: 600, color: '#e2e8f0' }}>
            Approval queue
          </div>
          {pendingApprovals.length === 0 ? (
            <div style={{ fontSize: '0.8rem', color: '#94a3b8', lineHeight: 1.5 }}>
              No approvals are waiting right now.
            </div>
          ) : (
            pendingApprovals.slice(0, 3).map((item) => (
              <div
                key={item.id}
                style={{
                  padding: '0.75rem',
                  borderRadius: '14px',
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.05)',
                }}
              >
                <div style={{ fontSize: '0.82rem', fontWeight: 600, color: '#f8fafc' }}>{item.summary}</div>
                <div style={{ marginTop: '0.25rem', fontSize: '0.74rem', color: '#94a3b8' }}>
                  {item.source} • {item.kind} • expires {new Date(item.expiresAt).toLocaleTimeString()}
                </div>
              </div>
            ))
          )}
        </section>

        <section
          style={{
            padding: '0.9rem',
            borderRadius: '18px',
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.06)',
            display: 'grid',
            gap: '0.6rem',
          }}
        >
          <div style={{ fontSize: '0.82rem', fontWeight: 600, color: '#e2e8f0' }}>
            Readiness
          </div>
          {readinessBlockers.length === 0 ? (
            <div style={{ fontSize: '0.8rem', color: '#94a3b8', lineHeight: 1.5 }}>
              GORKH has what it needs for the current task.
            </div>
          ) : (
            readinessBlockers.slice(0, 3).map((blocker) => (
              <div
                key={blocker.id}
                style={{
                  padding: '0.75rem',
                  borderRadius: '14px',
                  background: 'rgba(245, 158, 11, 0.08)',
                  border: '1px solid rgba(245, 158, 11, 0.18)',
                }}
              >
                <div style={{ fontSize: '0.82rem', fontWeight: 600, color: '#fde68a' }}>{blocker.label}</div>
                <div style={{ marginTop: '0.25rem', fontSize: '0.76rem', color: '#fcd34d', lineHeight: 1.45 }}>
                  {blocker.detail}
                </div>
              </div>
            ))
          )}
        </section>
      </div>

      <div
        style={{
          padding: '0 1rem 1rem',
          display: 'flex',
          gap: '0.6rem',
          flexWrap: 'wrap',
        }}
      >
        <button
          onClick={onOpenSettings}
          style={{
            padding: '0.72rem 1rem',
            borderRadius: '999px',
            border: '1px solid rgba(255,255,255,0.12)',
            background: 'rgba(255,255,255,0.05)',
            color: '#f8fafc',
            cursor: 'pointer',
            fontWeight: 600,
          }}
        >
          Open full settings
        </button>
      </div>
    </aside>
  );
}
