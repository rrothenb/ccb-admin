import {
  stripAccents,
  nameKey,
  tightKey,
  levenshtein,
  isEmailShaped,
  emailKey,
} from './normalize';

describe('stripAccents', () => {
  it('removes French diacritics', () => {
    expect(stripAccents('Zélie')).toBe('Zelie');
    expect(stripAccents('François-Xavier')).toBe('Francois-Xavier');
    expect(stripAccents('Véronique')).toBe('Veronique');
  });
});

describe('nameKey', () => {
  it('is order-insensitive across "Surname, First" vs "First Surname"', () => {
    expect(nameKey('Sion, François-Xavier')).toBe(nameKey('François-Xavier Sion'));
  });

  it('collapses case, accents, and punctuation', () => {
    expect(nameKey('DELCOURT, Syma')).toBe('delcourt syma');
  });

  it('treats distinct people as distinct keys', () => {
    expect(nameKey('Louise Martin')).not.toBe(nameKey('Louisa Martin'));
    expect(nameKey('Frances Day')).not.toBe(nameKey('Francis Day'));
  });
});

describe('tightKey + levenshtein', () => {
  it('makes LEMAHIEU and Le Mahieu near-identical', () => {
    const d = levenshtein(tightKey('LEMAHIEU'), tightKey('Le Mahieu'));
    expect(d).toBeLessThanOrEqual(1);
  });

  it('keeps real trap pairs at distance >= 1 (never distance 0)', () => {
    // Louise/Louisa differ by one char — a fuzzy candidate, never an auto-merge.
    expect(levenshtein(tightKey('Louise'), tightKey('Louisa'))).toBe(1);
    expect(levenshtein(tightKey('Frances'), tightKey('Francis'))).toBe(1);
  });

  it('measures a typo as a small edit distance', () => {
    expect(levenshtein(tightKey('Julien'), tightKey('Juilien'))).toBeLessThanOrEqual(1);
  });

  it('is symmetric and zero on equal strings', () => {
    expect(levenshtein('abc', 'abc')).toBe(0);
    expect(levenshtein('kitten', 'sitting')).toBe(levenshtein('sitting', 'kitten'));
  });
});

describe('email helpers', () => {
  it('accepts well-shaped addresses and rejects junk', () => {
    expect(isEmailShaped('a@b.com')).toBe(true);
    expect(isEmailShaped('xavier.sion@example.fr')).toBe(true);
    expect(isEmailShaped('nope')).toBe(false);
    expect(isEmailShaped('a@b')).toBe(false);
    expect(isEmailShaped('')).toBe(false);
  });

  it('normalizes for comparison', () => {
    expect(emailKey('  Foo@Bar.COM ')).toBe('foo@bar.com');
  });
});
