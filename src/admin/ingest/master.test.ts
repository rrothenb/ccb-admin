import { parseMasterGrid } from './master';

describe('parseMasterGrid', () => {
  const grid = [
    ['CCB Master File (26-27)', '', '', '', '', ''],
    ['NAME', 'DATE ENROLED', 'CLASS NUMBER', 'STATUS', 'RENEWAL/NEW', 'TOTAL PAID €'],
    ['Dupont, Marie', '2025-09-01', '1', 'active', 'renewal', '75'],
    ['Bernard, Luc', '2025-09-15', '2', 'active', 'new', '0'],
  ];

  it('finds the header on row 2 (year drift) and maps columns', () => {
    const res = parseMasterGrid(grid);
    expect(res.headerRow).toBe(2);
    expect(res.columnMap.name).toBe(0);
    expect(res.columnMap.enrolled).toBe(1);
    expect(res.error).toBeUndefined();
  });

  it('extracts members with computed fields and 1-based row numbers', () => {
    const res = parseMasterGrid(grid);
    expect(res.members).toHaveLength(2);
    expect(res.members[0]).toMatchObject({
      rawName: 'Dupont, Marie',
      enrolDate: '2025-09-01',
      classNumber: '1',
      status: 'active',
      renewalType: 'renewal',
      paid: true,
      rowNumber: 3,
    });
    expect(res.members[1].paid).toBe(false); // TOTAL PAID of "0" → unpaid
  });

  it('reads payment from TOTAL PAID, not an instalment column', () => {
    const res = parseMasterGrid([
      ['NAME', 'DATE ENROLED', 'PAYMENT 1', 'TOTAL PAID €'],
      ['Instal, Ivy', '2025-09-01', '', '150'], // blank 1st instalment but paid in full
    ]);
    expect(res.members[0].paid).toBe(true);
  });

  it('treats blank and pre-2000 (time-only epoch) enrol dates as missing', () => {
    const res = parseMasterGrid([
      ['NAME', 'DATE ENROLED'],
      ['Blank, Bea', ''],
      ['Epoch, Ed', '1899-12-30'],
      ['Good, Gio', '2025-10-01'],
    ]);
    expect(res.members.find((m) => m.rawName === 'Blank, Bea')!.enrolDate).toBe('');
    expect(res.members.find((m) => m.rawName === 'Epoch, Ed')!.enrolDate).toBe('');
    expect(res.members.find((m) => m.rawName === 'Good, Gio')!.enrolDate).toBe('2025-10-01');
  });

  it('skips section-marker rows among the data', () => {
    const res = parseMasterGrid([
      ['NAME', 'DATE ENROLED'],
      ['MASTER FILE 26-27', '2025-09-01'],
      ['Real, Rae', '2025-09-01'],
    ]);
    expect(res.members.map((m) => m.rawName)).toEqual(['Real, Rae']);
  });

  it('leaves paid undefined when there is no payment column', () => {
    const res = parseMasterGrid([
      ['NAME', 'DATE ENROLED'],
      ['Nopay, Nell', '2025-09-01'],
    ]);
    expect(res.members[0].paid).toBeUndefined();
  });

  it('reports an error when no NAME column exists', () => {
    const res = parseMasterGrid([['Foo', 'Bar'], ['a', 'b']]);
    expect(res.error).toBeTruthy();
    expect(res.members).toHaveLength(0);
  });
});
