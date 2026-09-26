'use client';

import {
  type ProjectReportInput,
  fmtDueReport,
  fmtReportDate,
  shapeProjectReportInput,
} from '@/lib/projectReport';
import { noteBodyPlainText } from '@/lib/noteHtml';
import { isProjectOwner, isProjectViewer } from '@/lib/scope';
import { assigneeEmailsOf } from '@/lib/taskAccess';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function personRole(project: ProjectReportInput['project'], email: string) {
  if (isProjectOwner(project, email)) return 'owner';
  if (isProjectViewer(project, email)) return 'view-only';
  return 'member';
}

function assigneeLabel(t: any) {
  const emails = assigneeEmailsOf(t);
  if (!emails.length) return '—';
  return emails.map(e => e.split('@')[0]).join(', ');
}

/** Printable HTML report — use inside `.print-only` or the dedicated print route. */
export default function ProjectReportView({
  project,
  tasks,
  moms,
  notes,
  files,
  aboutText,
}: {
  project: ProjectReportInput['project'];
  tasks: any[];
  moms: any[];
  notes: any[];
  files: any[];
  aboutText?: string;
}) {
  const data = shapeProjectReportInput(project, tasks, moms, notes, files, aboutText);
  const { memberEmails } = data;
  const about = data.aboutText || '';
  const open = tasks.filter(t => !t.completed);
  const done = tasks.filter(t => t.completed);

  return (
    <>
      <h1>{project.name}</h1>
      <p className="print-sub">
        {plural(memberEmails.length, 'member')} · {open.length} open · {done.length} done · {plural(moms.length, 'meeting')}
        {project.ownerId?.email && (
          <>
            <br />
            Started by {project.ownerId.name || project.ownerId.email}
          </>
        )}
        <br />
        Exported {fmtReportDate(new Date().toISOString())}
      </p>

      <h2>People</h2>
      <ul>
        {memberEmails.map(email => (
          <li key={email}>
            {email} ({personRole(project, email)})
            {isProjectOwner(project, email) ? ' — owner' : ''}
            {' · '}
            {open.filter(t => assigneeEmailsOf(t).includes(email)).length} open
          </li>
        ))}
      </ul>

      {about.trim() && (
        <>
          <h2>About</h2>
          <p className="print-pre">{about}</p>
        </>
      )}

      {notes.length > 0 && (
        <>
          <h2>Notes ({notes.length})</h2>
          {notes.map(n => {
            const body = noteBodyPlainText(n.body || '');
            return (
              <div key={n._id} className="print-block">
                <h3>
                  {n.title || 'Untitled'}{' '}
                  <span className="print-sub">{fmtReportDate(n.updatedAt || n.createdAt)}</span>
                </h3>
                {body && <p className="print-pre">{body}</p>}
              </div>
            );
          })}
        </>
      )}

      <h2>Open tasks ({open.length})</h2>
      {open.length === 0 ? (
        <p>None.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Task</th>
              <th>Due</th>
              <th>Owner</th>
            </tr>
          </thead>
          <tbody>
            {open.map(t => (
              <tr key={t._id}>
                <td>
                  <strong>{t.title}</strong>
                  {t.description && <div className="print-desc">{t.description}</div>}
                </td>
                <td>{t.dueAt ? fmtDueReport(t.dueAt) : '—'}</td>
                <td>{assigneeLabel(t)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {done.length > 0 && (
        <>
          <h2>Completed ({done.length})</h2>
          <ul>
            {done.map(t => (
              <li key={t._id}>
                {t.title}
                {t.dueAt ? ` · due ${fmtDueReport(t.dueAt)}` : ''} · {assigneeLabel(t)}
              </li>
            ))}
          </ul>
        </>
      )}

      {moms.length > 0 && (
        <>
          <h2>Meetings ({moms.length})</h2>
          {moms.map(m => {
            const actions = (m.candidates || []).map((c: any) => c.title).filter(Boolean);
            return (
              <div key={m._id} className="print-block">
                <h3>
                  {m.title} <span className="print-sub">{fmtReportDate(m.createdAt)}</span>
                </h3>
                {m.summary && <p className="print-pre">{m.summary}</p>}
                {actions.length > 0 && (
                  <p className="print-desc">
                    <strong>Actions:</strong> {actions.join('; ')}
                  </p>
                )}
              </div>
            );
          })}
        </>
      )}

      {files.length > 0 && (
        <>
          <h2>Files ({files.length})</h2>
          <ul>
            {files.map(d => (
              <li key={d._id}>
                {d.name} · {d.type === 'link' ? 'link' : (d.mimeType || 'file')} · {fmtReportDate(d.createdAt)}
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

export { buildProjectReportPlainText, shapeProjectReportInput } from '@/lib/projectReport';
