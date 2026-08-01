import { planBorrowerWrites, isoToHuman } from './borrower-plan';
import { reconcile, runDetector } from './detector';
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
    expect(p.toUpdate).toEqual([
      { id: 'B1', name: 'Dupont, Marie', fromRaw: 'October 2, 2021', toISO: TARGET, via: 'exact', fromMaster: ['Dupont, Marie'] },
    ]);
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

  // The household record IS where the org keeps this person, and only the expiry
  // moves — so it's written, labelled so the admin sees the provenance.
  it('updates the household record an email bridge resolves to, flagged as such', () => {
    const p = plan({
      master: [master('Coisne, Véronique')],
      register: [reg('Coisne, Véronique', 'household@ex.fr')],
      app: [app('B1', 'Sion, François-Xavier', 'household@ex.fr', 'October 2, 2021')],
    });
    expect(p.toUpdate).toEqual([
      {
        id: 'B1',
        name: 'Sion, François-Xavier',
        fromRaw: 'October 2, 2021',
        toISO: TARGET,
        via: 'household-email',
        fromMaster: ['Coisne, Véronique'],
      },
    ]);
    expect(p.skipped).toHaveLength(0);
  });

  it('collapses several Master rows bridging to one household record into a single update', () => {
    const p = plan({
      master: [master('Kid, Alban'), master('Kid, Maxence')],
      register: [reg('Kid, Alban / Maxence', 'parent@ex.fr')],
      app: [app('B1', 'Kid Parent, Laurine', 'parent@ex.fr', 'October 2, 2021')],
    });
    expect(p.toUpdate).toHaveLength(1);
    expect(p.toUpdate[0].fromMaster).toEqual(['Kid, Alban', 'Kid, Maxence']);
    expect(p.skipped).toHaveLength(0);
  });

  it('prefers the exact-name provenance when one Master row matches exactly and another bridges', () => {
    const p = plan({
      master: [master('Sion, François-Xavier'), master('Coisne, Véronique')],
      register: [reg('Coisne, Véronique', 'household@ex.fr')],
      app: [app('B1', 'Sion, François-Xavier', 'household@ex.fr', 'October 2, 2021')],
    });
    expect(p.toUpdate).toHaveLength(1);
    expect(p.toUpdate[0].via).toBe('exact');
  });
});

describe('planBorrowerWrites — additions', () => {
  it('adds a Master person absent from the app, using the Register email', () => {
    const p = plan({
      master: [master('New, Guy', { rowNumber: 5 })],
      register: [reg('New, Guy', 'guy@ex.fr')],
      app: [],
    });
    expect(p.toAdd).toEqual([
      {
        name: 'New, Guy',
        email: 'guy@ex.fr',
        phone: '',
        contactVia: 'email from the Register, matched by name',
        contactIsGuess: false,
        expiryISO: TARGET,
        masterRow: 5,
      },
    ]);
    expect(p.skipped).toHaveLength(0);
  });

  it('skips (does not add) a Master person with no contact detail anywhere', () => {
    const p = plan({ master: [master('Lonely, Len')], register: [], app: [] });
    expect(p.toAdd).toHaveLength(0);
    expect(p.skipped).toHaveLength(1);
    expect(p.skipped[0].reason).toBe('no-email');
  });

  // A same-surname email is a guess, so it's used but flagged: the preview is
  // where the admin verifies it, and nothing is written until they Apply.
  it('adds with a same-surname household email, flagged as a guess', () => {
    const p = plan({
      master: [master('Callens, M-Christine')],
      register: [reg('Callens, Marie-Christine', 'xstine.callens@ex.fr')],
      app: [],
    });
    expect(p.toAdd).toHaveLength(1);
    expect(p.toAdd[0].email).toBe('xstine.callens@ex.fr');
    expect(p.toAdd[0].contactIsGuess).toBe(true);
    expect(p.skipped).toHaveLength(0);
  });

  it('adds a phone-only member using the phone', () => {
    const p = plan({
      master: [master('Phoney, Pat')],
      register: [reg('Phoney, Pat', '', { phone: '06 12 34 56 78' })],
      app: [],
    });
    expect(p.toAdd).toHaveLength(1);
    expect(p.toAdd[0]).toMatchObject({ email: '', phone: '06 12 34 56 78', contactIsGuess: false });
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
    // The email resolves in the app, so reconcile links via email-bridge — not an
    // add at all; that household record simply gets the new expiry.
    const p = plan({
      master: [master('Newcomer, Nia')],
      register: [reg('Newcomer, Nia', 'shared@ex.fr')],
      app: [app('B1', 'Existing, Ed', 'shared@ex.fr', 'October 2, 2021')],
    });
    expect(p.toAdd).toHaveLength(0);
    expect(p.toUpdate.map((u) => u.id)).toEqual(['B1']);
    expect(p.skipped).toHaveLength(0);
  });

  // Only reachable when the email comes from Contacts (a Register email would have
  // bridged); the address is the Contacts join key, so it must not be duplicated.
  it('skips an add whose only email (from Contacts) already belongs to an app member', () => {
    const p = plan({
      master: [master('Newcomer, Nia')],
      register: [],
      app: [app('B1', 'Existing, Ed', 'shared@ex.fr', 'October 2, 2021')],
      contacts: [{ rawName: 'Newcomer, Nia', email: 'shared@ex.fr' }],
    });
    expect(p.toAdd).toHaveLength(0);
    expect(p.skipped[0].reason).toBe('email-in-app');
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

/**
 * The contract the admin UI is built on: a clean detection and a writable
 * Borrowers plan must mean the same thing. Every skip reason has a 🛑 block-tier
 * finding behind it, and no advisory (⚠️/ℹ️) finding may withhold a write — so
 * `canSync` ⇒ no skips. The converse doesn't hold, and shouldn't: a blocker can
 * belong to the OTHER spoke (a member with no email blocks the Contacts
 * projection while the Borrowers plan is perfectly writable).
 */
describe('blocking findings vs. skipped writes', () => {
  const scenarios: { name: string; blocks: boolean; skips: boolean; input: Partial<DetectorInput> }[] = [
    {
      name: 'fuzzy name',
      blocks: true,
      skips: true,
      input: { master: [master('Adjerad, Louise')], app: [app('B1', 'Adjerad, Louisa', 'l@ex.fr', 'October 2, 2021')] },
    },
    {
      name: 'colliding Master name',
      blocks: true,
      skips: true,
      input: { master: [master('Dupe, Sam'), master('Dupe, Sam')], app: [app('B1', 'Dupe, Sam', 's@ex.fr', 'October 2, 2021')] },
    },
    { name: 'no contact detail anywhere', blocks: true, skips: true, input: { master: [master('Lonely, Len')] } },
    {
      name: 'two new people, one email',
      blocks: true,
      skips: true,
      input: {
        master: [master('Kid, Alban'), master('Kid, Maxence')],
        register: [reg('Kid, Alban', 'parent@ex.fr'), reg('Kid, Maxence', 'parent@ex.fr')],
      },
    },
    {
      name: 'new member whose only email is already in the app',
      blocks: true,
      skips: true,
      input: {
        master: [master('Newcomer, Nia')],
        app: [app('B1', 'Existing, Ed', 'shared@ex.fr', 'October 2, 2021')],
        contacts: [{ rawName: 'Newcomer, Nia', email: 'shared@ex.fr' }],
      },
    },
    {
      // A Contacts-side blocker: the member can't be projected to Contacts, but
      // their expiry write is unaffected — blocking without any skip.
      name: 'current member with no email or phone',
      blocks: true,
      skips: false,
      input: { master: [master('Silent, Sam')], app: [app('B1', 'Silent, Sam', '', 'October 2, 2021')] },
    },
    {
      // Advisory-only noise: a class disagreement, a spelling wobble and a
      // household bridge must NOT hold the write back.
      name: 'clean run carrying advisory findings',
      blocks: false,
      skips: false,
      input: {
        master: [master('Clean, Clara'), master('Coisne, Véronique')],
        register: [reg('Clean, Clara', 'clara@ex.fr', { classId: '2' }), reg('Coisne, Véronique', 'household@ex.fr')],
        app: [
          app('B1', 'Clean, Clara', 'clara@ex.fr', 'October 2, 2021'),
          app('B2', 'Sion, François-Xavier', 'household@ex.fr', 'October 2, 2021'),
        ],
      },
    },
  ];

  it.each(scenarios)('$name', ({ input: over, blocks, skips }) => {
    const full = input(over);
    const ctx = reconcile(full);
    const report = runDetector(full, { context: ctx });
    const p = planBorrowerWrites(ctx, TARGET);

    expect(report.canSync).toBe(!blocks);
    expect(p.skipped.length > 0).toBe(skips);
    // The invariant itself: a clean detection can never hide a withheld write.
    if (report.canSync) expect(p.skipped).toHaveLength(0);
  });

  it('the advisory scenario really does carry ⚠️ findings while staying writable', () => {
    const full = input(scenarios[scenarios.length - 1].input);
    const report = runDetector(full);
    expect(report.canSync).toBe(true);
    expect(report.counts.confirm).toBeGreaterThan(0);
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
