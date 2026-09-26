'use client';

import { useEffect } from 'react';
import ProjectReportView from '@/components/ProjectReportView';

export default function PrintProjectClient({
  project,
  tasks,
  moms,
  notes,
  files,
}: {
  project: any;
  tasks: any[];
  moms: any[];
  notes: any[];
  files: any[];
}) {
  useEffect(() => {
    const t = window.setTimeout(() => window.print(), 400);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <div className="project-print-page">
      <div className="print-only project-print-visible">
        <ProjectReportView
          project={project}
          tasks={tasks}
          moms={moms}
          notes={notes}
          files={files}
          aboutText={project.notes}
        />
      </div>
    </div>
  );
}
