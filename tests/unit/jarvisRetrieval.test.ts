import { describe, expect, it } from 'vitest';
import { retrieve, type Candidate } from '../../src/lib/retrieval';
import { dateWindowFromQuestion, parseJarvisQuery, windowForYmd } from '../../src/lib/jarvisQuery';

const DAY = 86_400_000;
const NOW = Date.parse('2026-09-21T06:30:00Z'); // morning IST on 21 Sep 2026
const TZ = 'Asia/Kolkata';

function item(partial: Partial<Candidate> & Pick<Candidate, 'id' | 'type' | 'title'>): Candidate {
  const line = partial.line || `${partial.type.toUpperCase()} id=${partial.id} | ${partial.title}`;
  return {
    body: '',
    at: partial.at,
    line,
    shortLine: partial.shortLine,
    ...partial,
  };
}

describe('jarvisQuery date windows', () => {
  it('parses today for expense questions', () => {
    const intent = parseJarvisQuery('What are the expenses for today?', NOW, TZ);
    expect(intent.types.has('expense')).toBe(true);
    expect(intent.dateWindow).not.toBeNull();
    expect(intent.narrow).toBe(true);
    expect(intent.maxChars).toBeLessThan(10_000);
  });

  it('windowForYmd covers the full local day', () => {
    const w = windowForYmd('2026-09-21', TZ);
    expect(w.end - w.start).toBeGreaterThan(DAY - 60_000);
    expect(w.end - w.start).toBeLessThan(DAY + 60_000);
  });

  it('dateWindowFromQuestion returns null without temporal words', () => {
    expect(dateWindowFromQuestion('tell me about ray.so', NOW, TZ)).toBeNull();
  });
});

describe('retrieve date-aware expense ranking', () => {
  it('prefers expenses on the asked day over older ones', () => {
    const todayStart = windowForYmd('2026-09-21', TZ).start;
    const vault: Candidate[] = [
      item({
        id: 'e-old',
        type: 'expense',
        title: 'Lunch (INR 200)',
        at: todayStart - 5 * DAY,
        line: 'EXPENSE id=e-old | Lunch | amount=INR 200 | date=old',
        shortLine: 'EXPENSE id=e-old | Lunch | amount=INR 200 | date=old',
      }),
      item({
        id: 'e-today',
        type: 'expense',
        title: 'Coffee (INR 80)',
        at: todayStart + 3 * 3_600_000,
        line: 'EXPENSE id=e-today | Coffee | amount=INR 80 | date=today',
        shortLine: 'EXPENSE id=e-today | Coffee | amount=INR 80 | date=today',
      }),
    ];

    const w = dateWindowFromQuestion('expenses for today', NOW, TZ)!;
    const picked = retrieve(vault, 'What are the expenses for today?', {
      now: NOW,
      limit: 5,
      dateWindow: w,
      narrowDateType: true,
    });

    expect(picked.map(p => p.id)).toContain('e-today');
    expect(picked.map(p => p.id)).not.toContain('e-old');
  });
});
