'use client';

import { usePathname } from 'next/navigation';
import Loading from '@/components/ui/Loading';
import { routeTitle } from '@/lib/routeTitle';

/**
 * Main column while the RSC payload is in flight. The URL and nav tab already moved; this shows
 * that destination's title (when there is one) and the brand mark animation — not a generic wait.
 */
export default function RouteLoadingShell() {
  const pathname = usePathname();
  const title = routeTitle(pathname);

  return (
    <div className="page route-shell" aria-busy="true">
      {title ? <h1 className="page-title route-shell-title">{title}</h1> : null}
      <Loading label={title ? `Opening ${title}` : 'Opening this page'} />
    </div>
  );
}
