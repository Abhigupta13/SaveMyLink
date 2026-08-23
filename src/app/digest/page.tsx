import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { redirect } from 'next/navigation';
import connectToDatabase from '@/lib/mongodb';
import { Link } from '@/lib/models/Link';
import Task from '@/lib/models/Task';

export default async function DigestPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect('/auth/signin');
  const userId = (session.user as any).id;

  await connectToDatabase();
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600e3);
  const weekAhead = new Date(Date.now() + 7 * 24 * 3600e3);

  const [savedLinks, dueTasks] = await Promise.all([
    Link.find({ userId, isPrivate: { $ne: true }, createdAt: { $gte: weekAgo } })
      .populate('category', 'name').sort({ createdAt: -1 }).limit(30).lean(),
    Task.find({
      completed: false,
      dueAt: { $lte: weekAhead },
      $or: [{ userId }, { assigneeId: userId }],
    }).sort({ dueAt: 1 }).limit(30).lean(),
  ]);

  const links = JSON.parse(JSON.stringify(savedLinks));
  const tasks = JSON.parse(JSON.stringify(dueTasks));

  return (
    <div className="container" style={{ padding: '24px 16px 120px' }}>
      <h1 style={{ fontSize: '2rem', fontWeight: 800, letterSpacing: '-0.03em', color: 'var(--text-primary)', marginBottom: '4px' }}>Weekly digest</h1>
      <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', fontWeight: 600, marginBottom: '32px' }}>
        Saved this week · due in the next 7 days
      </p>

      <p style={{ fontSize: '0.7rem', fontWeight: 800, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '10px' }}>
        Tasks needing attention ({tasks.length})
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '32px' }}>
        {tasks.length === 0 && <p style={{ color: 'var(--text-secondary)', fontWeight: 600, fontSize: '0.9rem' }}>Nothing due. Clean week ahead 🎉</p>}
        {tasks.map((t: any) => {
          const overdue = new Date(t.dueAt).getTime() < Date.now();
          return (
            <a key={t._id} href="/tasks" style={{ padding: '14px 18px', borderRadius: '16px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', textDecoration: 'none' }}>
              <span style={{ display: 'block', fontWeight: 700, color: 'var(--text-primary)', fontSize: '0.95rem' }}>{t.title}</span>
              <span style={{ fontSize: '0.75rem', fontWeight: 700, color: overdue ? '#ef4444' : 'var(--text-secondary)' }}>
                {overdue ? 'Overdue — was due ' : 'Due '}{new Date(t.dueAt).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
              </span>
            </a>
          );
        })}
      </div>

      <p style={{ fontSize: '0.7rem', fontWeight: 800, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '10px' }}>
        Saved this week ({links.length})
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {links.length === 0 && <p style={{ color: 'var(--text-secondary)', fontWeight: 600, fontSize: '0.9rem' }}>No links saved this week.</p>}
        {links.map((l: any) => (
          <a key={l._id} href={l.url || '/links'} target={l.url ? '_blank' : undefined} rel="noopener noreferrer"
            style={{ display: 'flex', gap: '12px', alignItems: 'center', padding: '12px 16px', borderRadius: '16px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', textDecoration: 'none' }}>
            {l.previewImageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={l.previewImageUrl} alt="" style={{ width: '56px', height: '42px', objectFit: 'cover', borderRadius: '10px', flexShrink: 0 }} />
            )}
            <span style={{ minWidth: 0 }}>
              <span style={{ display: 'block', fontWeight: 700, color: 'var(--text-primary)', fontSize: '0.9rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.title || l.url}</span>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 600 }}>{l.category?.name || (l.url ? 'Uncategorized' : 'Note')}</span>
            </span>
          </a>
        ))}
      </div>
    </div>
  );
}
