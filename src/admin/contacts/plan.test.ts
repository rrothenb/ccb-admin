import {
  splitName,
  membersForContact,
  buildDesiredContacts,
  diffContacts,
  isManagedLabel,
  UMBRELLA_LABEL,
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
function app(id: string, rawName: string, email: string): AppMember {
  return { id, rawName, email, expiryDate: '' };
}
function input(over: Partial<DetectorInput>): DetectorInput {
  return { master: [], register: [], app: [], roster: { validClassIds: [] }, ...over };
}
function member(over: Partial<MemberForContact> = {}): MemberForContact {
  return { appId: 'B1', name: 'Dupont, Marie', email: 'marie@ex.fr', classNumbers: ['1'], ...over };
}
function existing(email: string, over: Partial<ExistingContact> = {}): ExistingContact {
  return { email, resourceName: 'people/c1', etag: 'e', displayName: 'Dupont, Marie', labels: [UMBRELLA_LABEL, 'Class 1'], ...over };
}

describe('isManagedLabel', () => {
  it('matches the umbrella and our class/teacher/level labels', () => {
    expect(isManagedLabel(UMBRELLA_LABEL)).toBe(true);
    expect(isManagedLabel('Class 8a')).toBe(true);
    expect(isManagedLabel('Teacher Hannah')).toBe(true);
    expect(isManagedLabel('Level Intermediate')).toBe(true);
  });
  it('does not match unrelated personal labels', () => {
    expect(isManagedLabel('Family')).toBe(false);
    expect(isManagedLabel('Classmates')).toBe(false); // "Class" without a trailing " X"
    expect(isManagedLabel('Level')).toBe(false);
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
    expect(members[0].appId).toBe('B1');
    expect(members[0].classNumbers.sort()).toEqual(['8a', '8b']);
  });

  it('drops members with no usable email (can\'t be a contact)', () => {
    const ctx = reconcile(input({
      master: [m('Noemail, Nan')],
      app: [app('B1', 'Noemail, Nan', '')],
    }));
    expect(membersForContact(ctx)).toHaveLength(0);
  });
});

describe('buildDesiredContacts', () => {
  it('labels a member with umbrella + class + teacher + level', () => {
    const info = new Map([['1', { teacher: 'Hannah', level: 'Intermediate' }]]);
    const [d] = buildDesiredContacts([member()], info);
    expect(d.email).toBe('marie@ex.fr');
    expect(d.labels).toEqual(['CCB Members', 'Class 1', 'Level Intermediate', 'Teacher Hannah']);
  });

  it('omits teacher/level labels when the class info is unknown', () => {
    const [d] = buildDesiredContacts([member({ classNumbers: ['99'] })], new Map());
    expect(d.labels).toEqual(['CCB Members', 'Class 99']);
  });

  it('expands the "U Intermediate" shorthand to "Upper Intermediate" in the label', () => {
    const info = new Map([['1', { teacher: 'Hannah', level: 'U Intermediate (B2+)' }]]);
    const [d] = buildDesiredContacts([member()], info);
    expect(d.labels).toContain('Level Upper Intermediate (B2+)');
  });
});

describe('diffContacts', () => {
  const desired = (over: Partial<DesiredContact> = {}): DesiredContact => ({
    email: 'marie@ex.fr', family: 'Dupont', given: 'Marie', labels: [UMBRELLA_LABEL, 'Class 1'], ...over,
  });

  it('creates a member not yet in Contacts', () => {
    const plan = diffContacts([desired()], []);
    expect(plan.toCreate).toHaveLength(1);
    expect(plan.toCreate[0].email).toBe('marie@ex.fr');
  });

  it('removes a managed contact who is no longer a member', () => {
    const plan = diffContacts([], [existing('gone@ex.fr')]);
    expect(plan.toRemove.map((r) => r.email)).toEqual(['gone@ex.fr']);
  });

  it('leaves an identical contact unchanged', () => {
    const plan = diffContacts([desired()], [existing('marie@ex.fr')]);
    expect(plan.toUpdate).toHaveLength(0);
    expect(plan.toRemove).toHaveLength(0);
    expect(plan.unchangedCount).toBe(1);
  });

  it('computes only the label delta (add new class, drop stale one)', () => {
    const plan = diffContacts(
      [desired({ labels: [UMBRELLA_LABEL, 'Class 2', 'Teacher Ann'] })],
      [existing('marie@ex.fr', { labels: [UMBRELLA_LABEL, 'Class 1'] })]
    );
    expect(plan.toUpdate).toHaveLength(1);
    expect(plan.toUpdate[0].labelsToAdd).toEqual(['Class 2', 'Teacher Ann']);
    expect(plan.toUpdate[0].labelsToRemove).toEqual(['Class 1']);
    expect(plan.toUpdate[0].nameChanged).toBe(false);
  });

  it('flags a name change but not a mere reordering of the same name', () => {
    const changed = diffContacts([desired({ family: 'Dupont-Martin' })], [existing('marie@ex.fr')]);
    expect(changed.toUpdate[0].nameChanged).toBe(true);
    const reordered = diffContacts([desired()], [existing('marie@ex.fr', { displayName: 'Marie Dupont' })]);
    expect(reordered.toUpdate).toHaveLength(0); // same tokens → not a change
  });

  it('matches emails case-insensitively', () => {
    const plan = diffContacts([desired({ email: 'Marie@Ex.FR' })], [existing('marie@ex.fr')]);
    expect(plan.toCreate).toHaveLength(0);
    expect(plan.unchangedCount).toBe(1);
  });
});
