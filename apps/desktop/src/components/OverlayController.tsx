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
        width: 'min(320px, calc(100vw - 2rem))',
        borderRadius: '18px',
        background: 'rgba(15,23,42,0.68)',
        border: '1px solid rgba(148,163,184,0.22)',
        boxShadow: '0 16px 38px rgba(15,23,42,0.18)',
        color: '#f8fafc',
        overflow: 'hidden',
      }}
    >
        <div
          style={{
            padding: '0.8rem 0.85rem 0.65rem',
            borderBottom: '1px solid rgba(148,163,184,0.18)',
            background: 'rgba(15,23,42,0.34)',
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
                fontSize: '0.7rem',
                letterSpacing: '0.18em',
                textTransform: 'uppercase',
                color: '#cbd5e1',
                marginBottom: '0.25rem',
              }}
            >
              GORKH
            </div>
            <div style={{ fontWeight: 700, fontSize: '0.9rem', color: '#ffffff' }}>{statusLabel}</div>
          </div>
          <div
            style={{
              padding: '0.3rem 0.5rem',
              borderRadius: '999px',
              background: 'rgba(15,23,42,0.42)',
              border: '1px solid rgba(148,163,184,0.18)',
              color: '#dbe4ee',
              fontSize: '0.65rem',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
            }}
          >
            {providerLabel}
          </div>
        </div>

        {goal ? (
          <div style={{ marginTop: '0.45rem', color: '#94a3b8', fontSize: '0.78rem', lineHeight: 1.4 }}>
            {goal}
          </div>
        ) : null}
      </div>

      <div
        style={{
          padding: '0.7rem 0.85rem',
          display: 'grid',
          gap: '0.45rem',
          maxHeight: '150px',
          overflowY: 'auto',
        }}
      >
        {messagePreview.length === 0 ? (
            <div
              style={{
                padding: '0.65rem 0.75rem',
                borderRadius: '14px',
                background: 'rgba(15,23,42,0.42)',
                color: '#cbd5e1',
                fontSize: '0.8rem',
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
                marginLeft: message.role === 'user' ? '2rem' : 0,
                marginRight: message.role === 'agent' ? '2rem' : 0,
                padding: '0.62rem 0.75rem',
                borderRadius: '14px',
                background: message.role === 'user'
                  ? 'rgba(148,163,184,0.16)'
                  : 'rgba(15,23,42,0.42)',
                border: '1px solid rgba(148,163,184,0.16)',
                color: '#f8fafc',
                fontSize: '0.8rem',
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
          padding: '0 0.85rem 0.85rem',
          display: 'flex',
          flexWrap: 'wrap',
          gap: '0.45rem',
        }}
      >
        <button
          onClick={onStop}
          style={{
            padding: '0.6rem 0.85rem',
            borderRadius: '999px',
            border: '1px solid rgba(248,113,113,0.24)',
            background: 'rgba(153,27,27,0.9)',
            color: '#fff',
            cursor: 'pointer',
            fontWeight: 700,
            fontSize: '0.8rem',
          }}
        >
          Stop
        </button>
          <button
            onClick={onPauseToggle}
            style={{
              padding: '0.6rem 0.85rem',
              borderRadius: '999px',
              border: '1px solid rgba(148,163,184,0.18)',
              background: 'rgba(15,23,42,0.34)',
              color: '#f8fafc',
              cursor: 'pointer',
              fontWeight: 700,
            fontSize: '0.8rem',
          }}
        >
          {isPaused ? 'Resume' : 'Pause'}
        </button>
          <button
            onClick={onOpenDetails}
            style={{
              padding: '0.6rem 0.85rem',
              borderRadius: '999px',
              border: '1px solid rgba(148,163,184,0.16)',
              background: 'transparent',
              color: '#cbd5e1',
              cursor: 'pointer',
            fontWeight: 700,
            fontSize: '0.8rem',
          }}
        >
          {detailsOpen ? 'Hide details' : 'Show details'}
        </button>
      </div>
    </div>
  );
}
