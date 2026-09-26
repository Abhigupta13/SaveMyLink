'use client';

import { useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { getMyOpenTasks } from '@/actions/task';
import { reconcile } from '@/lib/taskNotifications';
import type { ReminderChoice } from '@/lib/reminderRule';
import { useUser } from '@/components/UserContext';
import { cacheIsFresh } from '@/lib/clientQueryCache';
import { getCachedOpenTasks, setCachedOpenTasks } from '@/lib/openTasksCache';

/**
 * Re-arm this account's reminders once per app open.
 *
 * Account switching cancels every pending notification on the device (they carry no user
 * binding, so A's task titles would otherwise fire on B's lock screen). Without this the new
 * account would then get no reminders at all until it happened to open /tasks, which is the only
 * place reconcile() was ever called from.
 *
 * It also fixes a bug that predates switching: someone who works from Projects and never visits
 * /tasks has never had a reminder scheduled. One server action per app open, and it cannot race
 * the weekly digest — id 1 is below SLOTS, which reconcile's orphan sweep skips.
 */
export default function ReminderBootstrap() {
  const { status } = useSession();
  const { privateSafe } = useUser();

  useEffect(() => {
    if (status !== 'authenticated') return;
    let disposed = false;
    const run = (tasks: Parameters<typeof reconcile>[0], def: ReminderChoice | null) => {
      reconcile(tasks, def).catch(() => {});
    };

    const cached = getCachedOpenTasks(privateSafe);
    if (cached && cacheIsFresh(cached.fetchedAt)) {
      run(cached.data.tasks as Parameters<typeof reconcile>[0], (cached.data.reminderDefault as ReminderChoice) || null);
      return;
    }

    getMyOpenTasks().then(res => {
      if (disposed || !res.success) return;
      setCachedOpenTasks(privateSafe, {
        tasks: res.tasks || [],
        reminderDefault: res.reminderDefault as ReminderChoice | null,
      });
      run((res.tasks || []) as Parameters<typeof reconcile>[0], (res.reminderDefault as ReminderChoice) || null);
    }).catch(() => {});
    return () => { disposed = true; };
  }, [status, privateSafe]);

  return null;
}
