import { nameKinship } from './kinship';

describe('nameKinship — the real Master vs app mismatches', () => {
  it('reads an abbreviated given name as the same person', () => {
    const k = nameKinship('CALLENS, M-Christine', 'Callens, Marie-Christine')!;
    expect(k.strength).toBe('strong');
    expect(k.reason).toContain('"M" is short for "Marie"');
  });

  it('reads a compound surname as the same person', () => {
    const k = nameKinship('LEPRETRE-SAÏLE, Marie-Pierre', 'Leprêtre, Marie-Pierre')!;
    expect(k.strength).toBe('strong');
    expect(k.reason).toContain('surname as a compound');
    expect(k.reason).toContain('"SAÏLE"');
  });

  it('reads an extra given name as only POSSIBLY the same person', () => {
    const k = nameKinship('CORDONNIER - Bernard-Philippe', 'CORDONNIER, Philippe')!;
    expect(k.strength).toBe('weak');
    expect(k.reason).toContain('"Bernard"');
  });

  it('treats a letter-level difference as the same person', () => {
    const k = nameKinship('VERHASSELT, Claire', 'Vermasselt, Claire')!;
    expect(k.strength).toBe('strong');
    expect(k.reason).toContain('differ only in spelling');
  });

  it('ignores accents and name order', () => {
    expect(nameKinship('Sion, François-Xavier', 'François-Xavier Sion')!.strength).toBe('strong');
  });

  it('looks past the Master\'s annotations', () => {
    const k = nameKinship('DELCOURT, Syma - mother Ola Alhaj Hasan', 'Delcourt, Syma')!;
    expect(k.strength).toBe('strong');
  });
});

describe('nameKinship — refuses to guess', () => {
  it('says nothing about two unrelated names', () => {
    expect(nameKinship('Coisne, Véronique', 'Sion, François-Xavier')).toBeNull();
  });

  // The dangerous case the whole thing has to get right: a mother and daughter
  // on one email are NOT one person, and a shared surname mustn't imply they are.
  it('says nothing when only the surname matches', () => {
    expect(nameKinship('Dupont, Marie', 'Dupont, Claire')).toBeNull();
  });

  it('is not fooled by a shared initial alone', () => {
    expect(nameKinship('Martin, M', 'Mercier, M')).toBeNull();
  });

  it('says nothing when both names carry different extra words', () => {
    expect(nameKinship('Dubois, Jean-Luc Marie', 'Dubois, Jean Claire Sophie')).toBeNull();
  });

  it('handles empty input', () => {
    expect(nameKinship('', 'Dupont, Marie')).toBeNull();
  });
});

// A weak verdict must stay weak: "Marie" vs "Marie-Claire" is exactly the shape
// of the Cordonnier case, and here it really is likely two people.
describe('nameKinship — the ambiguity it cannot resolve', () => {
  it('gives the same weak reading to a household variant', () => {
    const k = nameKinship('Dupont, Marie-Claire', 'Dupont, Marie')!;
    expect(k.strength).toBe('weak');
    expect(k.reason).toContain('second family member');
  });
});
