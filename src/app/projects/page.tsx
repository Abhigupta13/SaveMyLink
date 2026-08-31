'use client';

import { useState, useEffect, useCallback } from 'react';
import { hintFor } from '@/lib/nav';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Plus, Users, CheckSquare, Mic, FolderOpen } from 'lucide-react';
import { listProjects, createProject, getProjectStats } from '@/actions/project';
import { useFeedback } from '@/components/ui/Feedback';
import Loading from '@/components/ui/Loading';
import LoadError from '@/components/ui/LoadError';

export default function ProjectsPage() {
  const { toast } = useFeedback();
  const { status } = useSession();
  const router = useRouter();
  const [projects, setProjects] = useState<any[]>([]);
  const [stats, setStats] = useState<Record<string, { open: number; done: number; moms: number }>>({});
  const [loading, setLoading] = useState(true);
  // Distinct from "no projects": empty means empty, this means we could not find out.
  const [failed, setFailed] = useState(false);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    // listProjects, not getProjects: this grid draws a name and three counts, and the full
    // version also resolves a display name for every member of every group to render none of them.
    setFailed(false);
    try {
      const [p, s] = await Promise.all([listProjects(), getProjectStats()]);
      // The project list is the page. Stats are decoration on each card, so a stats failure
      // leaves the cards standing with zeroes rather than replacing the whole grid with an error.
      if (p.success) setProjects(p.projects || []);
      else setFailed(true);
      if (s.success) setStats(s.stats || {});
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (status === 'authenticated') load(); }, [status, load]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || creating) return;
    setCreating(true);
    const res = await createProject(name);
    setCreating(false);
    if (res.success) { setName(''); router.push(`/projects/${res.project._id}`); }
    else toast(res.error || 'Something went wrong', 'error');
  };

  if (status === 'unauthenticated') {
    return (
      <div className="container" style={{ padding: '80px 16px', textAlign: 'center' }}>
        <h2 className="page-title">Project groups</h2>
        <p className="page-subtitle" style={{ marginBottom: '24px' }}>Sign in to see your groups.</p>
        <Link href="/auth/signin" className="btn-primary" style={{ display: 'inline-block', padding: '12px 32px', borderRadius: '14px', fontWeight: 800 }}>Sign in</Link>
      </div>
    );
  }

  return (
    <div className="container" style={{ padding: '24px 16px 120px' }}>
      <header style={{ marginBottom: '18px' }}>
        {/* "Project groups" says what it is — people plus their work, not a list of projects.
            The nav stays the short "Projects": a rail label has no room to explain itself. */}
        <h1 className="page-title">Project groups</h1>
        <p className="page-subtitle">{projects.length ? `${projects.length} group${projects.length > 1 ? 's' : ''}` : 'Everything for one piece of work, and everyone on it, in one place'}</p>
      </header>

      <form onSubmit={handleCreate} className="quick-add" data-tour="project-add">
        <div className="quick-add-main">
          <input type="text" placeholder="New project…" value={name} onChange={e => setName(e.target.value)} />
          <button type="submit" className="btn-primary" disabled={!name.trim() || creating}
            style={{ padding: '9px 18px', borderRadius: '12px', fontWeight: 800, opacity: name.trim() ? 1 : 0.5, display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Plus size={15} /> Create
          </button>
        </div>
      </form>

      {loading ? (
        <Loading label="Loading your projects" />
      ) : failed ? (
        <LoadError what="your projects" onRetry={load} />
      ) : projects.length === 0 ? (
        <div className="empty-state">
          <p style={{ fontWeight: 800, marginBottom: '4px' }}>No projects yet</p>
          <p className="empty-hint">{hintFor('/projects')}</p>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Create one above to group tasks, meetings, notes and people together.</p>
        </div>
      ) : (
        <div className="project-grid">
          {projects.map(p => {
            const s = stats[p._id] || { open: 0, done: 0, moms: 0 };
            const people = new Set([p.ownerId?.email, ...(p.memberEmails || []), ...(p.viewerEmails || [])].filter(Boolean)).size;
            return (
              <Link key={p._id} href={`/projects/${p._id}`} className="project-card">
                <div className="project-card-icon"><FolderOpen size={18} /></div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="project-card-name">{p.name}</div>
                  <div className="project-card-meta">
                    <span><CheckSquare size={12} /> {s.open} open</span>
                    <span><Mic size={12} /> {s.moms}</span>
                    <span><Users size={12} /> {people}</span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
