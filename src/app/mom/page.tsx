'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSession } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { getProjects } from '@/actions/project';
import MomSection from '@/components/MomSection';

function MomPageInner() {
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
    <div className="container" style={{ maxWidth: '640px', padding: '24px 16px 120px' }}>
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
          <div className="pill-row" style={{ marginBottom: '20px' }}>
            {projects.map(p => (
              <button key={p._id} className={`cat-pill ${active?._id === p._id ? 'active' : ''}`} onClick={() => setActive(p)}>
                {p.name}
              </button>
            ))}
          </div>
          {active && (
            <MomSection
              key={active._id}
              project={active}
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
  return <Suspense fallback={null}><MomPageInner /></Suspense>;
}
