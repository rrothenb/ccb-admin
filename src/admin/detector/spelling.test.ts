import { voteSpelling, spellingKey, looksLikeTypo } from './spelling';

describe('looksLikeTypo', () => {
  it('clusters single-letter typos (same person)', () => {
    expect(looksLikeTypo('BROGNIART, Isabelle', 'BRONGNIART Isabelle')).toBe(true);
    expect(looksLikeTypo('WADAH, Sonia', 'WADDAH Sonia')).toBe(true);
    expect(looksLikeTypo('JUILIEN, Laurent', 'JULIEN, Laurent')).toBe(true);
    expect(looksLikeTypo('MAOUCHE, Hamida', 'MADUCHE Hamide')).toBe(true); // one typo in each token
  });
  it('does NOT cluster two different given names (siblings)', () => {
    expect(looksLikeTypo('GRIMONT-PARISOT, June', 'GRIMONT-PARISOT, Jade')).toBe(false);
  });
  it('is false for identical names and for different token counts', () => {
    expect(looksLikeTypo('DELCOURT, Syma', 'DELCOURT / Syma')).toBe(false); // identical after normalize
    expect(looksLikeTypo('DUPONT, Marie', 'DUPONT, Marie / Luc')).toBe(false); // extra sibling token
  });
});

describe('spellingKey', () => {
  it('ignores accents, case, order, punctuation, and admin annotations', () => {
    expect(spellingKey('DUSAUSOY, Zélie 5 ans')).toBe(spellingKey('DUSAUSOY Zelie (4Yrs)'));
    expect(spellingKey('DELCOURT, Syma - mother Ola')).toBe(spellingKey('DELCOURT / Syma'));
  });
  it('keeps a real letter difference distinct', () => {
    expect(spellingKey('JUILIEN, Laurent')).not.toBe(spellingKey('JULIEN, Laurent'));
  });
});

describe('voteSpelling', () => {
  it('returns null when everyone agrees (formatting-only differences)', () => {
    expect(
      voteSpelling([
        { source: 'Master', name: 'DELCOURT, Syma' },
        { source: 'Register', name: 'DELCOURT / Syma' },
      ])
    ).toBeNull();
  });

  it('picks the 2-of-3 majority and names the outlier source', () => {
    const v = voteSpelling([
      { source: 'Master', name: 'JUILIEN, Laurent' },
      { source: 'App', name: 'JUILIEN, Laurent' },
      { source: 'Register', name: 'JULIEN, Laurent' },
    ])!;
    expect(v.likely).toBe('JUILIEN, Laurent');
    expect(v.conflicted).toBe(false);
    expect(v.outliers).toEqual([{ source: 'Register', display: 'JULIEN, Laurent' }]);
    expect(v.reason).toContain('2 of 3');
  });

  it('lets the email break a 1-1 tie (shared given name does NOT credit both)', () => {
    const v = voteSpelling([
      { source: 'Master', name: 'JUILIEN, Laurent' },
      { source: 'App', name: 'JULIEN, Laurent', email: 'laurent.juilien@ex.fr' },
    ])!;
    expect(v.likely).toBe('JUILIEN, Laurent');
    expect(v.conflicted).toBe(false);
    expect(v.reason).toContain('email');
  });

  it('flags a conflict when the email contradicts the source majority (never auto-decides)', () => {
    const v = voteSpelling([
      { source: 'Master', name: 'JUILIEN, Laurent' },
      { source: 'App', name: 'JUILIEN, Laurent' },
      { source: 'Register', name: 'JULIEN, Laurent', email: 'laurent.julien@ex.fr' },
    ])!;
    expect(v.conflicted).toBe(true);
    expect(v.likely).toBe('JULIEN, Laurent'); // email-supported…
    expect(v.reason).toContain('typo'); // …but explicitly flagged as a "check which" case
  });

  it('stays neutral on an even split with no email evidence', () => {
    const v = voteSpelling([
      { source: 'Master', name: 'JUILIEN, Laurent' },
      { source: 'Register', name: 'JULIEN, Laurent' },
    ])!;
    expect(v.likely).toBeNull();
    expect(v.outliers).toEqual([]);
  });
});
