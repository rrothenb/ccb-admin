import { parseRegisterGrid, parseRegisterTabs } from './register';

describe('parseRegisterGrid — standard roster grid', () => {
  const grid = [
    ['Class 1 / Sue Smith', '', ''],
    ['Intermediate', '', ''],
    ['Name', 'Email', 'Wk1'],
    ['Dupont, Marie', 'marie@ex.fr', 'P'],
    ['Bernard, Luc', 'luc@ex.fr', 'A'],
    ['', '', ''],
  ];

  it('attributes rows to the current class header', () => {
    const rows = parseRegisterGrid(grid);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ rawName: 'Dupont, Marie', email: 'marie@ex.fr', classId: '1', teacher: 'Sue Smith', level: 'Intermediate' });
    expect(rows[1]).toMatchObject({ rawName: 'Bernard, Luc', classId: '1' });
  });

  it('skips the header/legend row and blank rows (no phantom people)', () => {
    expect(parseRegisterGrid(grid).map((r) => r.rawName)).toEqual(['Dupont, Marie', 'Bernard, Luc']);
  });
});

describe('parseRegisterGrid — layout independence', () => {
  it('finds name+email regardless of column order', () => {
    const grid = [
      ['Class 2 / Bob'],
      ['P', 'bob.pupil@ex.fr', 'Martin, Anne', 'notes'],
    ];
    const rows = parseRegisterGrid(grid);
    expect(rows[0]).toMatchObject({ rawName: 'Martin, Anne', email: 'bob.pupil@ex.fr', classId: '2', teacher: 'Bob' });
  });

  it("handles the kids layout (teacher in an adjacent cell, no slash)", () => {
    const grid = [
      ['Class 8a', 'Rebecca', ''],
      ['', 'Beginners', ''],
      ['Petit, Zoé', 'parent@ex.fr'],
    ];
    const rows = parseRegisterGrid(grid);
    expect(rows[0]).toMatchObject({ classId: '8a', teacher: 'Rebecca', level: 'Beginners', rawName: 'Petit, Zoé' });
  });

  it('normalizes a combined class id ("11 & 12" → "11&12")', () => {
    const grid = [['Class 11 & 12 / Jo'], ['Roux, Paul', 'paul@ex.fr']];
    expect(parseRegisterGrid(grid)[0].classId).toBe('11&12');
  });
});

describe('parseRegisterGrid — combined siblings', () => {
  it('keeps a combined sibling row verbatim (the detector splits it later)', () => {
    const grid = [
      ['Class 3 / Ann'],
      ['CELARIER FRAUDET, Alban / Maxence', 'household@ex.fr'],
    ];
    const rows = parseRegisterGrid(grid);
    expect(rows).toHaveLength(1);
    expect(rows[0].rawName).toBe('CELARIER FRAUDET, Alban / Maxence');
    expect(rows[0].email).toBe('household@ex.fr');
  });
});

describe('parseRegisterGrid — robustness', () => {
  it('ignores rows before the first class header', () => {
    const grid = [
      ['CCB Register 2026-27', ''],
      ['Stray, Person', 'stray@ex.fr'],   // no class context yet → skipped
      ['Class 5 / Kim'],
      ['Real, Member', 'real@ex.fr'],
    ];
    expect(parseRegisterGrid(grid).map((r) => r.rawName)).toEqual(['Real, Member']);
  });

  it('emits a name even when a row has no email', () => {
    const grid = [['Class 9 / Lee'], ['Noemail, Nadia', 'P', 'P']];
    const rows = parseRegisterGrid(grid);
    expect(rows[0]).toMatchObject({ rawName: 'Noemail, Nadia', email: '' });
  });
});

describe('parseRegisterTabs', () => {
  it('concatenates results across tabs', () => {
    const tabA = [['Class 1 / A'], ['One, Ann', 'a@ex.fr']];
    const tabB = [['Class 2 / B'], ['Two, Bob', 'b@ex.fr']];
    const rows = parseRegisterTabs([tabA, tabB]);
    expect(rows.map((r) => r.classId)).toEqual(['1', '2']);
  });
});
