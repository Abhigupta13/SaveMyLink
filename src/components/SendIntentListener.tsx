'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { extractUrl } from '@/lib/url';
import { scheduleWeeklyDigest, registerNotificationTapHandler } from '@/lib/taskNotifications';

const safeDecode = (s?: string | null) => {
  if (!s) return '';
  try { return decodeURIComponent(s); } catch { return s; }
};

// Routes Android share-sheet intents (send-intent plugin) to /capture.
// Handles both cold start (checkSendIntentReceived on mount) and warm shares
// (the plugin fires a 'sendIntentReceived' window event).
export default function SendIntentListener() {
  const router = useRouter();
  const { status } = useSession();

  // The digest is a notification about YOUR week, so it belongs to a signed-in person. It used
  // to be scheduled on every app open including a signed-out visitor's, which put a weekly
  // reminder on the phone of someone with no account to remind them about.
  useEffect(() => {
    if (status !== 'authenticated') return;
    scheduleWeeklyDigest().catch(() => {});
  }, [status]);

  useEffect(() => {
    let disposed = false;

    const handleIntent = async () => {
      const { Capacitor } = await import('@capacitor/core');
      if (!Capacitor.isNativePlatform()) return;
      const { SendIntent } = await import('@mindlib-capacitor/send-intent');
      const result = await SendIntent.checkSendIntentReceived().catch(() => null);
      if (disposed || !result) return;

      const text = [result.url, result.title, (result as any).description]
        .map(safeDecode).filter(Boolean).join('\n');
      if (!text) return;

      const url = extractUrl(text);
      const title = safeDecode(result.title) || text.replace(url || '', '').trim();
      const params = new URLSearchParams();
      if (url) params.set('url', url);
      if (title && title !== url) params.set('title', title.slice(0, 300));
      router.push(`/capture?${params.toString()}`);
    };

    handleIntent().catch(() => {});
    registerNotificationTapHandler((route) => router.push(route)).catch(() => {});
    window.addEventListener('sendIntentReceived', handleIntent);
    return () => {
      disposed = true;
      window.removeEventListener('sendIntentReceived', handleIntent);
    };
  }, [router]);

  return null;
}
