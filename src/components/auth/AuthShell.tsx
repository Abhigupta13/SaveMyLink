import Link from 'next/link';
import Mark from '../brand/Mark';
import Wordmark from '../brand/Wordmark';

/* One frame for sign-in, sign-up and forgot-password: on a wide screen the landing's terracotta
   thesis sits beside the form; on a phone the brand sits above it. Literal colours inside the
   side panel — it is the same fixed-colour block as the landing hero in both themes. */
export default function AuthShell({ title, sub, children }: { title: string; sub?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="auth-shell">
      <aside className="auth-side" aria-hidden="true">
        <Link href="/" className="auth-side-logo"><Mark tone="inverse" size={36} />ALL <span>YOU NEED</span></Link>
        <div className="auth-side-body">
          <Mark tone="inverse" size={120} animate className="auth-side-mark" />
          <p className="auth-side-line">Record everything.<br /><em>Chase nobody.</em></p>
          <ul className="auth-side-nos">
            <li><b>NO</b> minutes to write</li>
            <li><b>NO</b> follow-up messages</li>
            <li><b>NO</b> “did you get to that?”</li>
          </ul>
        </div>
      </aside>
      <div className="auth-main">
        <Wordmark className="auth-brand" size={24} />
        <div className="auth-box">
          <h1 className="auth-h1">{title}</h1>
          {sub && <p className="auth-sub">{sub}</p>}
          {children}
        </div>
      </div>
    </div>
  );
}
