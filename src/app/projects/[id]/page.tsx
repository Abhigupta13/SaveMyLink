import ProjectWorkspaceClient from './ProjectWorkspaceClient';

export default async function ProjectWorkspacePage(props: PageProps<'/projects/[id]'>) {
  const { id } = await props.params;
  return <ProjectWorkspaceClient projectId={id} />;
}
