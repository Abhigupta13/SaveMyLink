import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Terms and conditions · ALL YOU NEED',
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
    'We host the app, so your links, notes, tasks, contacts, meeting transcripts and group chat messages sit in a database we operate. Being straight about what that means: the Private Safe PIN hides content inside the app, but it is not encryption — someone with direct access to our servers could read what is stored, including the items you marked private.',
    'Uploaded files are the one exception, and deliberately so — they are not in our database at all. See “Files and uploads” below.',
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
    'Files you upload — documents in the Digi Locker, attachments on a note, anything sent in a group chat — are not stored on our servers. They go into your own Google Drive, in a folder called ALL-YOU-NEED, under your Google account and against your storage. You connect that Drive yourself and you can disconnect it whenever you like.',
    'We ask Google for the narrowest access it offers: permission to see and manage only the files this app itself creates. The rest of your Drive is invisible to us. We cannot read a document you saved there before you connected, and we cannot see one you saved somewhere else afterwards.',
    'Opening a file still goes through the app — we fetch it from the uploader’s Drive and check you are allowed to see it first. That is what lets a teammate who signed up with a password, and has no Google account at all, open a file shared with their group. It also means access stops the moment somebody is removed from that group.',
    'A file you add to a group is also shared to your group-mates’ Google Drive accounts, so it shows up in their Drive as well as in the app. That is a convenience on top of the above, not the thing that makes it work — nobody needs it to open the file here. If someone later leaves the group they lose access in this app straight away, but the copy already shared to their Drive stays with them. You can take that back yourself, whenever you like, from that file’s sharing settings in your own Drive.',
    'Deleting a file here moves it to your Google Drive trash rather than destroying it, so you have thirty days to change your mind in an app we do not control. We only ever delete from the Drive of the person who uploaded the file — a group-mate can remove a file from a note, but cannot reach into your Drive and destroy your copy.',
    'The honest claim is that your files are yours and you can walk away with them, not that we cannot see them. We hold a token that can fetch a file when somebody opens it. What changed is that we no longer hold the file.',
    'One consequence worth knowing before you rely on it: the Private Safe hides a document inside this app, but the file itself sits in your Google Drive in plain view of anyone who opens that Google account. The PIN is a lock on the app, not on the file.',
  ]],
  ['Email', [
    'We email you to confirm your address, to reset a password, when someone adds you to a project, and once to welcome you. We do not send marketing email.',
    'When you invite someone from your contacts, that email is only sent because you asked for it. We never email your contacts on our own.',
  ]],
  ['Your account', [
    'You can delete anything you have saved from inside the app. If you want your account and everything in it removed, ask us and we will do it.',
    'When you delete your account we erase your content immediately and keep only your name and email for up to 90 days for our records, then erase those too. Anything you added to a group stays with that group — it is the group’s record, not only yours.',
    'Deleting shared work inside a project is the project owner’s decision, so that one person tidying up cannot remove a teammate’s work.',
    'Files you uploaded are moved to your Google Drive’s trash, where Google gives you thirty days to recover them before removing them for good. They were always in your account, so deleting this one does not take them from you.',
  ]],
  ['This will change', [
    'The app is early and actively being built. When something here changes in a way that matters — especially anything in "What we can see" — we will say so rather than quietly editing this page.',
  ]],
];

export default function TermsPage() {
  return (
    <div className="page narrow">
      <h1 style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '6px' }}>
        Terms and conditions
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
        <Link href="/">Back to the app</Link> · <Link href="/your-data">Who can see my data</Link> · <Link href="/download">Get the Android app</Link>
      </p>
    </div>
  );
}
