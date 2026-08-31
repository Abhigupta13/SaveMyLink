import NextLink from 'next/link';
import { formatInZone, formatStamp, DEFAULT_TZ } from '@/lib/time';
import type { DigestTask, DigestLink } from '@/lib/digest';

/**
 * The two halves of the weekly digest, drawn the same way wherever they appear.
 *
 * They render on /digest in full and on the home page capped, because a glance surface that scrolls
 * forever is not a glance. Same markup either way — a second, prettier copy for the home page is
 * how the two quietly stop agreeing about what "overdue" looks like.
 */

const Head = ({ label, count, href }: { label: string; count: number; href?: string }) => (
  <div className="dg-head">
    <span className="dg-label">{label} ({count})</span>
    {href && <NextLink href={href} className="subtle-link">See all →</NextLink>}
  </div>
);

/** Open work with a date on it. Overdue is called out in the warning colour, as everywhere else. */
/**
 * The due date, with its year only when that year is not the current one.
 *
 * Dropping the year is right almost always — "31 Aug, 11:30 am" is how a person says it, and the
 * year is noise on a task due this week. It is wrong in exactly one case, which is the case that
 * brought this here: a task Jarvis filed with the wrong year rendered identically to one due
 * today, so an item two years overdue looked like the overdue badge was lying.
 */
function stampOf(dueAt: DigestTask['dueAt'], zone: string) {
  if (!dueAt) return '';
  const yearIn = (v: Date | string) => new Date(v).toLocaleDateString('en-GB', { year: 'numeric', timeZone: zone });
  return yearIn(dueAt) === yearIn(new Date())
    ? formatInZone(dueAt, zone)
    : formatStamp(dueAt, zone);
}

export function NeedsAttention({ tasks, limit, href, timeZone }: { tasks: DigestTask[]; limit?: number; href?: string; timeZone?: string }) {
  const shown = limit ? tasks.slice(0, limit) : tasks;
  const zone = timeZone || DEFAULT_TZ;
  return (
    <section className="dg-block">
      <Head label="Urgent — needs attention" count={tasks.length} href={tasks.length > shown.length ? href : undefined} />
      {tasks.length === 0
        ? <p className="dg-empty">Nothing due. Clean week ahead.</p>
        : (
          <div className="dg-list">
            {shown.map(t => (
              <NextLink key={t._id} href="/tasks" className="dg-row">
                <span className="dg-row-top">
                  <span className="dg-row-title">{t.title}</span>
                  {t.projectName && <span className="chip">{t.projectName}</span>}
                </span>
                {/* The zone is REQUIRED here, unlike on a client component. This renders on the
                    server, where omitting it falls back to the runtime's zone — UTC on Vercel —
                    and printed a task due 11:30 am in India as "6:00 am", beside a Jarvis chat
                    that said 11:30 because it runs in the browser. See components/TimeZoneCookie.

                    The year appears only when it is NOT the current one. "31 Aug, 11:30 am" on a
                    task actually due in 2024 read as today and looked like the overdue flag was
                    simply broken — the one case where the year is the whole explanation. */}
                <span className={`dg-due${t.overdue ? ' late' : ''}`}>
                  {t.overdue ? 'Overdue — was due ' : 'Due '}{stampOf(t.dueAt, zone)}
                </span>
              </NextLink>
            ))}
          </div>
        )}
    </section>
  );
}

/** What went into the vault this week. Private links never reach here — see lib/digest. */
export function SavedThisWeek({ links, limit, href }: { links: DigestLink[]; limit?: number; href?: string }) {
  const shown = limit ? links.slice(0, limit) : links;
  return (
    <section className="dg-block">
      <Head label="Saved this week" count={links.length} href={links.length > shown.length ? href : undefined} />
      {links.length === 0
        ? <p className="dg-empty">No links saved this week.</p>
        : (
          <div className="dg-list">
            {shown.map(l => (
              <a key={l._id} href={l.url || '/links'} target={l.url ? '_blank' : undefined} rel="noopener noreferrer" className="dg-row link">
                {l.previewImageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={l.previewImageUrl} alt="" className="dg-thumb" />
                )}
                <span className="dg-row-text">
                  <span className="dg-row-title">{l.title || l.url}</span>
                  <span className="dg-sub">{l.category?.name || (l.url ? 'Uncategorized' : 'Note')}</span>
                </span>
              </a>
            ))}
          </div>
        )}
    </section>
  );
}
