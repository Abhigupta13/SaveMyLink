import Link from 'next/link';
import SarvamKeyCard from '@/components/SarvamKeyCard';
import '@/styles/guide.css';

export const metadata = { title: 'Your own Sarvam key · ALL YOU NEED' };

/**
 * How to get a Sarvam key, and where to put it. Nothing on this page reads or writes the key —
 * that is entirely SarvamKeyCard talking to src/actions/sarvamKey.ts, which seals it with
 * lib/secretBox before storage and only ever hands back the last four characters.
 */
export default function SarvamKeyPage() {
  return (
    <div className="page narrow guide">
      <header className="g-head">
        <p className="g-eyebrow">Meetings · Hindi</p>
        <h1>Your own Sarvam key</h1>
        <p className="g-lede">
          Hindi and Hinglish meetings already work, free. A key of your own from Sarvam swaps in a
          sharper engine — better with names, better on long meetings. You pay Sarvam directly;
          nothing about it is billed by us.
        </p>
      </header>

      <div className="g-chapter">
        <span className="g-word">Four steps</span>
        <h2>Getting one takes a few minutes</h2>
      </div>

      <div className="g-card">
        <ol className="g-rail">
          <li className="g-stop">
            <span className="g-n" aria-hidden="true">1</span>
            <span>
              <b>Make a Sarvam account</b>
              <span>
                Sign up at <a href="https://dashboard.sarvam.ai" target="_blank" rel="noopener noreferrer">dashboard.sarvam.ai</a>.
                It is their service, not ours — the account, the card and the invoices are all yours.
              </span>
            </span>
          </li>
          <li className="g-stop">
            <span className="g-n" aria-hidden="true">2</span>
            <span>
              <b>Create an API key</b>
              <span>
                In the dashboard, open API keys and create one. Copy it straight away: Sarvam shows a
                new key once, and there is no way to read it back afterwards.
              </span>
            </span>
          </li>
          <li className="g-stop">
            <span className="g-n" aria-hidden="true">3</span>
            <span>
              <b>Paste it here</b>
              <span>
                We seal it before it is stored and never show it to a browser again — not even to
                yours. From then on this screen knows only the last four characters.
              </span>
              <SarvamKeyCard />
            </span>
          </li>
          <li className="g-stop">
            <span className="g-n" aria-hidden="true">4</span>
            <span>
              <b>Know what it costs</b>
              <span>
                Sarvam charges by the minute of audio, pay as you go, at whatever their current rate
                is — check their pricing before you paste a key. Every meeting you record from then
                on is billed by Sarvam to your Sarvam account. We never see a payment and never take
                a cut.
              </span>
            </span>
          </li>
        </ol>
      </div>

      <div className="g-chapter">
        <span className="g-word">Also worth knowing</span>
        <h2>Stopping, and what we store</h2>
      </div>

      <div className="g-card">
        <h3>Turning it off</h3>
        <p>
          Remove the key here and your meetings go straight back to the free engine — nothing you
          have already recorded changes. That deletes our copy, not the key itself: it stays live on
          Sarvam until you revoke it in their dashboard, so do that too if you want it dead.
        </p>
      </div>

      <div className="g-card">
        <h3>You may not need one</h3>
        <p>
          Some accounts have been granted the upgraded engine on our own key. If Hindi meetings
          already sound sharp to you, that is probably why — and a key of your own would only start
          charging you for something you already have.
        </p>
      </div>

      <div className="g-card">
        <h3>What we do with the key</h3>
        <p>
          It is encrypted before it touches the database, so a leaked backup is not a set of live
          credentials. It is used for one thing: transcribing the meetings you record. The same
          promise, in the same words as the rest of it, is under &ldquo;Meetings and AI
          features&rdquo; in the <Link href="/terms">terms</Link>.
        </p>
      </div>

      <p className="g-foot">
        <Link href="/profile">Back to profile</Link>
        <Link href="/terms">Terms and conditions</Link>
        <Link href="/your-data">Who can see my data</Link>
      </p>
    </div>
  );
}
