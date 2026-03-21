interface OverlayControllerMessage {
  id: string;
  role: 'user' | 'agent';
  text: string;
}

interface OverlayControllerProps {
  messages: OverlayControllerMessage[];
  statusLabel: string;
  goal?: string | null;
  providerLabel: string;
  isPaused: boolean;
  detailsOpen: boolean;
  onStop: () => void;
  onPauseToggle: () => void;
  onOpenDetails: () => void;
}

export function OverlayController({
  messages,
  statusLabel,
  goal,
  providerLabel,
  isPaused,
  detailsOpen,
  onStop,
  onPauseToggle,
  onOpenDetails,
}: OverlayControllerProps) {
  const messagePreview = messages.slice(-3);

  return (
    <div
      style={{
        position: 'fixed',
        right: '1.5rem',
        bottom: '1.5rem',
        zIndex: 140,
        width: 'min(390px, calc(100vw - 2rem))',
        borderRadius: '24px',
        background: 'linear-gradient(180deg, rgba(255,255,255,0.18) 0%, rgba(15,23,42,0.16) 100%)',
        border: '1px solid rgba(255,255,255,0.22)',
        boxShadow: '0 24px 60px rgba(15,23,42,0.18)',
        color: '#f8fafc',
        overflow: 'hidden',
        backdropFilter: 'blur(22px) saturate(130%)',
        WebkitBackdropFilter: 'blur(22px) saturate(130%)',
      }}
    >
      <div
        style={{
          padding: '0.95rem 1rem 0.8rem',
          borderBottom: '1px solid rgba(255,255,255,0.14)',
          background: 'linear-gradient(180deg, rgba(255,255,255,0.14) 0%, rgba(255,255,255,0.04) 100%)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.75rem',
          }}
        >
          <div>
            <div
              style={{
                fontSize: '0.76rem',
                letterSpacing: '0.22em',
                textTransform: 'uppercase',
                color: '#cbd5e1',
                marginBottom: '0.35rem',
              }}
            >
              GORKH
            </div>
            <div style={{ fontWeight: 600, fontSize: '0.95rem', color: '#ffffff' }}>{statusLabel}</div>
          </div>
          <div
            style={{
              padding: '0.35rem 0.6rem',
              borderRadius: '999px',
              background: 'rgba(255,255,255,0.10)',
              border: '1px solid rgba(255,255,255,0.12)',
              color: '#dbe4ee',
              fontSize: '0.69rem',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
            }}
          >
            {providerLabel}
          </div>
        </div>

        {goal ? (
          <div style={{ marginTop: '0.6rem', color: '#94a3b8', fontSize: '0.82rem', lineHeight: 1.45 }}>
            {goal}
          </div>
        ) : null}
      </div>

      <div
        style={{
          padding: '0.85rem 1rem',
          display: 'grid',
          gap: '0.55rem',
          maxHeight: '180px',
          overflowY: 'auto',
        }}
      >
        {messagePreview.length === 0 ? (
          <div
            style={{
              padding: '0.75rem 0.8rem',
              borderRadius: '16px',
              background: 'rgba(255,255,255,0.08)',
              color: '#cbd5e1',
              fontSize: '0.84rem',
            }}
          >
            Short chat will appear here while GORKH works.
          </div>
        ) : (
          messagePreview.map((message) => (
            <div
              key={message.id}
              style={{
                alignSelf: message.role === 'user' ? 'end' : 'start',
                marginLeft: message.role === 'user' ? '3rem' : 0,
                marginRight: message.role === 'agent' ? '3rem' : 0,
                padding: '0.7rem 0.8rem',
                borderRadius: '16px',
                background: message.role === 'user'
                  ? 'linear-gradient(180deg, rgba(148,163,184,0.24) 0%, rgba(148,163,184,0.14) 100%)'
                  : 'linear-gradient(180deg, rgba(255,255,255,0.14) 0%, rgba(255,255,255,0.06) 100%)',
                border: '1px solid rgba(255,255,255,0.10)',
                color: '#f8fafc',
                fontSize: '0.84rem',
                lineHeight: 1.45,
              }}
            >
              {message.text}
            </div>
          ))
        )}
      </div>

      <div
        style={{
          padding: '0 1rem 1rem',
          display: 'flex',
          flexWrap: 'wrap',
          gap: '0.6rem',
        }}
      >
        <button
          onClick={onStop}
          style={{
            padding: '0.72rem 1rem',
            borderRadius: '999px',
            border: '1px solid rgba(248,113,113,0.32)',
            background: 'linear-gradient(180deg, rgba(153,27,27,0.92), rgba(127,29,29,0.94))',
            color: '#fff',
            cursor: 'pointer',
            fontWeight: 600,
          }}
        >
          Stop
        </button>
        <button
          onClick={onPauseToggle}
          style={{
            padding: '0.72rem 1rem',
            borderRadius: '999px',
            border: '1px solid rgba(255,255,255,0.12)',
            background: 'rgba(255,255,255,0.10)',
            color: '#f8fafc',
            cursor: 'pointer',
            fontWeight: 600,
          }}
        >
          {isPaused ? 'Resume' : 'Pause'}
        </button>
        <button
          onClick={onOpenDetails}
          style={{
            padding: '0.72rem 1rem',
            borderRadius: '999px',
            border: '1px solid rgba(255,255,255,0.12)',
            background: 'transparent',
            color: '#cbd5e1',
            cursor: 'pointer',
            fontWeight: 600,
          }}
        >
          {detailsOpen ? 'Hide details' : 'Show details'}
        </button>
      </div>
    </div>
  );
}
