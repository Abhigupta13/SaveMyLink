'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Bell } from 'lucide-react';
import { unreadNotificationCount } from '@/actions/notifications';

/**
 * The way in to /notifications, and the only place the count is shown.
 *
 * Refetched on navigation rather than polled. A timer would mean every open tab hitting the
 * database on a schedule forever for a number that only matters when somebody looks at it, and the
 * moment a person actually cares is the moment they move around the app. It is also why the count
 * is allowed to be a few seconds stale: it is a nudge, not a readout.
 *
 * Renders nothing at all when there is nothing to say — an always-present bell showing zero is
 * furniture, and this app puts the bell next to a wordmark where space is already tight.
 */
export default function NotificationsBell({ className = '' }: { className?: string }) {
  const [count, setCount] = useState(0);
  const pathname = usePathname();

  useEffect(() => {
    let cancelled = false;
    unreadNotificationCount()
      .then(n => { if (!cancelled) setCount(n); })
      .catch(() => { /* a count that cannot be fetched is a bell without a badge, not an error */ });
    return () => { cancelled = true; };
  }, [pathname]);

  const label = count > 0
    ? `Notifications, ${count} new`
    : 'Notifications';

  return (
    <Link href="/notifications" className={`bell-wrap icon-btn ${className}`.trim()} aria-label={label} title={label}>
      <Bell size={18} strokeWidth={2.2} aria-hidden="true" />
      {/* 9+ rather than a three-digit number: the badge sits on a 44px control and the difference
          between 40 and 400 unread changes nothing about what the person does next. */}
      {count > 0 && <span className="bell-badge" aria-hidden="true">{count > 9 ? '9+' : count}</span>}
    </Link>
  );
}
