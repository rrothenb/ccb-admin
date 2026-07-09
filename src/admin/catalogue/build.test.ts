import {
  initialOf,
  authorTitleSection,
  titleRefSection,
  titleAuthorSection,
  authorsIndexSection,
  CatItem,
} from './build';

function item(over: Partial<CatItem> = {}): CatItem {
  return { title: 'T', author: 'A', ref: '', category: '', ...over };
}

describe('initialOf', () => {
  it('uppercases the first letter', () => {
    expect(initialOf('atkinson, kate')).toBe('A');
    expect(initialOf('Boyd, William')).toBe('B');
  });
  it('collapses digits/symbols to #', () => {
    expect(initialOf('1917')).toBe('#');
    expect(initialOf('9 1/2 Weeks')).toBe('#');
    expect(initialOf('')).toBe('#');
  });
});

describe('authorTitleSection', () => {
  const items = [
    item({ author: 'Christie, Agatha', title: 'Death on the Nile' }),
    item({ author: 'Atkinson, Kate', title: 'Transcription' }),
    item({ author: 'Atkinson, Kate', title: 'Human Croquet' }),
    item({ author: 'Boyd, William', title: 'Restless' }),
  ];

  it('sorts by author then title and groups by author initial', () => {
    const s = authorTitleSection('BOOKS: DETECTIVE', items);
    expect(s.columns).toEqual(['Author', 'Title']);
    expect(s.count).toBe(4);
    expect(s.groups.map((g) => g.initial)).toEqual(['A', 'B', 'C']);
    // A-group: Atkinson, both books, title-sorted (Human before Transcription)
    expect(s.groups[0].rows).toEqual([
      ['Atkinson, Kate', 'Human Croquet'],
      ['Atkinson, Kate', 'Transcription'],
    ]);
    expect(s.groups[2].rows[0]).toEqual(['Christie, Agatha', 'Death on the Nile']);
  });
});

describe('titleRefSection (DVDs)', () => {
  it('sorts by title, groups by title initial, numbers first under #', () => {
    const s = titleRefSection('DVD / FILM', [
      item({ title: 'Argo', ref: 'DVD F 560' }),
      item({ title: '1917', ref: 'DVD F 805' }),
      item({ title: 'Alien', ref: 'DVD F 421' }),
    ]);
    expect(s.columns).toEqual(['Title', 'Reference']);
    expect(s.groups[0].initial).toBe('#');
    expect(s.groups[0].rows[0]).toEqual(['1917', 'DVD F 805']);
    expect(s.groups[1].initial).toBe('A');
    expect(s.groups[1].rows).toEqual([['Alien', 'DVD F 421'], ['Argo', 'DVD F 560']]);
  });
});

describe('titleAuthorSection (easy readers)', () => {
  it('sorts by title with Title | Author columns', () => {
    const s = titleAuthorSection('Starter', [
      item({ title: 'Orca', author: 'Burrows, Phillip' }),
      item({ title: 'Dirty Money', author: 'Leather, Sue' }),
    ]);
    expect(s.columns).toEqual(['Title', 'Author']);
    expect(s.groups[0].rows[0]).toEqual(['Dirty Money', 'Leather, Sue']);
  });
});

describe('authorsIndexSection', () => {
  it('lists each author once with categories joined, grouped by initial', () => {
    const s = authorsIndexSection('AUTHORS', [
      item({ author: 'Atkinson, Kate', category: 'Detective' }),
      item({ author: 'Atkinson, Kate', category: 'General Fiction' }),
      item({ author: 'Adams, Douglas', category: 'General Fiction' }),
      item({ author: 'Boyd, William', category: 'Detective' }),
    ]);
    expect(s.columns).toEqual(['Author', 'Category']);
    expect(s.count).toBe(3); // 3 distinct authors
    // A-group sorted: Adams before Atkinson; Atkinson has both categories joined
    expect(s.groups[0].initial).toBe('A');
    expect(s.groups[0].rows).toEqual([
      ['Adams, Douglas', 'General Fiction'],
      ['Atkinson, Kate', 'Detective, General Fiction'],
    ]);
  });
});
