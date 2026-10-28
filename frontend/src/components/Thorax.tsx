/** Silhouette thoracique stylisée (dessin original), façon cliché sur négatoscope. */
export function Thorax() {
  const cotes = Array.from({ length: 9 }, (_, i) => i);
  return (
    <svg className="thorax" viewBox="0 0 400 420" aria-hidden="true" fill="none" stroke="#7fa898" strokeLinecap="round">
      <defs>
        <radialGradient id="halo" cx="50%" cy="45%" r="55%">
          <stop offset="0%" stopColor="#2c4a3e" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#0e1714" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx="200" cy="200" rx="190" ry="210" fill="url(#halo)" stroke="none" />
      <path d="M200 30 V390" strokeWidth="9" stroke="#4f7364" strokeDasharray="14 5" />
      {cotes.map((i) => {
        const y = 92 + i * 30;
        const l = 70 + Math.sin((i / 8) * Math.PI) * 70;
        return (
          <g key={i} strokeWidth={3.2 - i * 0.12} opacity={0.9 - i * 0.05}>
            <path d={`M196 ${y} C ${196 - l * 0.6} ${y - 18}, ${196 - l * 1.25} ${y + 4}, ${196 - l * 1.3} ${y + 36}`} />
            <path d={`M204 ${y} C ${204 + l * 0.6} ${y - 18}, ${204 + l * 1.25} ${y + 4}, ${204 + l * 1.3} ${y + 36}`} />
          </g>
        );
      })}
      <path d="M120 70 C 150 55, 175 60, 196 72 M280 70 C 250 55, 225 60, 204 72" strokeWidth="5" stroke="#9cc3b3" />
      <path d="M150 330 C 175 300, 225 300, 250 330" strokeWidth="2" stroke="#577e6f" opacity="0.7" />
    </svg>
  );
}
