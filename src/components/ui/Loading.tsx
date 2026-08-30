import Mark from '../brand/Mark';

/**
 * What every screen shows while it is waiting.
 *
 * The brand mark, doing the thing the brand mark means: the bars pulse like a level meter and the
 * tick draws itself in over them — a meeting becoming a thing that got done, on a loop. A spinner
 * would have said the same "wait" in a voice belonging to no particular app.
 *
 * One component for both scales, because they are the same state at different sizes:
 *
 *  · `page` (default) — a route is arriving. Centred in the viewport under the header.
 *  · `inline`         — one card's contents are arriving; the page around it is already there and
 *                       must not jump. Sits in the card's own flow at the size of a line of text.
 *
 * `label` is read out but not drawn. The animation is the whole message on screen — a word under it
 * says nothing the movement has not — while a screen reader gets a real one instead of an SVG that
 * announces nothing. Pass something specific when the wait has a subject worth naming.
 */
export default function Loading({
  variant = 'page', label = 'Loading', className = '',
}: { variant?: 'page' | 'inline'; label?: string; className?: string }) {
  return (
    <div className={`loading loading-${variant} ${className}`.trim()} role="status" aria-live="polite">
      <Mark size={variant === 'page' ? 72 : 34} animate />
      <span className="sr-only">{label}</span>
    </div>
  );
}
