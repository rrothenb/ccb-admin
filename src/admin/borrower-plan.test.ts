import { planBorrowerWrites, isoToHuman } from './borrower-plan';
import { reconcile } from './detector';
import { DetectorInput, MasterRow, RegisterRow, AppMember } from './detector/types';

const TARGET = '2027-09-01';

function master(rawName: string, over: Partial<MasterRow> = {}): MasterRow {
  return { rawName, enrolDate: '2025-09-01', classNumber: '1', dayTime: '', status: 'active', renewalType: 'renewal', rowNumber: 2, ...over };
}
function reg(rawName: string, email: string, over: Partial<RegisterRow> = {}): RegisterRow {
  return { rawName, email, classId: '1', teacher: 'Sue', level: 'B1', ...over };
}
function app(id: string, rawName: string, email: string, expiryDate: string): AppMember {
  return { id, rawName, email, expiryDate };
}
function input(over: Partial<DetectorInput>): DetectorInput {
  return { master: [], register: [], app: [], roster: { validClassIds: ['1'] }, ...over };
}
function plan(over: Partial<DetectorInput>) {
  return planBorrowerWrites(reconcile(input(over)), TARGET);
}

describe('isoToHuman', () => {
  it('formats ISO to the app\'s "Month d, yyyy"', () => {
    expect(isoToHuman('2027-09-01')).toBe('September 1, 2027');
    expect(isoToHuman('2020-10-30')).toBe('October 30, 2020');
  });
  it('passes non-ISO through untouched', () => {
    expect(isoToHuman('September 1, 2027')).toBe('September 1, 2027');
    expect(isoToHuman('')).toBe('');
  });
});

describe('planBorrowerWrites — expiry updates', () => {
  it('updates an exact-matched member whose expiry differs', () => {
    const p = plan({
      master: [master('Dupont, Marie')],
      app: [app('B1', 'Dupont, Marie', 'm@ex.fr', 'October 2, 2021')],
    });
    expect(p.toUpdate).toEqual([{ id: 'B1', name: 'Dupont, Marie', fromRaw: 'October 2, 2021', toISO: TARGET }]);
    expect(p.toAdd).toHaveLength(0);
    expect(p.skipped).toHaveLength(0);
  });

  it('counts a member already at the target as no-change', () => {
    const p = plan({ master: [master('Ok, Dana')], app: [app('B1', 'Ok, Dana', 'd@ex.fr', 'September 1, 2027')] });
    expect(p.toUpdate).toHaveLength(0);
    expect(p.alreadyCurrentCount).toBe(1);
  });

  it('shows (none) for a member with no stored expiry', () => {
    const p = plan({ master: [master('Blank, Bea')], app: [app('B1', 'Blank, Bea', 'b@ex.fr', '')] });
    expect(p.toUpdate[0].fromRaw).toBe('(none)');
  });

  it('never touches historical (non-Master) app members', () => {
    const p = plan({
      master: [master('Current, Cara')],
      app: [
        app('B1', 'Current, Cara', 'c@ex.fr', 'October 2, 2021'),
        app('B2', 'Old, Timer', 'o@ex.fr', 'February 18, 2016'),
      ],
    });
    expect(p.toUpdate.map((u) => u.id)).toEqual(['B1']);
  });

  it('does NOT write a fuzzy-matched member — skips it with a reason', () => {
    const p = plan({
      master: [master('Adjerad, Louise')],
      app: [app('B1', 'Adjerad, Louisa', 'l@ex.fr', 'February 18, 2016')],
    });
    expect(p.toUpdate).toHaveLength(0);
    expect(p.skipped).toHaveLength(1);
    expect(p.skipped[0].reason).toBe('ambiguous-match');
  });

  it('does NOT write an email-bridge-matched member — skips it', () => {
    const p = plan({
      master: [master('Coisne, Véronique')],
      register: [reg('Coisne, Véronique', 'household@ex.fr')],
      app: [app('B1', 'Sion, François-Xavier', 'household@ex.fr', 'October 2, 2021')],
    });
    expect(p.toUpdate).toHaveLength(0);
    expect(p.skipped[0].reason).toBe('ambiguous-match');
  });
});

describe('planBorrowerWrites — additions', () => {
  it('adds a Master person absent from the app, using the Register email', () => {
    const p = plan({
      master: [master('New, Guy', { rowNumber: 5 })],
      register: [reg('New, Guy', 'guy@ex.fr')],
      app: [],
    });
    expect(p.toAdd).toEqual([{ name: 'New, Guy', email: 'guy@ex.fr', expiryISO: TARGET, masterRow: 5 }]);
    expect(p.skipped).toHaveLength(0);
  });

  it('skips (does not add) a Master person with no Register email', () => {
    const p = plan({ master: [master('Lonely, Len')], register: [], app: [] });
    expect(p.toAdd).toHaveLength(0);
    expect(p.skipped).toHaveLength(1);
    expect(p.skipped[0].reason).toBe('no-email');
  });

  it('skips a household where several new people would share one email', () => {
    const p = plan({
      master: [master('Kid, Alban'), master('Kid, Maxence')],
      register: [reg('Kid, Alban', 'parent@ex.fr'), reg('Kid, Maxence', 'parent@ex.fr')],
      app: [],
    });
    expect(p.toAdd).toHaveLength(0);
    expect(p.skipped).toHaveLength(2);
    expect(p.skipped.every((s) => s.reason === 'shared-email')).toBe(true);
  });

  it('does not add someone whose Register email already belongs to an app member (they bridge instead)', () => {
    // The email resolves in the app, so reconcile links via email-bridge — not an add at all.
    const p = plan({
      master: [master('Newcomer, Nia')],
      register: [reg('Newcomer, Nia', 'shared@ex.fr')],
      app: [app('B1', 'Existing, Ed', 'shared@ex.fr', 'October 2, 2021')],
    });
    expect(p.toAdd).toHaveLength(0);
    expect(p.skipped[0].reason).toBe('ambiguous-match');
  });
});

describe('planBorrowerWrites — name collisions', () => {
  it('refuses to update OR add a name that isn\'t unique in the Master', () => {
    const p = plan({
      master: [master('Dupe, Sam'), master('Dupe, Sam')],
      register: [reg('Dupe, Sam', 'sam@ex.fr')],
      app: [app('B1', 'Dupe, Sam', 's@ex.fr', 'October 2, 2021')],
    });
    expect(p.toUpdate).toHaveLength(0);
    expect(p.toAdd).toHaveLength(0);
    expect(p.skipped.some((s) => s.reason === 'name-collision')).toBe(true);
  });
});

describe('planBorrowerWrites — mixed run keeps the clean names moving', () => {
  it('writes the unambiguous names and surfaces the rest', () => {
    const p = plan({
      master: [
        master('Clean, Clara'),                 // exact update
        master('Fresh, Fred', { rowNumber: 9 }), // add
        master('Adjerad, Louise'),               // fuzzy → skip
      ],
      register: [reg('Fresh, Fred', 'fred@ex.fr')],
      app: [
        app('B1', 'Clean, Clara', 'clara@ex.fr', 'October 2, 2021'),
        app('B2', 'Adjerad, Louisa', 'l@ex.fr', 'February 18, 2016'),
      ],
    });
    expect(p.toUpdate.map((u) => u.name)).toEqual(['Clean, Clara']);
    expect(p.toAdd.map((a) => a.name)).toEqual(['Fresh, Fred']);
    expect(p.skipped).toHaveLength(1);
    expect(p.skipped[0].reason).toBe('ambiguous-match');
  });
});
