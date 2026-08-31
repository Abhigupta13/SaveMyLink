import NextLink from 'next/link';
import type { CSSProperties } from 'react';
import { PUNCTUAL_DAYS, type Punctuality as Stats } from '@/lib/punctuality';

/**
 * How punctual you are, under the vault tiles on Home.
 *
 * A dial for the one figure, three counts for what it is made of — the same shape the admin
 * dashboard uses for its hero, because a percentage nobody can decompose is a percentage nobody
 * believes. Every task in the score lands in exactly one of the three tiles, so the numbers add up
 * on screen and the user can check them.
 *
 * Deliberately drawn in its own `.pun-*` classes rather than by importing styles/admin.css: that
 * sheet is the admin screen's, scoped under `.adm`, and shipping the whole of it to the one page
 * every person opens to borrow a dial would be the wrong trade.
 *
 * The circle is r=40, so its circumference is 2π·40 ≈ 251.3 — handed to CSS as `--c` with the
 * fraction as `--p`, which keeps the arc maths in the stylesheet and the numbers here honest.
 */

const CIRCUMFERENCE = 251.3;

export default function Punctuality({ stats }: { stats: Stats }) {
  const { onTime, late, missed, scored, rate } = stats;

  return (
    <section className="pun" aria-labelledby="pun-h">
      <div className="dg-head">
        <span className="dg-label" id="pun-h">How punctual you are</span>
        <span className="pun-window">Last {PUNCTUAL_DAYS} days</span>
      </div>

      {/* Nothing to score is not a score of zero, and drawing an empty dial would say it was. Anyone
          who has never put a date on a task lands here, which on a fresh account is everyone. */}
      {scored === 0 ? (
        <p className="dg-empty">
          No deadlines to judge yet. Give a task a due date and this fills in as you tick things off —{' '}
          <NextLink href="/tasks" className="subtle-link">open your tasks</NextLink>.
        </p>
      ) : (
        <div className="pun-body">
          <figure className="pun-dial">
            <svg viewBox="0 0 96 96" aria-hidden="true" style={{ '--c': CIRCUMFERENCE, '--p': rate / 100 } as CSSProperties}>
              <circle className="track" cx="48" cy="48" r="40" />
              <circle className="val" cx="48" cy="48" r="40" />
            </svg>
            <figcaption>
              <span className="pun-pct">{rate}%</span>
              <span className="pun-cap">on time</span>
            </figcaption>
          </figure>

          {/* The whole score, spelled out. Read together they are the sentence the dial is short for:
              of N deadlines in the last month, this many were met, this many slipped, this many are
              still sitting there. */}
          <div className="pun-kpis">
            {[
              { label: 'Finished on time', value: onTime, tone: '' },
              // Both of these are late work, and late work is amber everywhere in this app — the
              // same rule the digest's due dates follow. Only the met deadline gets the accent, or
              // the panel colours a miss and a hit identically and says nothing at a glance.
              { label: 'Finished late', value: late, tone: ' warn' },
              { label: 'Still open, past due', value: missed, tone: ' warn' },
            ].map(k => (
              <div key={k.label} className="pun-kpi">
                <span className={`pun-kpi-value${k.value === 0 ? ' zero' : k.tone}`}>{k.value}</span>
                <span className="pun-kpi-label">{k.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Said out loud because the alternative is a number people quietly mistrust. It also explains
          why this disagrees with the overdue count on /tasks, which is not windowed. */}
      {scored > 0 && (
        <p className="pun-note">
          Counted across {scored} {scored === 1 ? 'deadline' : 'deadlines'}. Tasks with no due date aren&apos;t scored.
        </p>
      )}
    </section>
  );
}
