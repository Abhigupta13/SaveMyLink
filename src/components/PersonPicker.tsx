'use client';

import { useEffect, useRef, useState } from 'react';
import { Search, UserPlus } from 'lucide-react';
import { getContacts } from '@/actions/contact';

type Person = { email: string; name?: string };

/** Searchable list of everyone you already know — saved contacts plus people from your
 *  other projects — with a fallback for inviting an address that isn't in either.
 *  Reuses the .picker-* styles from ProjectPicker. */
export default function PersonPicker({ exclude, onPick, busy, label = 'Add a teammate…' }: {
  exclude: string[];                       // emails already on the project
  onPick: (email: string) => void | Promise<void>;
  busy?: boolean;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [people, setPeople] = useState<Person[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);

  // Refetch on every open, so someone added on the Contacts page in another tab
  // shows up here without a reload.
  useEffect(() => {
    if (!open) return;
    getContacts().then(r => {
      if (!r.success) return;
      // One list now — project people are real contacts, so there is no second source to merge
      const all: Person[] = (r.contacts || [])
        .filter((c: any) => c.email)
        .map((c: any) => ({ email: String(c.email).toLowerCase(), name: c.name }));
      setPeople([...new Map(all.map(p => [p.email, p])).values()]);
    }).catch(() => {});
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (!rootRef.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const already = new Set(exclude.map(e => e.toLowerCase()));
  const q = query.trim().toLowerCase();
  const matches = people.filter(p =>
    !already.has(p.email) && (!q || p.email.includes(q) || (p.name || '').toLowerCase().includes(q)));
  const typed = /^\S+@\S+\.\S+$/.test(q) && !already.has(q) && !matches.some(m => m.email === q) ? q : null;

  const pick = async (email: string) => { setOpen(false); setQuery(''); await onPick(email); };

  return (
    <div ref={rootRef} style={{ position: 'relative', marginTop: '10px' }}>
      <button type="button" className="field picker-more" onClick={() => setOpen(o => !o)} disabled={busy}
        style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', cursor: 'pointer', fontWeight: 700 }}>
        <UserPlus size={15} /> {busy ? 'Inviting…' : label}
      </button>

      {open && (
        <div className="picker-panel">
          <div className="picker-search">
            <Search size={15} />
            <input autoFocus placeholder="Search contacts or type an email" value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Escape') { setOpen(false); return; }
                if (e.key !== 'Enter') return;
                e.preventDefault();
                const first = matches[0]?.email || typed;
                if (first) pick(first);
              }} />
          </div>
          <div className="picker-list">
            {matches.map(p => (
              <button key={p.email} type="button" className="picker-item" onClick={() => pick(p.email)}>
                <span className="avatar-xs">{(p.name || p.email)[0].toUpperCase()}</span>
                <span className="picker-entry" style={{ flex: 1, minWidth: 0 }}>
                  <span className="picker-name">{p.name || p.email}</span>
                  {p.name && <span className="picker-sub">{p.email}</span>}
                </span>
              </button>
            ))}

            {typed && (
              <button type="button" className="picker-item" onClick={() => pick(typed)}>
                <UserPlus size={14} />
                <span className="picker-name">Invite {typed}</span>
              </button>
            )}

            {!matches.length && !typed && (
              <span className="picker-menu-note">
                {people.length
                  ? 'Nobody matches — type a full email address to invite someone new.'
                  : 'No contacts yet — type an email address to invite someone.'}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
