import Link from 'next/link';
import type { Metadata } from 'next';
import QRCode from 'qrcode';
import { shareUrl } from '@/lib/url';
import { Download, ShieldQuestion } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Get the app · ALL YOU NEED',
  description: 'Install the Android app — save from any app, get reminders, record meetings.',
};

/**
 * Rendered once at build time, not per request.
 *
 * Nothing here varies by visitor: the QR encodes a constant, and the size and version are read off
 * disk from files that only change when the APK is rebuilt — which is a deploy. Prerendering also
 * means the two filesystem reads below happen once, in the build, where the repository is
 * definitely present, rather than once per visitor inside a function bundle whose contents are a
 * build detail nobody here controls.
 *
 * The page is reachable signed-out, so this is also the version a stranger following a shared link
 * gets: a static file, no function invocation.
 */
export const dynamic = 'force-static';

// public/app-debug.apk. Served straight by Next, and already excluded from the auth proxy so the
// link works for someone who has never signed in — which is the entire point of sending it.
const APK = '/app-debug.apk';

/**
 * Measured, not typed in. This line read "about 5 MB" while the file was 8.5 MB, because the number
 * was written once and the APK was rebuilt afterwards. Anything a page claims about a file it links
 * to should be read from the file, or it is only true until the next build.
 *
 * Falls back to saying nothing rather than guessing: on a deploy where the APK is somehow missing,
 * a silent omission beats a confident wrong number, and the download link failing is the louder
 * signal anyway.
 */
async function apkSize(): Promise<string | null> {
  try {
    const { statSync } = await import('fs');
    const { join } = await import('path');
    const bytes = statSync(join(process.cwd(), 'public', 'app-debug.apk')).size;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  } catch {
    return null;
  }
}

/**
 * What the file is called once it lands in someone's Downloads folder.
 *
 * Gradle names its output app-debug.apk and there is no reason to fight that — `cap sync` and
 * assembleDebug regenerate it every build, so renaming the file on disk would be a manual step
 * somebody forgets. The `download` attribute renames the copy the browser saves instead.
 *
 * It matters more than it looks. "debug" arrives at the exact moment Android is already warning
 * that this kind of file can harm your device, and this page is busy telling the person to
 * continue anyway — a filename that says "debug" argues the other side. The version is there so
 * "which build are you on?" has an answer, and so a stale APK sitting in Downloads cannot be
 * reinstalled over a newer one by mistake.
 */
async function apkFileName(): Promise<string> {
  try {
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    const gradle = readFileSync(join(process.cwd(), 'android', 'app', 'build.gradle'), 'utf8');
    const version = gradle.match(/versionName\s+"([^"]+)"/)?.[1];
    return version ? `ALLyouneed-${version}.apk` : 'ALLyouneed.apk';
  } catch {
    return 'ALLyouneed.apk';
  }
}

// Straight from android/app/src/main/AndroidManifest.xml — if that file changes, change this.
const PERMISSIONS: [string, string][] = [
  ['Internet', 'Loads your vault. Without it the app is a blank screen.'],
  ['Microphone', 'Only while you are recording a meeting or talking to Jarvis.'],
  ['Notifications & alarms', 'So a task reminder arrives at the time you set, not whenever the phone wakes up.'],
  ['Start after restart', 'Re-arms your pending reminders when the phone reboots.'],
  ['Receive shared links', 'Lets other apps send a link here through the share sheet.'],
];

const STEPS = [
  // This one is first because it is the step that fails silently. Older copies of the app were
  // signed with a key on one laptop; every build now uses a shared key, and Android refuses to
  // install over an app signed by a different one. The refusal reads "App not installed", which
  // sounds like a broken download and sends people back to try the same thing again.
  'Already have it installed? Uninstall the old one first. This build is signed with a new key, and Android refuses to install over the old one — it just says "App not installed". Nothing is lost; your account lives on the server.',
  'Tap Download the app. Your browser may warn that this kind of file can harm your device — that appears for every app not from the Play Store. Choose Download anyway.',
  'Open the downloaded file. Android will ask whether to allow installs from this source; turn it on for your browser, then come back and tap Install.',
  'Open the app and sign in with the same account you use here.',
  'Allow notifications, and enable “Alarms & reminders” when it asks. Without that, reminders arrive late.',
];

/**
 * Rendered on the server, so the encoder never reaches the browser bundle. currentColor lets the
 * one SVG work in both themes instead of shipping a light and a dark PNG.
 */
async function qrSvg(url: string) {
  try {
    const svg = await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
    return svg.replace(/#000000|#000/gi, 'currentColor').replace(/#ffffff|#fff/gi, 'transparent');
  } catch {
    return null;   // a missing QR is not worth failing the page a stranger is trying to install from
  }
}

/**
 * Deliberately short. Everything here does a job for somebody mid-install: the button, the QR that
 * carries a desktop visitor to their phone, the two warnings Android is about to show them, and the
 * list of what the app can reach. The feature pitch that used to sit between the button and the
 * steps has gone — anyone reading this page has already decided, and it only pushed the part they
 * actually needed further down.
 */
export default async function DownloadPage() {
  const base = shareUrl();
  const qr = base ? await qrSvg(`${base}/download`) : null;
  const size = await apkSize();
  const fileName = await apkFileName();

  return (
    <div className="page narrow">
      <h1 style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '6px' }}>
        Get the Android app
      </h1>
      <p style={{ fontSize: '0.9rem', lineHeight: 1.6, color: 'var(--text-secondary)', marginBottom: '22px' }}>
        It adds what a website cannot do on a phone: share-to-save from any app, and reminders that
        reach you. On iPhone, add the website to your home screen — same account.
      </p>

      <a href={APK} download={fileName} className="btn-primary" style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px',
        height: '52px', borderRadius: '14px', fontWeight: 800, fontSize: '1rem',
        textDecoration: 'none', marginBottom: '10px',
      }}>
        <Download size={19} /> Download the app
      </a>
      <p style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', textAlign: 'center', marginBottom: qr ? '20px' : '26px' }}>
        Android 7 or newer{size ? ` · ${size}` : ''}
      </p>

      {qr && (
        <div className="download-qr">
          <div className="download-qr-code" dangerouslySetInnerHTML={{ __html: qr }} />
          <p>Point a phone camera here to open this page on it</p>
        </div>
      )}

      {/* The install warnings are the whole reason this page exists — someone who is not technical
          hits two scary dialogs and stops. Naming them in advance is what gets the app installed. */}
      <div className="card" style={{ marginBottom: '14px' }}>
        <h2 style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '1rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '12px' }}>
          <ShieldQuestion size={17} /> Installing it, step by step
        </h2>
        <ol style={{ paddingLeft: '20px', margin: 0 }}>
          {STEPS.map((step, i) => (
            <li key={i} style={{ fontSize: '0.86rem', lineHeight: 1.65, color: 'var(--text-secondary)', marginBottom: i === STEPS.length - 1 ? 0 : '10px' }}>
              {step}
            </li>
          ))}
        </ol>
      </div>

      {/* The question everyone actually asks at the warning screen. Answered with what the app can
          reach and what it cannot — checkable facts beat "trust us", and the honest line about
          Google not having reviewed it is what makes the rest believable. */}
      <div className="card">
        <h2 style={{ fontSize: '1rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '10px' }}>Is it safe?</h2>

        <p style={{ fontSize: '0.86rem', lineHeight: 1.65, color: 'var(--text-secondary)', marginBottom: '14px' }}>
          The warning is about <strong style={{ color: 'var(--text-primary)' }}>where the file came from, not what is in it</strong> —
          Android shows it for every app installed outside the Play Store. Being straight with you:
          Google has not reviewed this app. Here is everything it asks for.
        </p>

        <ul className="perm-list">
          {PERMISSIONS.map(([what, why]) => (
            <li key={what}>
              <span className="perm-what">{what}</span>
              <span className="perm-why">{why}</span>
            </li>
          ))}
        </ul>

        <p style={{ fontSize: '0.86rem', lineHeight: 1.65, color: 'var(--text-secondary)', margin: '14px 0 0' }}>
          It never asks for your contacts, photos, location, messages or call log — it cannot read
          them. Android still sandboxes the app, and Play Protect still scans it after installing.
        </p>
      </div>

      <p className="auth-foot" style={{ marginTop: '20px' }}>
        <Link href="/">Open the web app</Link> · <Link href="/terms">Terms and conditions</Link>
      </p>
    </div>
  );
}
