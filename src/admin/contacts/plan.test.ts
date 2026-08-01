import {
  splitName,
  membersForContact,
  buildDesiredContacts,
  diffContacts,
  isYearLabel,
  DesiredContact,
  ExistingContact,
  MemberForContact,
} from './plan';
import { reconcile } from '../detector';
import { DetectorInput, MasterRow, RegisterRow, AppMember } from '../detector/types';

function m(rawName: string, over: Partial<MasterRow> = {}): MasterRow {
  return { rawName, enrolDate: '', classNumber: '1', dayTime: '', status: 'active', renewalType: '', rowNumber: 2, ...over };
}
function reg(rawName: string, email: string, over: Partial<RegisterRow> = {}): RegisterRow {
  return { rawName, email, classId: '1', teacher: 'Sue', level: 'B1', ...over };
}
function app(id: string, rawName: string, email: string, phone = ''): AppMember {
  return { id, rawName, email, phone, expiryDate: '' };
}
function input(over: Partial<DetectorInput>): DetectorInput {
  return { master: [], register: [], app: [], roster: { validClassIds: [] }, ...over };
}
function member(over: Partial<MemberForContact> = {}): MemberForContact {
  return { id: 'B1', name: 'Dupont, Marie', email: 'marie@ex.fr', classNumbers: ['1'], ...over };
}
function existing(email: string, over: Partial<ExistingContact> = {}): ExistingContact {
  return { email, phone: '', resourceName: 'people/c1', etag: 'e', displayName: 'Dupont, Marie', labels: [], ...over };
}

describe('isYearLabel', () => {
  it('matches the year label and this year\'s class labels', () => {
    expect(isYearLabel('26/27', '26/27')).toBe(true);
    expect(isYearLabel('26/27 Class 10 Paula', '26/27')).toBe(true);
  });
  it('does not match another year, a cross-year label, or a personal one', () => {
    expect(isYearLabel('25/26 Class 10 Paula', '26/27')).toBe(false);
    expect(isYearLabel('Level Intermediate', '26/27')).toBe(false);
    expect(isYearLabel('Teacher Paula', '26/27')).toBe(false);
    expect(isYearLabel('Family', '26/27')).toBe(false);
  });
});

describe('splitName', () => {
  it('splits "Surname, First"', () => {
    expect(splitName('Dupont, Marie')).toEqual({ family: 'Dupont', given: 'Marie' });
  });
  it('handles "First Last" and single tokens', () => {
    expect(splitName('Marie Dupont')).toEqual({ family: 'Dupont', given: 'Marie' });
    expect(splitName('Cher')).toEqual({ family: 'Cher', given: '' });
  });
});

describe('membersForContact', () => {
  it('emits one member per app record and collects class numbers across siblings', () => {
    const ctx = reconcile(input({
      master: [m('Kid, Alban', { classNumber: '8a' }), m('Kid, Maxence', { classNumber: '8b' })],
      register: [reg('Kid, Alban / Maxence', 'parent@ex.fr')],
      app: [app('B1', 'Kid, Laurine', 'parent@ex.fr')],
    }));
    const members = membersForContact(ctx);
    expect(members).toHaveLength(1);
    expect(members[0].id).toBe('B1');
    expect(members[0].classNumbers.sort()).toEqual(['8a', '8b']);
  });

  it('drops members with no usable email OR phone (can\'t be a contact)', () => {
    const ctx = reconcile(input({
      master: [m('Noemail, Nan')],
      app: [app('B1', 'Noemail, Nan', '')],
    }));
    expect(membersForContact(ctx)).toHaveLength(0);
  });

  it('keeps a phone-only member (contactable by phone)', () => {
    const ctx = reconcile(input({
      master: [m('Phone, Only')],
      app: [app('B1', 'Phone, Only', '', '06 48 41 34 70')],
    }));
    const members = membersForContact(ctx);
    expect(members).toHaveLength(1);
    expect(members[0].email).toBe('');
    expect(members[0].phone).toBe('06 48 41 34 70');
  });

  // The Master says who is a member this year, so the projection can't be limited
  // to whoever the Borrowers sheet happens to hold already.
  it('includes a Master member the app does not hold yet, on their Register email', () => {
    const ctx = reconcile(input({
      master: [m('New, Guy', { classNumber: '2' })],
      register: [reg('New, Guy', 'guy@ex.fr', { classId: '2' })],
      app: [],
    }));
    const members = membersForContact(ctx);
    expect(members).toHaveLength(1);
    expect(members[0]).toMatchObject({ name: 'New, Guy', email: 'guy@ex.fr', classNumbers: ['2'] });
    expect(members[0].id).toBe('master:guy new');
  });

  it('includes a not-yet-in-app member found only by phone', () => {
    const ctx = reconcile(input({
      master: [m('Phoney, Pat')],
      register: [reg('Phoney, Pat', '', { phone: '06 48 41 34 70' })],
    }));
    expect(membersForContact(ctx)[0]).toMatchObject({ email: '', phone: '06 48 41 34 70' });
  });

  it('still drops a Master member with no contact detail anywhere', () => {
    const ctx = reconcile(input({ master: [m('Lonely, Len')] }));
    expect(membersForContact(ctx)).toHaveLength(0);
  });

  // A contact is keyed by its address, so a newcomer resolving to an address an
  // app member already holds must not quietly take it over. (The detector blocks
  // this case, so it can only appear in a preview of an unclean run.)
  it('never lets a newcomer displace the app member holding that email', () => {
    const ctx = reconcile(input({
      master: [m('Existing, Ed'), m('CALLENS, M-Christine')],
      app: [app('B1', 'Existing, Ed', 'ed@ex.fr'), app('B2', 'Callens, Marie-Christine', 'shared@ex.fr')],
      contacts: [{ rawName: 'CALLENS, M-Christine', email: 'shared@ex.fr' }],
    }));
    // The app record holding that address isn't even a current member here, which
    // is precisely why the newcomer must not inherit its contact.
    expect(membersForContact(ctx).filter((x) => x.email === 'shared@ex.fr')).toHaveLength(0);
  });

  /**
   * The property that makes projecting from the reconciliation (rather than from
   * Borrowers) safe: running the Borrowers write first must not change the
   * outcome. The pre-write projection uses the same name and the same contact
   * detail the write would create the record with, so both orders converge.
   */
  it('projects the same contact before and after the Borrowers write', () => {
    const master = [m('New, Guy', { classNumber: '2' })];
    const register = [reg('New, Guy', 'guy@ex.fr', { classId: '2' })];

    const before = membersForContact(reconcile(input({ master, register, app: [] })));
    // What the Borrowers spoke writes: the Master name verbatim + that email.
    const after = membersForContact(reconcile(input({ master, register, app: [app('B9', 'New, Guy', 'guy@ex.fr')] })));

    const shape = (list: MemberForContact[]) => list.map(({ id, ...rest }) => rest);
    expect(shape(before)).toEqual(shape(after));
  });
});

describe('buildDesiredContacts', () => {
  const info = new Map([['1', { teacher: 'Hannah', level: 'Intermediate' }]]);

  it("follows the org's own label pattern: year, year-class-teacher, level, teacher", () => {
    const [d] = buildDesiredContacts([member()], info, '26/27');
    expect(d.email).toBe('marie@ex.fr');
    expect(d.labels).toEqual(['26/27', '26/27 Class 1 Hannah', 'Level Intermediate', 'Teacher Hannah']);
  });

  it('matches the example label they already use by hand', () => {
    const paula = new Map([['10', { teacher: 'Paula', level: 'U Intermediate (B2+)' }]]);
    const [d] = buildDesiredContacts([member({ classNumbers: ['10'] })], paula, '26/27');
    expect(d.labels).toContain('26/27 Class 10 Paula');
  });

  it('drops the teacher from the class label when the class info is unknown', () => {
    const [d] = buildDesiredContacts([member({ classNumbers: ['99'] })], new Map(), '26/27');
    expect(d.labels).toEqual(['26/27', '26/27 Class 99']);
  });

  it('gives a member in two classes a label for each, plus the one year label', () => {
    const two = new Map([['11', { teacher: 'Hannah', level: 'Advanced (C1)' }], ['12', { teacher: 'Ben', level: 'Intermediate' }]]);
    const [d] = buildDesiredContacts([member({ classNumbers: ['11 & 12'] })], two, '26/27');
    expect(d.labels).toEqual([
      '26/27',
      '26/27 Class 11 Hannah',
      '26/27 Class 12 Ben',
      'Level Advanced (C1)',
      'Level Intermediate',
      'Teacher Ben',
      'Teacher Hannah',
    ]);
  });

  it('expands the "U Intermediate" shorthand to "Upper Intermediate" in the label', () => {
    const u = new Map([['1', { teacher: 'Hannah', level: 'U Intermediate (B2+)' }]]);
    const [d] = buildDesiredContacts([member()], u, '26/27');
    expect(d.labels).toContain('Level Upper Intermediate (B2+)');
  });
});

describe('diffContacts — additive only', () => {
  const YEAR = '26/27';
  const desired = (over: Partial<DesiredContact> = {}): DesiredContact => ({
    email: 'marie@ex.fr', phone: '', family: 'Dupont', given: 'Marie', labels: [YEAR, '26/27 Class 1 Hannah'], ...over,
  });

  it('creates a member not yet in Contacts', () => {
    const plan = diffContacts([desired()], [], YEAR);
    expect(plan.toCreate).toHaveLength(1);
    expect(plan.toCreate[0].email).toBe('marie@ex.fr');
    expect(plan.toCreate[0].contact).toBe('marie@ex.fr');
  });

  it('creates a phone-only member with the phone in the phone field, keyed by phone', () => {
    const plan = diffContacts([desired({ email: '', phone: '06 48 41 34 70' })], [], YEAR);
    expect(plan.toCreate).toHaveLength(1);
    expect(plan.toCreate[0].email).toBe('');
    expect(plan.toCreate[0].phone).toBe('06 48 41 34 70');
  });

  it('matches a phone-only member to their existing contact (no duplicate) despite formatting', () => {
    const plan = diffContacts(
      [desired({ email: '', phone: '06 48 41 34 70', labels: [] })],
      [existing('', { phone: '+33 6 48 41 34 70' })],
      YEAR
    );
    expect(plan.toCreate).toHaveLength(0);
    expect(plan.unchangedCount).toBe(1);
  });

  it('matches emails case-insensitively', () => {
    const plan = diffContacts([desired({ email: 'Marie@Ex.FR', labels: [] })], [existing('marie@ex.fr')], YEAR);
    expect(plan.toCreate).toHaveLength(0);
    expect(plan.unchangedCount).toBe(1);
  });

  // The point of the whole scheme: a contact the admin already has just gains
  // this year's labels. It is not duplicated, renamed, or stripped of anything.
  it('adds only the missing labels to a contact that already exists', () => {
    const plan = diffContacts(
      [desired()],
      [existing('marie@ex.fr', { labels: ['25/26', '25/26 Class 1 Hannah', 'Friends', '26/27'] })],
      YEAR
    );
    expect(plan.toUpdate).toHaveLength(1);
    expect(plan.toUpdate[0].labelsToAdd).toEqual(['26/27 Class 1 Hannah']);
  });

  it('never removes a label — last year\'s class and personal labels survive', () => {
    const plan = diffContacts(
      [desired()],
      [existing('marie@ex.fr', { labels: ['25/26 Class 4 Paula', 'Family', 'CCB Members'] })],
      YEAR
    );
    expect(plan.toUpdate[0].labelsToAdd).toEqual(['26/27', '26/27 Class 1 Hannah']);
    // There is no vocabulary for taking a label away, or for deleting a contact.
    expect(Object.keys(plan.toUpdate[0])).not.toContain('labelsToRemove');
    expect(plan).not.toHaveProperty('toRemove');
  });

  it('leaves a fully-labelled contact alone', () => {
    const plan = diffContacts([desired()], [existing('marie@ex.fr', { labels: [YEAR, '26/27 Class 1 Hannah'] })], YEAR);
    expect(plan.toUpdate).toHaveLength(0);
    expect(plan.unchangedCount).toBe(1);
  });

  // Renaming someone's address book entry is not ours to do — it's reported so
  // the admin can decide, and left alone either way.
  it('reports a differing name without changing it', () => {
    const plan = diffContacts([desired({ family: 'Dupont-Martin' })], [existing('marie@ex.fr')], YEAR);
    expect(plan.toUpdate[0].nameDiffers).toBe(true);
    expect(plan.toUpdate[0].existingName).toBe('Dupont, Marie');
    expect(plan.toUpdate[0].memberName).toBe('Dupont-Martin, Marie');
  });

  it('does not call a mere name reordering a difference', () => {
    const plan = diffContacts([desired()], [existing('marie@ex.fr', { displayName: 'Marie Dupont' })], YEAR);
    expect(plan.toUpdate[0].nameDiffers).toBe(false);
  });

  // An alumnus is a contact who simply isn't in this year's cohort. Nothing
  // happens to them at all — that's what makes them still messageable.
  it('leaves a past member entirely alone', () => {
    const plan = diffContacts([], [existing('alum@ex.fr', { labels: ['25/26', '25/26 Class 4 Paula'] })], YEAR);
    expect(plan.toCreate).toHaveLength(0);
    expect(plan.toUpdate).toHaveLength(0);
    expect(plan.staleYearLabels).toHaveLength(0);
  });

  it('reports (but does not touch) a contact still carrying THIS year\'s labels', () => {
    const plan = diffContacts(
      [],
      [existing('dropped@ex.fr', { displayName: 'Gone, Greg', labels: ['25/26', '26/27', '26/27 Class 1 Hannah'] })],
      YEAR
    );
    expect(plan.staleYearLabels).toEqual([
      { contact: 'dropped@ex.fr', displayName: 'Gone, Greg', labels: ['26/27', '26/27 Class 1 Hannah'] },
    ]);
    expect(plan.toUpdate).toHaveLength(0);
  });
});
