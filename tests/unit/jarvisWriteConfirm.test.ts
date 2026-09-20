import { describe, expect, it } from 'vitest';
import { jarvisLooksLikeRevision, jarvisConfirmPrompt } from '../../src/lib/jarvisWriteConfirm';

describe('jarvisLooksLikeRevision', () => {
  it('ignores apologies and small talk during confirm', () => {
    expect(jarvisLooksLikeRevision("I'm sorry for the bad translation")).toBe(false);
    expect(jarvisLooksLikeRevision('Nign')).toBe(false);
  });

  it('detects real revisions', () => {
    expect(jarvisLooksLikeRevision('make it twenty rupees instead')).toBe(true);
    expect(jarvisLooksLikeRevision('call it Pepsi')).toBe(true);
  });
});

describe('jarvisConfirmPrompt', () => {
  it('stays short for TTS', () => {
    const s = jarvisConfirmPrompt([{ type: 'create_expense', title: 'Coke', amount: 10 }]);
    expect(s.length).toBeLessThan(120);
    expect(s).toContain('Confirming in 5 seconds');
  });
});
