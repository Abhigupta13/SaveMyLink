'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Users } from 'lucide-react';
import { shareNoticeState, markShareNoticeSeen } from '@/actions/visibility';
import { needsShareNotice, memberCount } from '@/lib/visibility';

type ShareableProject = Parameters<typeof memberCount>[0] & { _id?: unknown; name?: string };

type Ask = { projectId: string; name: string; count: number; resolve: (ok: boolean) => void };

/**
 * The first time something is filed into a group, say who will see it. Once per group, and a
 * "Don't show this again" box that silences it for every group — a sheet that fires on every
 * save is one people learn to click through, and then it protects nobody.
 *
 * Callers wrap their submit: `if (!(await confirmShare(project))) return;` and render `shareDialog`.
 */
export function useShareNotice() {
  const seen = useRef<string[] | null>(null);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [never, setNever] = useState(false);

  useEffect(() => { shareNoticeState().then(r => { seen.current = r.seen; }).catch(() => { seen.current = []; }); }, []);

  const confirmShare = useCallback(async (project: ShareableProject): Promise<boolean> => {
    if (!project?._id) return true;   // personal — nothing to warn about
    const projectId = String(project._id);
    if (!seen.current) seen.current = await shareNoticeState().then(r => r.seen).catch(() => []);
    if (!needsShareNotice(seen.current, projectId)) return true;
    return new Promise(resolve => setAsk({ projectId, name: project.name || 'this group', count: memberCount(project), resolve }));
  }, []);

  const settle = (ok: boolean) => {
    if (!ask) return;
    if (ok) {
      const key = never ? '*' : ask.projectId;
      seen.current = [...(seen.current || []), key];
      markShareNoticeSeen(key).catch(() => {});
    }
    ask.resolve(ok);
    setAsk(null);
    setNever(false);
  };

  const shareDialog = ask ? (
    <div className="confirm-overlay" onClick={() => settle(false)}>
      <div className="confirm-box" onClick={e => e.stopPropagation()} role="alertdialog" aria-modal="true">
        <div className="confirm-icon"><Users size={20} /></div>
        <h3>Everyone in {ask.name} will see this</h3>
        <p>
          {ask.count === 1 ? 'Only you are in it right now — anyone you add later sees it too.' : `${ask.count} people are in this group.`}
          {' '}Move it to Personal any time to stop sharing.
        </p>
        <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '18px', cursor: 'pointer' }}>
          <input type="checkbox" checked={never} onChange={e => setNever(e.target.checked)} />
          Don&apos;t show this again
        </label>
        <div className="confirm-actions">
          <button className="confirm-cancel" onClick={() => settle(false)}>Cancel</button>
          <button className="confirm-ok" onClick={() => settle(true)} autoFocus>Got it</button>
        </div>
      </div>
    </div>
  ) : null;

  return { confirmShare, shareDialog };
}
