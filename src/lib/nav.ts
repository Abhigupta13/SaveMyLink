import {
  Link as LinkIcon, StickyNote, CheckSquare, FolderOpen, Mic,
  Library, Users, Newspaper, Upload,
} from 'lucide-react';

/* Single source of truth for destinations: the desktop rail, the phone bottom bar
   and the Home grid all read this, so adding a page updates every surface at once. */
export const NAV = [
  { href: '/links', Icon: LinkIcon, title: 'Links', desc: 'Saved links & categories' },
  { href: '/notes', Icon: StickyNote, title: 'Notes', desc: 'Quick thoughts & long notes' },
  { href: '/tasks', Icon: CheckSquare, title: 'Tasks', desc: 'Personal + project tasks with reminders' },
  { href: '/projects', Icon: FolderOpen, title: 'Projects', desc: 'Work grouped into projects' },
  { href: '/mom', Icon: Mic, title: 'MOM', desc: 'Record meetings → summary → tasks' },
  { href: '/d-locker', Icon: Library, title: 'Digi Locker', desc: 'Documents, PDFs & files' },
  { href: '/contacts', Icon: Users, title: 'Contacts', desc: 'People you work with' },
  { href: '/digest', Icon: Newspaper, title: 'Weekly digest', desc: 'Saved this week · due next week' },
  { href: '/import', Icon: Upload, title: 'Import', desc: 'Bring in bookmarks & files' },
] as const;

// Phone bottom bar: the daily-use four, everything else lives in the Home grid
export const MOBILE_NAV = ['/links', '/notes', '/tasks', '/mom'];
