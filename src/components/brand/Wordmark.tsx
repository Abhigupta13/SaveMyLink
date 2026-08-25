import Mark from './Mark';

/** Mark + "ALL YOU NEED", linking home. `className` picks the existing wordmark style for its slot. */
export default function Wordmark({ className = 'logo', size = 22, tone = 'auto' as const }: {
  className?: string; size?: number; tone?: 'auto' | 'inverse' | 'mono';
}) {
  return (
    <a href="/" className={`wordmark ${className}`}>
      <Mark size={size} tone={tone} />
      <span className="wordmark-text">ALL <span className="logo-light">YOU NEED</span></span>
    </a>
  );
}
