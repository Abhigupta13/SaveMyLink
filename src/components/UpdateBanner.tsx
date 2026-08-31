'use client';
import { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';
import { LATEST, updateAvailable, installedCode, dismissKey } from '@/lib/appRelease';

/**
 * Tells someone running the Android app that a newer APK exists, and what is in it.
 *
 * Only ever shows in the native shell. On the web there is nothing to update — the site IS the
 * latest version the moment it loads, which is also why most changes never need this at all: the
 * APK is a remote-URL shell and bundles no web assets, so only native changes (permissions,
 * plugins, the manifest, sign-in) require a reinstall.
 *
 * Three deliberate restraints, because the action being asked for is "download an APK and tap past
 * Android's harm warning" and that is not a prompt to spend lightly:
 *
 *  · It asks once per version. Dismissing 1.4 silences 1.4; 1.5 gets to ask again. A single global
 *    "don't show me" would turn the feature off forever on the first mildly-inconvenient day.
 *  · It never blocks. A card above the content, not a modal over it — nobody opening the app to
 *    check a task should have to deal with a release first.
 *  · It fails silent. No plugin, no version, an unreadable build number, an unavailable
 *    localStorage — all of it renders nothing. A banner that appears when it should not is worse
 *    than one that never appears, because it teaches people to tap through security warnings.
 */
export default function UpdateBanner() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const { Capacitor } = await import('@capacitor/core');
      if (!Capacitor.isNativePlatform()) return;      // the web is never out of date

      const { App } = await import('@capacitor/app');
      const info = await App.getInfo();
      const code = installedCode(info);
      if (code === null || !updateAvailable(code)) return;

      // A dismissal only silences the version it was aimed at.
      try {
        if (localStorage.getItem(dismissKey(LATEST.versionCode)) === '1') return;
      } catch {
        // Storage unavailable (private mode, blocked cookies). Asking again is the safe side here:
        // the alternative is never telling someone their sign-in is broken in an old build.
      }

      if (!cancelled) setShow(true);
    })().catch(() => {
      // No Capacitor, no App plugin, getInfo rejected — all of them mean "say nothing".
    });

    return () => { cancelled = true; };
  }, []);

  if (!show) return null;

  const dismiss = () => {
    try { localStorage.setItem(dismissKey(LATEST.versionCode), '1'); } catch { /* nothing to remember it with */ }
    setShow(false);
  };

  return (
    <section className="update-card" role="status" aria-label={`Version ${LATEST.versionName} is available`}>
      <div className="update-head">
        <span className="update-badge">Update</span>
        <strong className="update-title">Version {LATEST.versionName} is ready</strong>
        <button type="button" className="update-close" onClick={dismiss} aria-label="Not now">
          <X size={16} />
        </button>
      </div>

      <ul className="update-notes">
        {LATEST.notes.map(n => <li key={n}>{n}</li>)}
      </ul>

      <div className="update-actions">
        {/* A normal link to the download page rather than a direct APK hit: that page explains the
            install steps and Android's warning, which is the half people get stuck on. */}
        <a className="btn-primary update-go" href="/download">
          <Download size={16} /> Get the update
        </a>
        <button type="button" className="btn-ghost update-later" onClick={dismiss}>Not now</button>
      </div>
    </section>
  );
}
