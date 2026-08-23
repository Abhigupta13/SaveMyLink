'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSession } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { getProjects, createProject, deleteProject, renameProject } from '@/actions/project';
import ProjectPicker from '@/components/ProjectPicker';
import MomSection from '@/components/MomSection';
import { useFeedback } from '@/components/ui/Feedback';

function MomPageInner() {
  const { toast } = useFeedback();
  const { data: session, status } = useSession();
  const params = useSearchParams();
  const [projects, setProjects] = useState<any[]>([]);
  const [active, setActive] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const myEmail = (session?.user?.email || '').toLowerCase();

  useEffect(() => {
    if (status !== 'authenticated') return;
    getProjects().then(res => {
      const list = res.success ? res.projects || [] : [];
      setProjects(list);
      const wanted = params.get('project');
      setActive(list.find((p: any) => p._id === wanted) || list[0] || null);
      setLoading(false);
    });
  }, [status, params]);

  const memberOptions = active
    ? [...new Set([myEmail, active.ownerId?.email, ...(active.memberEmails || [])])].filter(Boolean)
    : [];

  return (
    <div className="container" style={{ padding: '24px 16px 120px' }}>
      <header style={{ marginBottom: '20px' }}>
        <h1 className="page-title">Meetings</h1>
        <p className="page-subtitle">Record → transcribe → action items, filed under a project</p>
      </header>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '60px' }}><div className="loading-spinner"></div></div>
      ) : projects.length === 0 ? (
        <div className="empty-state">
          <p style={{ fontWeight: 700, marginBottom: '8px' }}>Meetings belong to a project.</p>
          <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '16px' }}>Create your first project in Tasks, then come back to record.</p>
          <Link href="/tasks" className="btn-primary" style={{ display: 'inline-block', padding: '12px 24px', borderRadius: '14px', fontWeight: 800 }}>Go to Tasks</Link>
        </div>
      ) : (
        <>
          <div style={{ marginBottom: '20px' }}>
            <ProjectPicker
              projects={projects}
              activeId={active?._id || null}
              showPersonal={false}
              onSelect={p => p && setActive(p)}
              onCreate={async (name) => {
                const res = await createProject(name);
                if (res.success) { const list = [...projects, res.project]; setProjects(list); setActive(res.project); }
                else toast(res.error || 'Something went wrong', 'error');
                return res;
              }}
              onRename={async (proj, name) => {
                const res = await renameProject(proj._id, name);
                if (res.success) {
                  setProjects(ps => ps.map(x => x._id === proj._id ? { ...x, name } : x));
                  if (active?._id === proj._id) setActive({ ...active, name });
                } else toast(res.error || 'Something went wrong', 'error');
                return res;
              }}
              onDelete={async (proj) => {
                const res = await deleteProject(proj._id);
                if (res.success) {
                  const rest = projects.filter(x => x._id !== proj._id);
                  setProjects(rest);
                  if (active?._id === proj._id) setActive(rest[0] || null);
                } else toast(res.error || 'Something went wrong', 'error');
                return res;
              }}
            />
          </div>

          {active && (
            <MomSection
              key={active._id}
              project={active}
              projects={projects}
              myEmail={myEmail}
              memberOptions={memberOptions}
              onTasksCreated={() => {}}
            />
          )}
        </>
      )}
    </div>
  );
}

export default function MomPage() {
  const { toast, confirm } = useFeedback();
  return <Suspense fallback={null}><MomPageInner /></Suspense>;
}
