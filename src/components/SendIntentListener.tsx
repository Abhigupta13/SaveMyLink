'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { extractUrl } from '@/lib/url';
import { scheduleWeeklyDigest, registerNotificationTapHandler } from '@/lib/taskNotifications';
import { linksAddParams, stashPendingShare, takePendingShare } from '@/lib/shareIntent';

const safeDecode = (s?: string | null) => {
  if (!s) return '';
  try { return decodeURIComponent(s); } catch { return s; }
};

// Routes Android share-sheet intents to /links with the add form open.
export default function SendIntentListener() {
  const router = useRouter();
  const { status } = useSession();
  const pendingRef = useRef<{ url: string | null; title: string } | null>(null);

  useEffect(() => {
    if (status !== 'authenticated') return;
    scheduleWeeklyDigest().catch(() => {});
  }, [status]);

  const goToLinksAdd = (url: string | null, title: string) => {
    if (status === 'unauthenticated') {
      stashPendingShare({ url: url || '', title: title || undefined });
      router.push('/auth/signin');
      return;
    }
    if (status === 'loading') {
      pendingRef.current = { url, title };
      return;
    }
    router.push(`/links?${linksAddParams(url, title)}`);
  };

  useEffect(() => {
    if (status !== 'authenticated') return;
    if (pendingRef.current) {
      const { url, title } = pendingRef.current;
      pendingRef.current = null;
      if (!url) {
        const params = new URLSearchParams();
        if (title) params.set('title', title.slice(0, 2000));
        router.push(`/capture?${params.toString()}`);
      } else {
        router.push(`/links?${linksAddParams(url, title)}`);
      }
      return;
    }
    const pending = takePendingShare();
    if (pending) {
      if (!pending.url) {
        const params = new URLSearchParams();
        if (pending.title) params.set('title', pending.title.slice(0, 2000));
        router.push(`/capture?${params.toString()}`);
      } else {
        router.push(`/links?${linksAddParams(pending.url, pending.title || '')}`);
      }
    }
  }, [status, router]);

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
      if (!url) {
        if (status === 'unauthenticated') {
          stashPendingShare({ url: '', title: title || text.slice(0, 500) });
          router.push('/auth/signin');
          return;
        }
        if (status === 'loading') {
          pendingRef.current = { url: null, title: title || text.slice(0, 500) };
          return;
        }
        const params = new URLSearchParams();
        if (title || text) params.set('title', (title || text).slice(0, 2000));
        router.push(`/capture?${params.toString()}`);
        return;
      }
      goToLinksAdd(url, title);
    };

    handleIntent().catch(() => {});
    registerNotificationTapHandler((route) => router.push(route)).catch(() => {});
    window.addEventListener('sendIntentReceived', handleIntent);
    return () => {
      disposed = true;
      window.removeEventListener('sendIntentReceived', handleIntent);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- goToLinksAdd closes over status
  }, [router, status]);

  return null;
}
