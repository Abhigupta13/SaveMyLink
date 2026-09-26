/**
 * Shared project export — print page, hidden print block, and native Share text.
 */

import { formatTime, formatDay, formatDate } from '@/lib/time';
import { noteBodyPlainText } from '@/lib/noteHtml';
import { isProjectOwner, isProjectViewer } from '@/lib/scope';
import { assigneeEmailOf, assigneeEmailsOf } from '@/lib/taskAccess';

export interface ProjectReportInput {
  project: {
    name?: string;
    notes?: string;
    createdAt?: string;
    ownerId?: { email?: string; name?: string } | null;
    memberEmails?: string[];
    viewerEmails?: string[];
  };
  tasks: any[];
  moms: any[];
  notes: any[];
  files: any[];
  /** About tab body — may differ from project.notes if unsaved in UI; prefer saved project.notes on server. */
  aboutText?: string;
  memberEmails: string[];
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

export function fmtDueReport(iso: string): string {
  const d = new Date(iso);
  const diffDays = Math.round((startOfDay(d).getTime() - startOfDay(new Date()).getTime()) / 86400000);
  const time = formatTime(d);
  if (diffDays === 0) return `Today · ${time}`;
  if (diffDays === 1) return `Tomorrow · ${time}`;
  if (diffDays === -1) return `Yesterday · ${time}`;
  return `${formatDay(d)} · ${time}`;
}

export const fmtReportDate = (iso: string) => formatDate(iso);

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function shapeProjectReportInput(
  project: ProjectReportInput['project'],
  tasks: any[],
  moms: any[],
  notes: any[],
  files: any[],
  aboutText?: string,
): ProjectReportInput {
  const memberEmails = [
    ...new Set([
      project.ownerId?.email,
      ...(project.memberEmails || []),
      ...(project.viewerEmails || []),
    ].filter(Boolean)),
  ] as string[];

  return {
    project,
    tasks,
    moms,
    notes,
    files,
    aboutText: aboutText ?? project.notes ?? '',
    memberEmails,
  };
}

function personRole(project: ProjectReportInput['project'], email: string): string {
  if (isProjectOwner(project, email)) return 'owner';
  if (isProjectViewer(project, email)) return 'view-only';
  return 'member';
}

function assigneeLabel(t: any): string {
  const emails = assigneeEmailsOf(t);
  if (!emails.length) return '—';
  return emails.map(e => e.split('@')[0]).join(', ');
}

export function buildProjectReportPlainText(data: ProjectReportInput): string {
  const { project, tasks, moms, notes, files, aboutText, memberEmails } = data;
  const open = tasks.filter(t => !t.completed);
  const done = tasks.filter(t => t.completed);
  const lines: string[] = [];

  lines.push(project.name || 'Project');
  lines.push(
    `${plural(memberEmails.length, 'member')} · ${open.length} open · ${done.length} done · ${plural(moms.length, 'meeting')}`,
  );
  if (project.ownerId?.email) {
    lines.push(`Started by ${project.ownerId.name || project.ownerId.email}`);
  }
  lines.push(`Exported ${fmtReportDate(new Date().toISOString())}`);
  lines.push('');

  lines.push('PEOPLE');
  for (const email of memberEmails) {
    const role = personRole(project, email);
    const openCount = open.filter(t => assigneeEmailsOf(t).includes(email)).length;
    lines.push(`- ${email} (${role}) · ${openCount} open`);
  }
  lines.push('');

  if (aboutText?.trim()) {
    lines.push('ABOUT');
    lines.push(aboutText.trim());
    lines.push('');
  }

  if (notes.length) {
    lines.push('NOTES');
    for (const n of notes) {
      const body = noteBodyPlainText(n.body || '');
      lines.push(`• ${n.title || 'Untitled'} (${fmtReportDate(n.updatedAt || n.createdAt)})`);
      if (body) lines.push(`  ${body}`);
    }
    lines.push('');
  }

  lines.push(`OPEN TASKS (${open.length})`);
  if (!open.length) lines.push('None.');
  else {
    for (const t of open) {
      lines.push(`- ${t.title}`);
      if (t.description) lines.push(`  ${String(t.description).replace(/\s+/g, ' ').trim()}`);
      lines.push(`  Due: ${t.dueAt ? fmtDueReport(t.dueAt) : '—'} · Owner: ${assigneeLabel(t)}`);
    }
  }
  lines.push('');

  if (done.length) {
    lines.push(`COMPLETED (${done.length})`);
    for (const t of done) {
      lines.push(
        `- ${t.title} · Due: ${t.dueAt ? fmtDueReport(t.dueAt) : '—'} · ${assigneeLabel(t)}`,
      );
    }
    lines.push('');
  }

  if (moms.length) {
    lines.push(`MEETINGS (${moms.length})`);
    for (const m of moms) {
      lines.push(`${m.title} (${fmtReportDate(m.createdAt)})`);
      if (m.summary) lines.push(String(m.summary).trim());
      const actions = (m.candidates || []).map((c: any) => c.title).filter(Boolean);
      if (actions.length) lines.push(`Actions: ${actions.join('; ')}`);
      lines.push('');
    }
  }

  if (files.length) {
    lines.push(`FILES (${files.length})`);
    for (const d of files) {
      const kind = d.type === 'link' ? 'link' : (d.mimeType || 'file');
      lines.push(`- ${d.name} · ${kind} · ${fmtReportDate(d.createdAt)}`);
    }
  }

  return lines.join('\n').trim();
}
