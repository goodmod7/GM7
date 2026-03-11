import gorkhWordmark from '../assets/gorkh-wordmark.svg';

interface BrandWordmarkProps {
  width?: number;
  subtitle?: string;
  align?: 'left' | 'center';
}

export function BrandWordmark({
  width = 220,
  subtitle,
  align = 'left',
}: BrandWordmarkProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: align === 'center' ? 'center' : 'flex-start',
        gap: subtitle ? '0.6rem' : 0,
      }}
    >
      <img
        src={gorkhWordmark}
        alt="GORKH"
        style={{
          display: 'block',
          width: `${width}px`,
          maxWidth: '100%',
          height: 'auto',
          borderRadius: '14px',
          boxShadow: '0 18px 40px rgba(0, 0, 0, 0.28)',
        }}
      />
      {subtitle ? (
        <div
          style={{
            color: '#94a3b8',
            fontSize: '0.82rem',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
          }}
        >
          {subtitle}
        </div>
      ) : null}
    </div>
  );
}
