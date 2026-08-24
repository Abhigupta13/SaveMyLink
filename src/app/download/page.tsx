import Link from 'next/link';
import type { Metadata } from 'next';
import QRCode from 'qrcode';
import { appUrl } from '@/lib/url';
import { Download, ShieldQuestion, Share2, Bell, Smartphone } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Get the app · ALL YOU NEED',
  description: 'Install the Android app — save from any app, get reminders, record meetings.',
};

// public/app-debug.apk. Served straight by Next, and already excluded from the auth proxy so the
// link works for someone who has never signed in — which is the entire point of sending it.
const APK = '/app-debug.apk';

const WHY: [typeof Share2, string, string][] = [
  [Share2, 'Save from any app', 'Share a link from your browser, WhatsApp, anywhere — it lands in your vault with the title and thumbnail already filled in.'],
  [Bell, 'Reminders that reach you', 'Tasks with a due time notify your phone — a day before, an hour before, at the deadline, then every morning until it is done.'],
  [Smartphone, 'Record a meeting', 'Hit record, get a summary and the action items pulled out. Works with Hindi and Hinglish.'],
];

// Straight from android/app/src/main/AndroidManifest.xml — if that file changes, change this.
const PERMISSIONS: [string, string][] = [
  ['Internet', 'Loads your vault. Without it the app is a blank screen.'],
  ['Microphone', 'Only while you are recording a meeting or talking to Jarvis.'],
  ['Notifications & alarms', 'So a task reminder arrives at the time you set, not whenever the phone wakes up.'],
  ['Start after restart', 'Re-arms your pending reminders when the phone reboots.'],
  ['Receive shared links', 'Lets other apps send a link here through the share sheet.'],
];

const STEPS = [
  'Tap Download the app below. Your browser may warn that this kind of file can harm your device — that warning appears for every app not installed from the Play Store. Choose Download anyway.',
  'Open the downloaded file. Android will ask whether to allow installs from this source; turn it on for your browser, then come back and tap Install.',
  'Open the app and sign in with the same account you use on the website — everything is already there.',
  'On first run, allow notifications, and enable “Alarms & reminders” when it asks. Without that, reminders arrive late.',
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

export default async function DownloadPage() {
  const base = appUrl();
  const qr = base ? await qrSvg(`${base}/download`) : null;

  return (
    <div className="page narrow">
      <h1 style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '6px' }}>
        Get the Android app
      </h1>
      <p style={{ fontSize: '0.9rem', lineHeight: 1.6, color: 'var(--text-secondary)', marginBottom: '22px' }}>
        Everything works in your browser too — the app adds the things a website cannot do on a phone.
        On iPhone, open the website and add it to your home screen; it is the same account.
      </p>

      <a href={APK} download className="btn-primary" style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px',
        height: '52px', borderRadius: '14px', fontWeight: 800, fontSize: '1rem',
        textDecoration: 'none', marginBottom: '10px',
      }}>
        <Download size={19} /> Download the app
      </a>
      <p style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', textAlign: 'center', marginBottom: qr ? '20px' : '26px' }}>
        Android 7 or newer · about 5 MB
      </p>

      {qr && (
        <div className="download-qr">
          <div className="download-qr-code" dangerouslySetInnerHTML={{ __html: qr }} />
          <p>Point a phone camera here to open this page on it</p>
        </div>
      )}

      <div className="card" style={{ marginBottom: '14px' }}>
        <h2 style={{ fontSize: '1rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '14px' }}>What the app adds</h2>
        {WHY.map(([Icon, title, text]) => (
          <div key={title} style={{ display: 'flex', gap: '12px', marginBottom: '14px' }}>
            <span className="row-icon top"><Icon size={18} strokeWidth={2.2} /></span>
            <span>
              <span style={{ display: 'block', fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)' }}>{title}</span>
              <span style={{ display: 'block', fontSize: '0.83rem', lineHeight: 1.55, color: 'var(--text-secondary)' }}>{text}</span>
            </span>
          </div>
        ))}
      </div>

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

      {/* The question everyone actually asks at the warning screen. Answered with what the app
          can reach and what it cannot — checkable facts beat "trust us", and the honest line
          about Google not having reviewed it is what makes the rest believable. */}
      <div className="card">
        <h2 style={{ fontSize: '1rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '10px' }}>Is it safe?</h2>

        <p style={{ fontSize: '0.86rem', lineHeight: 1.65, color: 'var(--text-secondary)', marginBottom: '10px' }}>
          The warning is about <strong style={{ color: 'var(--text-primary)' }}>where the file came from, not what is in it</strong>.
          Android shows it for every app installed outside the Play Store. Being straight with you:
          Google has not reviewed this app, so Android cannot vouch for it.
        </p>
        <p style={{ fontSize: '0.86rem', lineHeight: 1.65, color: 'var(--text-secondary)', marginBottom: '14px' }}>
          What you can check instead — this is everything the app asks for:
        </p>

        <ul className="perm-list">
          {PERMISSIONS.map(([what, why]) => (
            <li key={what}>
              <span className="perm-what">{what}</span>
              <span className="perm-why">{why}</span>
            </li>
          ))}
        </ul>

        <p style={{ fontSize: '0.86rem', lineHeight: 1.65, color: 'var(--text-secondary)', margin: '14px 0 10px' }}>
          It never asks for your contacts, photos, location, messages or call log — it cannot read them.
          Android still sandboxes the app, and Play Protect still scans it after installing.
        </p>
        <p style={{ fontSize: '0.86rem', lineHeight: 1.65, color: 'var(--text-secondary)', margin: 0 }}>
          A Play Store listing is on the way, and this page will point there once it is live. If you
          would rather wait, the website does everything except share-to-save and reminders.
        </p>
      </div>

      <p className="auth-foot" style={{ marginTop: '20px' }}>
        <Link href="/">Open the web app</Link> · <Link href="/terms">How your data is handled</Link>
      </p>
    </div>
  );
}
