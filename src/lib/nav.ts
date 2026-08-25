import {
  Link as LinkIcon, StickyNote, CheckSquare, FolderOpen, Mic,
  Library, Users, Newspaper, Upload,
} from 'lucide-react';

/* Single source of truth for destinations: the desktop rail, the phone bottom bar
   and the Home grid all read this, so adding a page updates every surface at once. */
// `hint` is the WHY, shown on a section's empty state and gone once it isn't empty.
export const NAV = [
  { href: '/links', Icon: LinkIcon, title: 'Links', desc: 'Saved links & categories', hint: 'The place things go so they are not lost in a chat. Always private — a link is never shared with a group.' },
  { href: '/notes', Icon: StickyNote, title: 'Notes', desc: 'Quick thoughts & long notes', hint: 'Yours until you file one under a group; then everyone there can read and edit it. Meeting notes land here too.' },
  { href: '/tasks', Icon: CheckSquare, title: 'Tasks', desc: 'Personal + project tasks with reminders', hint: 'Give a task a due time and the app chases you — a day before, an hour before, then every morning until it is done. Nobody has to.' },
  { href: '/projects', Icon: FolderOpen, title: 'Projects', desc: 'Work grouped into projects', hint: 'A group is the only thing that shares. Put people in it and their tasks, meetings and notes stay in one place — like a WhatsApp group that remembers.' },
  { href: '/mom', Icon: Mic, title: 'MOM', desc: 'Record meetings → summary → tasks', hint: 'Record the meeting and the app writes the minutes, pulls out who does what by when, and turns them into tasks that remind themselves. Nobody writes the minutes, nobody chases.' },
  { href: '/d-locker', Icon: Library, title: 'Digi Locker', desc: 'Documents, PDFs & files', hint: 'Contracts, IDs, drawings — private to you, or filed under a group so the team has one copy. Jarvis can read inside a PDF here.' },
  { href: '/contacts', Icon: Users, title: 'Contacts', desc: 'People you work with', hint: 'Everyone in your groups appears here on their own. Add the rest, and invite anyone who is not on the app yet.' },
  { href: '/digest', Icon: Newspaper, title: 'Weekly digest', desc: 'Saved this week · due next week', hint: 'One page for Monday morning: what you saved, what is due, what is overdue.' },
  { href: '/import', Icon: Upload, title: 'Import', desc: 'Bring in bookmarks & files', hint: 'Bring your browser bookmarks in once, so this is where everything already is.' },
] as const;

export const hintFor = (href: (typeof NAV)[number]['href']) => NAV.find(n => n.href === href)!.hint;

// Phone bottom bar: the daily-use four, everything else lives in the Home grid
export const MOBILE_NAV = ['/links', '/notes', '/tasks', '/mom'];
