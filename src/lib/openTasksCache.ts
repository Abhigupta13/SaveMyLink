import { cacheGet, cacheSet } from '@/lib/clientQueryCache';
import { AppCacheNs } from '@/lib/appDataCache';
import type { ReminderChoice } from '@/lib/reminderRule';

export type CachedOpenTasks = {
  tasks: unknown[];
  reminderDefault?: ReminderChoice | null;
};

export function openTasksCacheKey(privateSafe: boolean): string {
  return privateSafe ? 'safe' : 'open';
}

export function getCachedOpenTasks(privateSafe: boolean) {
  return cacheGet<CachedOpenTasks>(AppCacheNs.tasksOpen, openTasksCacheKey(privateSafe));
}

export function setCachedOpenTasks(privateSafe: boolean, payload: CachedOpenTasks): void {
  cacheSet(AppCacheNs.tasksOpen, openTasksCacheKey(privateSafe), payload);
}
