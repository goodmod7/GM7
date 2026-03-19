export function GorkhLogo({ compact = false }: { compact?: boolean }) {
  return (
    <div aria-label="GORKH" style={{ width: compact ? 132 : 240 }}>
      <svg viewBox="0 0 320 90" role="img" fill="none" xmlns="http://www.w3.org/2000/svg">
        <title>GORKH</title>
        <rect x="5" y="5" width="310" height="80" rx="18" fill="#030303" stroke="#1f1f22" strokeWidth="2" />
        <line x1="34" y1="24" x2="286" y2="24" stroke="#19191d" strokeWidth="1" />
        <line x1="34" y1="66" x2="286" y2="66" stroke="#19191d" strokeWidth="1" />
        <text
          x="160"
          y="61"
          fontFamily="ui-sans-serif, system-ui, sans-serif"
          fontSize="45"
          fontWeight="900"
          fill="#f4f4f5"
          textAnchor="middle"
          letterSpacing="0.26em"
        >
          GORKH
        </text>
        <rect x="34" y="26" width="252" height="18" fill="url(#glow-band)" opacity="0.18" />
        <defs>
          <linearGradient id="glow-band" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0" />
            <stop offset="50%" stopColor="#ffffff" stopOpacity="1" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </linearGradient>
        </defs>
      </svg>
    </div>
  );
}
