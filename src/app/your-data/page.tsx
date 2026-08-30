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
import StartTourButton from '@/components/StartTourButton';
import '@/styles/guide.css';

export const metadata = { title: 'How it works, and who sees it · ALL YOU NEED' };

/** What the tour stops at. Copy only — Tour.tsx owns the real steps and the routes. */
const STOPS: [string, string][] = [
  ['Home', 'Everything you save, work and life, on one screen.'],
  ['Record a meeting', 'You talk; it writes the summary and pulls out the action items.'],
  ['Tasks', 'A due time makes a task chase itself, on your phone, until it is done.'],
  ['Links and notes', 'Save anything from anywhere; one search finds all of it.'],
  ['Groups', 'Like a WhatsApp group — meetings, tasks and notes shared with exactly those people.'],
  ['Jarvis', 'Ask about your own stuff, by voice or by typing.'],
];

/** My records in each of my groups, counted in one query per collection. */
async function countsByProject(model: Pick<mongoose.Model<unknown>, 'aggregate'>, ownerField: string, userId: string, ids: unknown[]) {
  const rows = await model.aggregate<{ _id: unknown; n: number }>([
    { $match: { [ownerField]: new mongoose.Types.ObjectId(userId), projectId: { $in: ids } } },
    { $group: { _id: '$projectId', n: { $sum: 1 } } },
  ]);
  return new Map(rows.map(r => [String(r._id), r.n]));
}

/**
 * Two questions one page can answer together: how the app fits together (the tour), and what
 * leaves this account (the groups). The tour section is an explainer — the tour itself spotlights
 * real controls on real pages, so it starts from Home, not from here.
 *
 * Nothing below shows a title or a body — counts only, and only this account's own records.
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

  return (
    <div className="page narrow guide">
      <header className="g-head">
        <p className="g-eyebrow">Your account</p>
        <h1>How it works, and who sees it</h1>
        <p className="g-lede">
          Two answers on one page, for <strong>{email}</strong>: a guided walk through the app, and
          exactly what has left this account.
        </p>
      </header>

      <section aria-labelledby="tour-h">
        <div className="g-chapter">
          <span className="g-word">One</span>
          <h2 id="tour-h">The 90-second tour</h2>
        </div>

        <div className="g-card">
          <p style={{ marginTop: 0 }}>
            The tour walks the real app. It lights up the actual button on each screen and says what
            it is for — so it starts at Home rather than running here. Skip any stop, or stop the
            whole thing, whenever you like.
          </p>

          <ol className="g-rail" style={{ marginTop: '20px' }}>
            {STOPS.map(([title, body], i) => (
              <li key={title} className="g-stop">
                <span className="g-n" aria-hidden="true">{i + 1}</span>
                <span>
                  <b>{title}</b>
                  <span>{body}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>

        <div className="g-cta-wrap" style={{ marginTop: '16px' }}>
          <StartTourButton />
          <p className="g-note">Takes you to Home and begins there.</p>
        </div>
      </section>

      <section aria-labelledby="data-h">
        <div className="g-chapter">
          <span className="g-word">Two</span>
          <h2 id="data-h">Who can see my data</h2>
        </div>
        <p className="g-lede" style={{ marginBottom: '24px' }}>
          A group is the only way anything you save reaches another person.
        </p>

        <div className="g-card">
          <h3>Only you can see</h3>
          <p>
            Every link you save. Everything in the Private Safe. Notes, tasks, documents and meetings
            that are not filed under a group. Your contacts.
          </p>
        </div>

        <div className="g-card">
          <h3>Shared with a group</h3>
          {projects.length === 0 ? (
            <p>You are not in any group yet, so nothing you have saved is visible to anyone else.</p>
          ) : (
            <div style={{ marginTop: '12px' }}>
              {projects.map(p => {
                const id = String(p._id);
                const mine = [
                  plural(notes.get(id) || 0, 'note'), plural(tasks.get(id) || 0, 'task'),
                  plural(docs.get(id) || 0, 'document'), plural(moms.get(id) || 0, 'meeting'),
                ].join(' · ');
                return (
                  <Link key={id} href={`/projects/${id}`} className="g-group">
                    <b>{p.name}</b>
                    <span className={`g-chip ${role(p) === 'view-only' ? '' : 'accent'}`}>{role(p)}</span>
                    <span className="g-chip">{memberCount(p) === 1 ? 'just you' : `${memberCount(p)} people`}</span>
                    <span className="g-mine">You put in: {mine}</span>
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        <div className="g-card">
          <h3>How to stop sharing</h3>
          <p>
            Move the item back to Personal — the note, task or document keeps its content and leaves
            the group. Or leave the group: what you created stays with the group so the others are
            not left with holes, but you stop seeing theirs.
          </p>
        </div>

        <div className="g-card">
          <h3>What the AI sees</h3>
          <p>
            A meeting recording goes to Groq, or to Sarvam for Hindi and Hinglish, to be transcribed.
            Transcripts, and the text of your vault when you ask Jarvis, go to Google Gemini to answer
            and summarise. Only what that one request needs is sent.
          </p>
          <p>
            Nothing is used to train anything. The rest — including what we as the operator can and
            cannot see — is in the <Link href="/terms">terms</Link>.
          </p>
        </div>
      </section>

      <p className="g-foot">
        <Link href="/profile">Back to profile</Link>
        <Link href="/terms">Terms and conditions</Link>
      </p>
    </div>
  );
}
