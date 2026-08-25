/**
 * The brand mark: a waveform that resolves into a tick — a meeting becoming a thing that got done.
 *
 * `auto`    — ink bars, terracotta tick; for any themed surface.
 * `inverse` — white bars, pale tick; for terracotta grounds.
 * `mono`    — everything currentColor; for tiny sizes and one-colour contexts.
 * `animate` — the three bars pulse like a level meter (stilled under prefers-reduced-motion).
 */
export default function Mark({
  size = 24, tone = 'auto', animate = false, title, className = '',
}: { size?: number; tone?: 'auto' | 'inverse' | 'mono'; animate?: boolean; title?: string; className?: string }) {
  const bars = tone === 'inverse' ? '#fff' : tone === 'mono' ? 'currentColor' : 'var(--text-primary)';
  const tick = tone === 'inverse' ? '#ffd9c7' : tone === 'mono' ? 'currentColor' : 'var(--accent-text)';
  return (
    <svg
      className={`mark ${animate ? 'mark-live' : ''} ${className}`.trim()}
      width={size} height={Math.round(size * 80 / 120)} viewBox="0 0 120 80" fill="none"
      role={title ? 'img' : undefined} aria-hidden={title ? undefined : true}
    >
      {title && <title>{title}</title>}
      <g stroke={bars} strokeWidth={8} strokeLinecap="round">
        <path d="M12 40v0" />
        <path className="mark-bar b1" d="M26 28v24" />
        <path className="mark-bar b2" d="M40 18v44" />
        <path className="mark-bar b3" d="M54 30v20" />
      </g>
      <path d="M66 42l12 12 30-32" stroke={tick} strokeWidth={9} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
