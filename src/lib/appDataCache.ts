import { cacheInvalidateNamespace } from '@/lib/clientQueryCache';

/** Cache namespaces — one place for invalidation after writes. */
export const AppCacheNs = {
  expensesLedger: 'expenses-ledger',
  notesWorkspace: 'notes-workspace',
  tasksWorkspace: 'tasks-workspace',
  tasksList: 'tasks-list',
  projects: 'projects',
  moms: 'moms',
  search: 'search',
  tasksOpen: 'tasks-open',
  notifications: 'notifications',
  links: 'links',
  projectWorkspace: 'project-workspace',
} as const;

export function invalidateLinksCache(): void {
  cacheInvalidateNamespace(AppCacheNs.links);
}

export function invalidateExpensesCache(): void {
  cacheInvalidateNamespace(AppCacheNs.expensesLedger);
}

export function invalidateNotesCache(): void {
  cacheInvalidateNamespace(AppCacheNs.notesWorkspace);
}

export function invalidateTasksCache(): void {
  cacheInvalidateNamespace(AppCacheNs.tasksWorkspace);
  cacheInvalidateNamespace(AppCacheNs.tasksList);
  cacheInvalidateNamespace(AppCacheNs.tasksOpen);
}

export function invalidateProjectsCache(): void {
  cacheInvalidateNamespace(AppCacheNs.projects);
  cacheInvalidateNamespace(AppCacheNs.projectWorkspace);
  cacheInvalidateNamespace(AppCacheNs.tasksWorkspace);
  cacheInvalidateNamespace(AppCacheNs.notesWorkspace);
  cacheInvalidateNamespace(AppCacheNs.moms);
}

export function invalidateProjectWorkspaceCache(): void {
  cacheInvalidateNamespace(AppCacheNs.projectWorkspace);
}

export function invalidateMomsCache(): void {
  cacheInvalidateNamespace(AppCacheNs.moms);
}

export function invalidateSearchCache(): void {
  cacheInvalidateNamespace(AppCacheNs.search);
}

/** Private safe or sign-out — personal lists must refetch. */
export function invalidatePersonalDataCaches(): void {
  invalidateExpensesCache();
  invalidateNotesCache();
  invalidateTasksCache();
  invalidateMomsCache();
  invalidateSearchCache();
}
