import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Terms & your data · ALL YOU NEED',
  description: 'What we store, who can see it, and what happens to a recording or a document you upload.',
};

/**
 * Written to be read, not to be survived. Every claim here has to be one we can still stand behind
 * when someone checks — which is why the operator-access paragraph says what it says rather than
 * the friendlier thing. The in-app "Your data" page covers the same ground more gently.
 */
const SECTIONS: [string, string[]][] = [
  ['What this app is', [
    'ALL YOU NEED keeps your links, notes, tasks, meetings, documents and contacts in one place, on both the web and the Android app. The two are the same account and stay in sync.',
    'It is built for work and for the rest of your life equally. Nothing you save is assumed to be work.',
  ]],
  ['What is yours alone', [
    'By default everything you create belongs only to you. Other people using the app cannot see your links, notes, tasks, documents or contacts.',
    'A project is the only thing that changes this. Anything you put into a project becomes visible to the people on that project, and to nobody else. You choose who is on it.',
    'Items marked private, and anything in the Private Safe, are hidden behind your 4-digit PIN and are not shown in the normal view until you unlock it.',
  ]],
  ['What we can see', [
    'We host the app, so your data sits in a database we operate. Being straight about what that means: the Private Safe PIN hides content inside the app, but it is not encryption — someone with direct access to our servers could read what is stored, including private items, meeting transcripts and uploaded documents.',
    'We do not read your content, and we do not sell it, share it or use it to train anything. But we would rather tell you the limits of that promise than let you assume a stronger one.',
    'If you handle something you would not want any service operator to be able to read, keep it somewhere built for that.',
  ]],
  ['Meetings and AI features', [
    'When you record a meeting, the audio is sent to a speech-to-text provider to be transcribed and is not kept afterwards. The transcript and summary are stored in your account.',
    'Jarvis and the meeting summariser send the relevant parts of your own saved content to an AI provider to answer your question or produce a summary. Only what is needed for that request is sent.',
    'Providers we use for this are Google (Gemini), Groq and — for Hindi and Hinglish meetings — Sarvam AI. They process the request and return a result; your content is not used to train their models under the terms we use.',
    'If you supply your own API key for a paid transcription provider, that key is stored encrypted, never shown back to you in full, and never sent to your browser. Usage on your own key is billed to you directly by that provider, not by us, and you can revoke it from their dashboard at any time.',
  ]],
  ['Files and uploads', [
    'Documents and attachments are stored in private cloud storage. They are not publicly reachable — every download goes through the app and checks that you are allowed to see that file first.',
  ]],
  ['Email', [
    'We email you to confirm your address, to reset a password, when someone adds you to a project, and once to welcome you. We do not send marketing email.',
    'When you invite someone from your contacts, that email is only sent because you asked for it. We never email your contacts on our own.',
  ]],
  ['Your account', [
    'You can delete anything you have saved from inside the app. If you want your account and everything in it removed, ask us and we will do it.',
    'Deleting shared work inside a project is the project owner’s decision, so that one person tidying up cannot remove a teammate’s work.',
  ]],
  ['This will change', [
    'The app is early and actively being built. When something here changes in a way that matters — especially anything in "What we can see" — we will say so rather than quietly editing this page.',
  ]],
];

export default function TermsPage() {
  return (
    <div className="page narrow">
      <h1 style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '6px' }}>
        Terms &amp; your data
      </h1>
      <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '26px' }}>
        Plain language, no lawyer voice. If something here is unclear, use “Help us improve” in the app and ask.
      </p>

      {SECTIONS.map(([heading, paras]) => (
        <section key={heading} className="card" style={{ marginBottom: '14px' }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '10px' }}>{heading}</h2>
          {paras.map((text, i) => (
            <p key={i} style={{ fontSize: '0.88rem', lineHeight: 1.65, color: 'var(--text-secondary)', marginBottom: i === paras.length - 1 ? 0 : '10px' }}>
              {text}
            </p>
          ))}
        </section>
      ))}

      <p className="auth-foot" style={{ marginTop: '20px' }}>
        <Link href="/">Back to the app</Link> · <Link href="/download">Get the Android app</Link>
      </p>
    </div>
  );
}
