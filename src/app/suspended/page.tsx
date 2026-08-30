import Link from 'next/link';
import { AlertCircle } from 'lucide-react';
import AuthShell from '@/components/auth/AuthShell';
import { adminEmails } from '@/lib/isAdmin';

/**
 * The one screen a suspended account can reach.
 *
 * Deliberately outside the proxy matcher and holding no session of its own: by the time somebody
 * lands here `auth.ts` has already refused them, so there is nothing to read about them and nothing
 * to leak. It is a static page and says the same words to anyone who types the URL.
 *
 * The whole reason this exists rather than a rejection on the sign-in form: a suspension is
 * reversible and usually a mistake or a conversation, so the screen has to carry the way back.
 * Someone told "incorrect password" for an account that was suspended will retry a working
 * password until they give up, and we never hear from them.
 *
 * Nothing here says WHY. The admin has one button and no reason field, so the honest answer is to
 * point at a human rather than invent a category.
 */
export const metadata = { title: 'Account suspended' };

export default function SuspendedPage() {
  // The list is the escape hatch for who runs this deploy; the first entry is who to write to.
  const contact = adminEmails()[0] || '';

  return (
    <AuthShell
      title="Your account is suspended"
      sub="You cannot sign in at the moment. Nothing has been deleted — your links, notes, tasks and meetings are all still there, and they come back with the account."
    >
      <div className="auth-banner error">
        <AlertCircle size={16} />
        <span>Access to this app has been paused for your account.</span>
      </div>

      <p className="auth-sub" style={{ marginTop: '14px' }}>
        If you think this is a mistake, ask us to review it and we will reopen the account. Write
        from the address you signed up with so we can find you.
      </p>

      {contact && (
        <a
          className="btn-primary auth-submit"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none' }}
          href={`mailto:${contact}?subject=${encodeURIComponent('Request to review a suspended account')}&body=${encodeURIComponent(
            'Hello,\n\nMy account has been suspended and I would like it reviewed.\n\nThe email I signed up with:\n\nWhat I think happened:\n\nThank you.',
          )}`}
        >
          Ask us to review this
        </a>
      )}

      <p className="auth-foot">
        {contact ? <>Or write to <strong>{contact}</strong> · </> : null}
        <Link href="/">Back to the home page</Link>
      </p>
    </AuthShell>
  );
}
