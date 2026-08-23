'use client';

import { useEffect, useRef, useState } from 'react';
import { Search, Plus, MoreHorizontal, Pencil, Trash2, UserPlus, Check, X, FolderOpen } from 'lucide-react';
import { useSession } from 'next-auth/react';
import { useFeedback } from '@/components/ui/Feedback';

export interface PickerProject { _id: string; name: string; count?: number; ownerId?: any; memberEmails?: string[] }

interface Props {
  projects: PickerProject[];
  activeId: string | null;              // null = Personal
  counts?: Record<string, number>;      // projectId -> open task count ('personal' for personal)
  onSelect: (project: PickerProject | null) => void;
  onCreate: (name: string) => Promise<any>;
  onRename?: (project: PickerProject, name: string) => Promise<any>;
  onDelete?: (project: PickerProject) => Promise<any>;
  onInvite?: (project: PickerProject) => void;
  showPersonal?: boolean;               // MOM has no "personal" scope
  recentCount?: number;
}

/** 4 most-recent projects as chips + a searchable dropdown holding everything else. */
export default function ProjectPicker({
  projects, activeId, counts = {}, onSelect, onCreate, onRename, onDelete, onInvite,
  showPersonal = true, recentCount = 4,
}: Props) {
  const { confirm } = useFeedback();
  const { data: session } = useSession();
  const myEmail = (session?.user?.email || '').toLowerCase();
  // getProjects populates ownerId with {email,name} — same check the project page uses.
  const ownerEmail = (p: PickerProject) => (p.ownerId?.email || '').toLowerCase();
  const isOwner = (p: PickerProject) => ownerEmail(p) === myEmail;
  const ownerLabel = (p: PickerProject) => ownerEmail(p) || 'its owner';
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);

  // close on outside click / Esc
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!rootRef.current?.contains(e.target as Node)) reset(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') reset(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const reset = () => { setOpen(false); setQuery(''); setMenuFor(null); setRenaming(null); setCreating(false); setNewName(''); };

  const recent = projects.slice(0, recentCount);
  const active = projects.find(p => p._id === activeId) || null;
  // the active project always stays visible as a chip, even if it's older
  const chips = active && !recent.some(p => p._id === active._id) ? [active, ...recent.slice(0, recentCount - 1)] : recent;
  const overflow = projects.length - chips.length;

  const filtered = query
    ? projects.filter(p => p.name.toLowerCase().includes(query.toLowerCase()))
    : projects;

  const submitCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    const res = await onCreate(newName.trim());
    if (res?.success !== false) { setNewName(''); setCreating(false); setOpen(false); }
  };

  const submitRename = async (p: PickerProject) => {
    if (!draftName.trim() || draftName === p.name) { setRenaming(null); return; }
    await onRename?.(p, draftName.trim());
    setRenaming(null);
  };

  return (
    <div className="picker-row" ref={rootRef}>
      {showPersonal && (
        <button className={`cat-pill ${!activeId ? 'active' : ''}`} onClick={() => onSelect(null)}>
          Personal{counts.personal ? <span className="pill-count">{counts.personal}</span> : null}
        </button>
      )}

      {chips.map(p => (
        <button key={p._id} className={`cat-pill ${activeId === p._id ? 'active' : ''}`} onClick={() => onSelect(p)}>
          {p.name}{counts[p._id] ? <span className="pill-count">{counts[p._id]}</span> : null}
        </button>
      ))}

      <div style={{ position: 'relative' }}>
        <button className={`cat-pill picker-more ${open ? 'active' : ''}`} onClick={() => setOpen(o => !o)} title="All projects">
          <FolderOpen size={14} />
          {overflow > 0 ? `${overflow} more` : 'All'}
          <span style={{ opacity: 0.6, fontSize: '0.7rem' }}>▾</span>
        </button>

        {open && (
          <div className="picker-panel">
            <div className="picker-search">
              <Search size={15} style={{ opacity: 0.5, flexShrink: 0 }} />
              <input autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder="Search projects…" />
              {query && <button className="picker-x" onClick={() => setQuery('')}><X size={13} /></button>}
            </div>

            <div className="picker-list">
              {showPersonal && !query && (
                <button className={`picker-item ${!activeId ? 'on' : ''}`} onClick={() => { onSelect(null); reset(); }}>
                  <span className="picker-name">Personal</span>
                  <span className="picker-count">{counts.personal || 0}</span>
                </button>
              )}

              {filtered.length === 0 && (
                <p className="picker-empty">No project matches “{query}”.</p>
              )}

              {filtered.map(p => (
                <div key={p._id} className="picker-entry">
                <div className={`picker-item ${activeId === p._id ? 'on' : ''}`}>
                  {renaming === p._id ? (
                    <>
                      <input className="picker-rename" value={draftName} autoFocus
                        onChange={e => setDraftName(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') submitRename(p); if (e.key === 'Escape') setRenaming(null); }} />
                      <button className="picker-x" onClick={() => submitRename(p)}><Check size={14} /></button>
                    </>
                  ) : (
                    <>
                      <button className="picker-name" onClick={() => { onSelect(p); reset(); }}>{p.name}</button>
                      <span className="picker-count">{counts[p._id] || 0}</span>
                      <button className="picker-x" onClick={() => setMenuFor(menuFor === p._id ? null : p._id)} title="Project options">
                        <MoreHorizontal size={15} />
                      </button>
                    </>
                  )}

                </div>

                  {menuFor === p._id && (
                    <div className="picker-menu">
                      {/* Rename, invite and delete are all owner-only server-side. Showing them
                          to a member meant confirming a scary dialog and getting a toast. */}
                      {isOwner(p) ? (
                        <>
                          {onRename && (
                            <button onClick={() => { setRenaming(p._id); setDraftName(p.name); setMenuFor(null); }}>
                              <Pencil size={13} /> Rename
                            </button>
                          )}
                          {onInvite && (
                            <button onClick={() => { onSelect(p); onInvite(p); reset(); }}>
                              <UserPlus size={13} /> Invite someone
                            </button>
                          )}
                          {onDelete && (
                            <button className="danger" onClick={async () => {
                              const ok = await confirm({ title: `Delete “${p.name}”?`, message: 'Its tasks and meetings go with it. This cannot be undone.', danger: true, confirmLabel: 'Delete project' });
                              if (!ok) return;
                              await onDelete(p); setMenuFor(null); reset();
                            }}>
                              <Trash2 size={13} /> Delete project
                            </button>
                          )}
                        </>
                      ) : (
                        <span className="picker-menu-note">Shared with you · {ownerLabel(p)} manages it</span>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="picker-foot">
              {creating ? (
                <form onSubmit={submitCreate} style={{ display: 'flex', gap: '6px', width: '100%' }}>
                  <input className="picker-rename" autoFocus value={newName} placeholder="Project name"
                    onChange={e => setNewName(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') setCreating(false); }} />
                  <button type="submit" className="picker-x"><Check size={14} /></button>
                </form>
              ) : (
                <button onClick={() => setCreating(true)}><Plus size={14} /> New project</button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
