'use client';

import { useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { getMyOpenTasks } from '@/actions/task';
import { reconcile } from '@/lib/taskNotifications';
import type { ReminderChoice } from '@/lib/reminderRule';

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

  useEffect(() => {
    if (status !== 'authenticated') return;
    let disposed = false;
    getMyOpenTasks().then(res => {
      if (disposed || !res.success) return;
      reconcile(res.tasks || [], (res.reminderDefault as ReminderChoice) || null).catch(() => {});
    }).catch(() => {});
    return () => { disposed = true; };
  }, [status]);

  return null;
}
