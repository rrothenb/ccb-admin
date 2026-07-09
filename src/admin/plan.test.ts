import { planExpiryWrites, toISODate } from './plan';
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
  return planExpiryWrites(reconcile(input(over)), TARGET);
}

describe('toISODate', () => {
  it('parses the app "Month d, yyyy" format', () => {
    expect(toISODate('September 1, 2027')).toBe('2027-09-01');
    expect(toISODate('October 30, 2020')).toBe('2020-10-30');
  });
  it('passes ISO through and rejects junk/blank', () => {
    expect(toISODate('2027-09-01')).toBe('2027-09-01');
    expect(toISODate('')).toBe('');
    expect(toISODate('not a date')).toBe('');
  });
});

describe('planExpiryWrites', () => {
  it('lists a current member whose expiry would change', () => {
    const p = plan({
      master: [master('Dupont, Marie')],
      app: [app('B1', 'Dupont, Marie', 'm@ex.fr', 'October 2, 2021')],
    });
    expect(p.toUpdate).toHaveLength(1);
    expect(p.toUpdate[0]).toMatchObject({ id: 'B1', name: 'Dupont, Marie', fromRaw: 'October 2, 2021', toISO: TARGET });
    expect(p.currentMemberCount).toBe(1);
  });

  it('counts a member already at the target as no-change', () => {
    const p = plan({
      master: [master('Ok, Dana')],
      app: [app('B1', 'Ok, Dana', 'd@ex.fr', 'September 1, 2027')],
    });
    expect(p.toUpdate).toHaveLength(0);
    expect(p.alreadyCurrentCount).toBe(1);
  });

  it('shows (none) for a member with no stored expiry', () => {
    const p = plan({ master: [master('Blank, Bea')], app: [app('B1', 'Blank, Bea', 'b@ex.fr', '')] });
    expect(p.toUpdate[0].fromRaw).toBe('(none)');
  });

  it('lists Master members with no app record as cannotWriteYet (not writable)', () => {
    const p = plan({ master: [master('New, Guy')], app: [] });
    expect(p.toUpdate).toHaveLength(0);
    expect(p.cannotWriteYet).toEqual(['New, Guy']);
  });

  it('never touches non-current app members (historical borrowers)', () => {
    const p = plan({
      master: [master('Current, Cara')],
      app: [
        app('B1', 'Current, Cara', 'c@ex.fr', 'October 2, 2021'),
        app('B2', 'Old, Timer', 'o@ex.fr', 'February 18, 2016'), // not in Master → untouched
      ],
    });
    expect(p.currentMemberCount).toBe(1);
    expect(p.toUpdate.map((c) => c.id)).toEqual(['B1']);
  });

  it('flags updates that rely on an unconfirmed fuzzy/bridge match', () => {
    const p = plan({
      master: [master('Coisne, Véronique'), master('Adjerad, Louise')],
      register: [reg('Coisne, Véronique', 'household@ex.fr')],
      app: [
        app('B1', 'Sion, François-Xavier', 'household@ex.fr', 'October 2, 2021'), // bridge
        app('B2', 'Adjerad, Louisa', 'l@ex.fr', 'February 18, 2016'),             // fuzzy
      ],
    });
    expect(p.toUpdate).toHaveLength(2);
    expect(p.viaUnconfirmedMatch).toBe(2);
  });

  it('collapses siblings to a single parent-record change', () => {
    const p = plan({
      master: [master('Kid, Alban'), master('Kid, Maxence')],
      register: [reg('Kid, Alban / Maxence', 'parent@ex.fr')],
      app: [app('B1', 'Kid, Laurine', 'parent@ex.fr', 'October 2, 2021')],
    });
    expect(p.currentMemberCount).toBe(1);
    expect(p.toUpdate).toHaveLength(1);
    expect(p.toUpdate[0].id).toBe('B1');
  });
});
