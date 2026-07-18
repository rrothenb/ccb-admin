import { runRules } from './rules';
import { reconcile } from './match';
import { DetectorInput, MasterRow, RegisterRow, AppMember, FindingCode } from './types';

const NOW = new Date('2026-07-09');

function master(rawName: string, over: Partial<MasterRow> = {}): MasterRow {
  return { rawName, enrolDate: '2025-09-01', classNumber: '1', dayTime: '', status: 'active', renewalType: 'renewal', rowNumber: 2, ...over };
}
function reg(rawName: string, email: string, over: Partial<RegisterRow> = {}): RegisterRow {
  return { rawName, email, classId: '1', teacher: 'Sue', level: 'B1', ...over };
}
function app(id: string, rawName: string, email = 'x@ex.fr', over: Partial<AppMember> = {}): AppMember {
  return { id, rawName, email, expiryDate: '2027-09-01', ...over };
}
function input(over: Partial<DetectorInput>): DetectorInput {
  return { master: [], register: [], app: [], roster: { validClassIds: ['1', '2', '8a', '11&12'] }, ...over };
}
function run(over: Partial<DetectorInput>) {
  return runRules(reconcile(input(over)), NOW);
}
function codes(over: Partial<DetectorInput>): FindingCode[] {
  return run(over).map((f) => f.code);
}

describe('missing enrol date no longer produces a finding (expiry is uniform)', () => {
  it('does not flag or block a Master row with no enrol date', () => {
    const findings = run({ master: [master('Nodate, Sam', { enrolDate: '' })], app: [app('B1', 'Nodate, Sam')] });
    expect(findings.some((f) => f.tier === 'block')).toBe(false);
    expect(findings.map((f) => f.code)).not.toContain('missing-enrol-date' as never);
  });
});

describe('name-collision', () => {
  it('blocks on a duplicate name within the app', () => {
    const f = run({
      app: [app('B1', 'Dupe, Alex', 'a@ex.fr'), app('B2', 'Dupe, Alex', 'b@ex.fr')],
    }).find((x) => x.code === 'name-collision')!;
    expect(f.tier).toBe('block');
  });

  it('blocks on a duplicate name within the Master', () => {
    expect(codes({
      master: [master('Dupe, Alex'), master('Dupe, Alex')],
      app: [app('B1', 'Dupe, Alex')],
    })).toContain('name-collision');
  });

  it('does not treat a Master↔app name (the join) as a collision', () => {
    expect(codes({ master: [master('Solo, Kim')], app: [app('B1', 'Solo, Kim')] }))
      .not.toContain('name-collision');
  });
});

describe('cross-presence', () => {
  it('rolls Master members not in the app but creatable (Register email) into ONE fyi', () => {
    const findings = run({
      master: [master('New, Guy')],
      register: [reg('New, Guy', 'guy@ex.fr')],
      app: [],
    }).filter((f) => f.code === 'master-not-in-app');
    expect(findings).toHaveLength(1);
    expect(findings[0].tier).toBe('fyi');
  });

  it('BLOCKS Master members not in the app AND with no email anywhere', () => {
    const f = run({ master: [master('New, Guy')], app: [] }).find((x) => x.code === 'master-no-email')!;
    expect(f.tier).toBe('block');
  });

  it('rolls active-but-not-in-Master members into ONE fyi (not per person)', () => {
    const findings = run({
      master: [master('Present, Pat')],
      app: [
        app('B1', 'Present, Pat'),
        app('B2', 'Ghost, Gone', 'g@ex.fr', { expiryDate: '2027-01-01' }),
        app('B3', 'Also, Away', 'a@ex.fr', { expiryDate: '2027-01-01' }),
      ],
    }).filter((f) => f.code === 'app-active-not-in-master');
    expect(findings).toHaveLength(1);
    expect(findings[0].tier).toBe('fyi');
    expect(findings[0].subjects).toEqual(['Also, Away', 'Ghost, Gone']); // sorted, both listed
  });

  it('ignores an EXPIRED app member missing from the Master', () => {
    expect(codes({
      master: [],
      app: [app('B2', 'Old, Timer', 'o@ex.fr', { expiryDate: '2020-01-01' })],
    })).not.toContain('app-active-not-in-master');
  });
});

describe('link quality', () => {
  it('BLOCKS a fuzzy name match (names must be exact)', () => {
    const f = run({ master: [master('Martin, Louise')], app: [app('B1', 'Martin, Louisa')] })
      .find((x) => x.code === 'fuzzy-name-match')!;
    expect(f.tier).toBe('block');
  });

  it('raises a needs-review (not block) for an email-bridge match — the household mechanism', () => {
    const f = run({
      master: [master('Coisne, Véronique')],
      register: [reg('Coisne, Véronique', 'xavier.sion@ex.fr')],
      app: [app('B1', 'Sion, François-Xavier', 'xavier.sion@ex.fr')],
    }).find((x) => x.code === 'email-bridge-match')!;
    expect(f.tier).toBe('confirm');
  });
});

describe('status contradictions', () => {
  it('flags a dropout who still attends a class in the Register', () => {
    expect(codes({
      master: [master('Leaver, Lee', { status: 'drop out' })],
      register: [reg('Leaver, Lee', 'lee@ex.fr')],
      app: [app('B1', 'Leaver, Lee', 'lee@ex.fr')],
    })).toContain('dropout-contradiction');
  });

  it('rolls unpaid-active adults into ONE fyi', () => {
    const findings = run({
      master: [master('Owe, Sonia', { paid: false }), master('Due, Dave', { paid: false })],
      app: [app('B1', 'Owe, Sonia'), app('B2', 'Due, Dave', 'd@ex.fr')],
    }).filter((x) => x.code === 'unpaid-but-active');
    expect(findings).toHaveLength(1);
    expect(findings[0].tier).toBe('fyi');
    expect(findings[0].subjects).toEqual(['Due, Dave', 'Owe, Sonia']);
  });

  it('does not flag unpaid for a member who is leaving anyway', () => {
    expect(codes({
      master: [master('Gone, Guy', { paid: false, status: 'non-renewal' })],
      app: [app('B1', 'Gone, Guy')],
    })).not.toContain('unpaid-but-active');
  });

  it('does not flag unpaid for a dependent/child row (0 fee under a parent)', () => {
    expect(codes({
      master: [master('DELCOURT, Syma - mother Ola', { paid: false })],
      app: [app('B1', 'Delcourt, Ola', 'ola@ex.fr')],
    })).not.toContain('unpaid-but-active');
  });
});

describe('class checks', () => {
  it('flags a class not in the roster', () => {
    expect(codes({ master: [master('Odd, Ollie', { classNumber: '99' })], app: [app('B1', 'Odd, Ollie')] }))
      .toContain('nonexistent-class');
  });

  it('accepts a roster class with spacing/case drift (8 A ≈ 8a)', () => {
    expect(codes({ master: [master('Kid, Kim', { classNumber: '8 A' })], app: [app('B1', 'Kid, Kim')] }))
      .not.toContain('nonexistent-class');
  });

  it('flags Master vs Register class disagreement', () => {
    expect(codes({
      master: [master('Split, Sky', { classNumber: '1' })],
      register: [reg('Split, Sky', 's@ex.fr', { classId: '2' })],
      app: [app('B1', 'Split, Sky', 's@ex.fr')],
    })).toContain('class-disagreement');
  });

  it('does NOT flag a combined-class overlap (Master "11 & 12" vs Register "11")', () => {
    expect(codes({
      master: [master('Combo, Cara', { classNumber: '11 & 12' })],
      register: [reg('Combo, Cara', 'c@ex.fr', { classId: '11' })],
      app: [app('B1', 'Combo, Cara', 'c@ex.fr')],
      roster: { validClassIds: ['11', '12'] },
    })).not.toContain('class-disagreement');
  });

  it('accepts a combined class whose components are all in the roster', () => {
    expect(codes({
      master: [master('Combo, Cara', { classNumber: '11 & 12' })],
      app: [app('B1', 'Combo, Cara', 'c@ex.fr')],
      roster: { validClassIds: ['11', '12'] },
    })).not.toContain('nonexistent-class');
  });
});

describe('email checks (current members only)', () => {
  it('BLOCKS a current member with no email', () => {
    const f = run({ master: [master('Noemail, Nan')], app: [app('B1', 'Noemail, Nan', '')] })
      .find((x) => x.code === 'missing-email')!;
    expect(f.tier).toBe('block');
  });

  it('BLOCKS a malformed email', () => {
    const f = run({ master: [master('Bad, Ben')], app: [app('B1', 'Bad, Ben', 'not-an-email')] })
      .find((x) => x.code === 'malformed-email')!;
    expect(f.tier).toBe('block');
  });

  it('flags two distinct current members sharing an email', () => {
    expect(codes({
      master: [master('One, Ann'), master('Two, Bob')],
      app: [app('B1', 'One, Ann', 'shared@ex.fr'), app('B2', 'Two, Bob', 'shared@ex.fr')],
    })).toContain('duplicate-email');
  });

  it('does not flag email problems on a non-current (unlinked) app member', () => {
    expect(codes({ master: [], app: [app('B1', 'Lapsed, Lou', '', { expiryDate: '2020-01-01' })] }))
      .not.toContain('missing-email');
  });
});

describe('children aggregated', () => {
  it('emits an fyi documenting the aggregation', () => {
    const f = run({
      master: [master('Kid, Alban'), master('Kid, Maxence')],
      register: [reg('Kid, Alban / Maxence', 'parent@ex.fr')],
      app: [app('B1', 'Kid, Laurine', 'parent@ex.fr')],
    }).find((x) => x.code === 'children-aggregated')!;
    expect(f.tier).toBe('fyi');
    expect(f.subjects).toContain('Kid, Laurine');
  });
});
