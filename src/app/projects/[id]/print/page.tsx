import { redirect } from 'next/navigation';
import { getProjectWorkspace } from '@/actions/project';
import PrintProjectClient from './PrintProjectClient';

export const dynamic = 'force-dynamic';

export default async function PrintProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const res = await getProjectWorkspace(id);
  if (!res.success || !res.project) redirect(`/projects/${id}`);

  return (
    <PrintProjectClient
      project={res.project}
      tasks={res.tasks || []}
      moms={res.moms || []}
      notes={res.notes || []}
      files={res.documents || []}
    />
  );
}
