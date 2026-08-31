'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSession } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';
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
    // .catch, not a bare .then: a rejected promise skipped setLoading(false) entirely and left the
    // meetings page spinning for the rest of the session.
    getProjects().then(res => {
      const list = res.success ? res.projects || [] : [];
      setProjects(list);
      // Landing here without ?project means Personal — the transcript decides where items go
      const wanted = params.get('project');
      setActive(list.find((p: any) => p._id === wanted) || null);
    }).catch(() => {
      // The picker is a filter over meetings, not the meetings themselves — losing it should not
      // take the page down, so this leaves Personal selected rather than showing an error.
    }).finally(() => setLoading(false));
  }, [status, params]);

  // Personal meetings still need me in the assignee list
  const memberOptions = [...new Set([myEmail, active?.ownerId?.email, ...(active?.memberEmails || [])])].filter(Boolean);

  return (
    <div className="container" style={{ padding: '24px 16px 120px' }}>
      <header style={{ marginBottom: '20px' }}>
        <h1 className="page-title">Meetings</h1>
        <p className="page-subtitle">Record → transcribe → action items, routed to the right project</p>
      </header>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '60px' }}><div className="loading-spinner"></div></div>
      ) : (
        <>
          <div style={{ marginBottom: '20px' }}>
            <ProjectPicker
              projects={projects}
              activeId={active?._id || null}
              onSelect={p => setActive(p)}
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

          <p style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', fontWeight: 600, margin: '-10px 0 16px' }}>
            {active
              ? `Items default to ${active.name} — change any of them below before creating.`
              : 'Personal: every item is routed from what was said, and stays personal if no project fits.'}
          </p>

          <MomSection
            key={active?._id || 'personal'}
            project={active}
            projects={projects}
            myEmail={myEmail}
            memberOptions={memberOptions}
            onTasksCreated={() => {}}
          />
        </>
      )}
    </div>
  );
}

export default function MomPage() {
  const { toast, confirm } = useFeedback();
  return <Suspense fallback={null}><MomPageInner /></Suspense>;
}
