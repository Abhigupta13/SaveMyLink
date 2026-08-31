'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { MessageSquare, Activity, BellOff } from 'lucide-react';
import { getNotifications, markNotificationsRead, type NotificationItem } from '@/actions/notifications';
import { agoLabel } from '@/lib/notifications';
import Loading from '@/components/ui/Loading';
import LoadError from '@/components/ui/LoadError';

/**
 * What happened in your groups while you were away — messages people sent, and what they did.
 *
 * Opening the page IS reading it. There is no "mark all read" button because there is nothing the
 * button would do that arriving here has not already done, and a badge you have to dismiss twice
 * is a badge people stop trusting. The rows stay visually marked as new for this render so you can
 * see WHICH ones were unread; the next visit shows them settled.
 */
export default function NotificationsPage() {
  const { status } = useSession();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  /* No setState before the first await. Clearing `failed` up front would fire a render on mount
     purely to set state back to what it already was — the cascading-render shape
     react-hooks/set-state-in-effect exists to catch. The outcome sets it either way. */
  const load = useCallback(async () => {
    try {
      const res = await getNotifications();
      if (!res.success) { setFailed(true); return; }
      setItems(res.items);
      setFailed(false);
      // Stamped after the list is in hand, so anything that arrives DURING the request is still
      // new next time rather than being marked read without ever being shown.
      if (res.unread > 0) await markNotificationsRead().catch(() => {});
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (status === 'authenticated') load(); }, [status, load]);

  if (status === 'unauthenticated') {
    return (
      <div className="container" style={{ padding: '24px 16px 120px' }}>
        <h1 className="dg-title">Notifications</h1>
        <p className="dg-lede">Sign in to see what your groups have been doing.</p>
      </div>
    );
  }

  return (
    <div className="container" style={{ padding: '24px 16px 120px' }}>
      <h1 className="dg-title">Notifications</h1>
      <p className="dg-lede">Messages and activity from your groups, this week</p>

      {loading ? (
        <Loading label="Loading your notifications" />
      ) : failed ? (
        <LoadError what="your notifications" onRetry={load} />
      ) : items.length === 0 ? (
        <div className="empty-state">
          <BellOff size={22} style={{ color: 'var(--text-tertiary)', marginBottom: '8px' }} aria-hidden="true" />
          <p style={{ fontWeight: 800, marginBottom: '4px' }}>Nothing new</p>
          <p className="empty-hint">
            When someone messages a group you are in, or adds and finishes work, it shows up here.
          </p>
        </div>
      ) : (
        <div className="notif-list">
          {items.map(n => (
            <Link key={n.id} href={n.href} className={`notif-row${n.unread ? ' unread' : ''}`}>
              <span className={`notif-icon ${n.kind}`} aria-hidden="true">
                {n.kind === 'message' ? <MessageSquare size={15} /> : <Activity size={15} />}
              </span>
              <span className="notif-body">
                <span className="notif-text">{n.text}</span>
                <span className="notif-meta">
                  <span className="chip">{n.projectName}</span>
                  <span className="notif-ago">{agoLabel(n.at)}</span>
                </span>
              </span>
              {/* Announced rather than drawn: the dot is colour alone, which is not a status. */}
              {n.unread && <span className="notif-dot"><span className="sr-only">New</span></span>}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
