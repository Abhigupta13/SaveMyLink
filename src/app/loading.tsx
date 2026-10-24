import RouteLoadingShell from '@/components/RouteLoadingShell';

/**
 * Between tap and paint: nav already shows the new tab; the main column shows that page's title
 * (when known) and the brand mark animation until content arrives.
 */
export default function RouteLoading() {
  return <RouteLoadingShell />;
}
