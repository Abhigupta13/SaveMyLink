import Link from 'next/link';
import mongoose from 'mongoose';
import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth';
import connectToDatabase from '@/lib/mongodb';
import { Project } from '@/lib/models/Project';
import { Note } from '@/lib/models/Note';
import Task from '@/lib/models/Task';
import { Document as Doc } from '@/lib/models/Document';
import { Mom } from '@/lib/models/Mom';
import { myProjectFilter } from '@/lib/projectAccess';
import { isProjectOwner, isProjectViewer, type OwnableProject } from '@/lib/scope';
import { memberCount } from '@/lib/visibility';

export const metadata = { title: 'Who can see my data · ALL YOU NEED' };

/** My records in each of my groups, counted in one query per collection. */
async function countsByProject(model: Pick<mongoose.Model<unknown>, 'aggregate'>, ownerField: string, userId: string, ids: unknown[]) {
  const rows = await model.aggregate<{ _id: unknown; n: number }>([
    { $match: { [ownerField]: new mongoose.Types.ObjectId(userId), projectId: { $in: ids } } },
    { $group: { _id: '$projectId', n: { $sum: 1 } } },
  ]);
  return new Map(rows.map(r => [String(r._id), r.n]));
}

/**
 * The same ground as /terms, but about THIS account: which groups you are in, what you have put
 * in each, and how to take it back out. Nothing here shows a title or a body — counts only.
 */
export default async function YourDataPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect('/auth/signin');
  const userId = session.user.id;
  const email = (session.user.email || '').toLowerCase();

  await connectToDatabase();
  type Row = OwnableProject & { _id: unknown; name: string };
  const projects = await Project.find(await myProjectFilter(userId, email))
    .populate('ownerId', 'email').sort({ createdAt: 1 }).lean<Row[]>();
  const ids = projects.map(p => p._id);
  const [notes, tasks, docs, moms] = await Promise.all([
    countsByProject(Note, 'userId', userId, ids),
    countsByProject(Task, 'userId', userId, ids),
    countsByProject(Doc, 'user', userId, ids),
    countsByProject(Mom, 'userId', userId, ids),
  ]);

  const role = (p: Row) =>
    isProjectOwner(p, email) ? 'owner' : isProjectViewer(p, email) ? 'view-only' : 'member';
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const h2: React.CSSProperties = { fontSize: '1rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '10px' };
  const para: React.CSSProperties = { fontSize: '0.88rem', lineHeight: 1.65, color: 'var(--text-secondary)' };

  return (
    <div className="page narrow">
      <h1 style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '6px' }}>Who can see my data</h1>
      <p style={{ ...para, marginBottom: '26px' }}>For {email}. A group is the only way anything you save reaches another person.</p>

      <section className="card" style={{ marginBottom: '14px' }}>
        <h2 style={h2}>Only you can see</h2>
        <p style={para}>
          Every link you save. Everything in the Private Safe. Notes, tasks, documents and meetings that are not filed under a group.
          Your contacts.
        </p>
      </section>

      <section className="card" style={{ marginBottom: '14px' }}>
        <h2 style={h2}>Shared with a group</h2>
        {projects.length === 0 ? (
          <p style={para}>You are not in any group yet, so nothing you have saved is visible to anyone else.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {projects.map(p => {
              const id = String(p._id);
              const mine = [
                plural(notes.get(id) || 0, 'note'), plural(tasks.get(id) || 0, 'task'),
                plural(docs.get(id) || 0, 'document'), plural(moms.get(id) || 0, 'meeting'),
              ].join(' · ');
              return (
                <Link key={id} href={`/projects/${id}`} style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', padding: '12px 14px', borderRadius: '14px', background: 'var(--bg-tertiary)', textDecoration: 'none', color: 'inherit' }}>
                  <span style={{ fontWeight: 700, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</span>
                  <span className={`chip ${role(p) === 'view-only' ? 'viewer' : ''}`}>{role(p)}</span>
                  <span className="chip">{memberCount(p) === 1 ? 'just you' : `${memberCount(p)} people`}</span>
                  <span style={{ ...para, fontSize: '0.78rem', width: '100%' }}>You put in: {mine}</span>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      <section className="card" style={{ marginBottom: '14px' }}>
        <h2 style={h2}>How to stop sharing</h2>
        <p style={para}>
          Move the item back to Personal — the note, task or document keeps its content and leaves the group.
          Or leave the group: what you created stays with the group so the others are not left with holes, but you stop seeing theirs.
        </p>
      </section>

      <section className="card" style={{ marginBottom: '14px' }}>
        <h2 style={h2}>What the AI sees</h2>
        <p style={{ ...para, marginBottom: '10px' }}>
          A meeting recording goes to Groq, or to Sarvam for Hindi and Hinglish, to be transcribed. Transcripts, and the text of your
          vault when you ask Jarvis, go to Google Gemini to answer and summarise. Only what that one request needs is sent.
        </p>
        <p style={para}>
          Nothing is used to train anything. The rest — including what we as the operator can and cannot see — is in the <Link href="/terms">terms</Link>.
        </p>
      </section>

      <p className="auth-foot" style={{ marginTop: '20px' }}>
        <Link href="/profile">Back to profile</Link> · <Link href="/terms">Terms &amp; your data</Link>
      </p>
    </div>
  );
}
