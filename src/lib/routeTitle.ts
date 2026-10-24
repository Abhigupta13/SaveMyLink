import { NAV } from '@/lib/nav';

/** Human title for the URL — used while the route shell is showing the logo. */
export function routeTitle(pathname: string): string | null {
  if (pathname === '/') return null;
  if (pathname.startsWith('/profile')) return 'Profile';
  if (pathname.startsWith('/search')) return 'Search';
  if (pathname.startsWith('/admin')) return 'Admin';
  const hit = NAV.find(n => pathname === n.href || pathname.startsWith(`${n.href}/`));
  if (hit) return hit.title;
  if (pathname.startsWith('/projects/')) return 'Project';
  return null;
}
