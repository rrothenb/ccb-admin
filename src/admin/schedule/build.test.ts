import { buildSchedule, deriveClassInfo, weeksLeft } from './build';
import { RosterClass } from './roster';
import { MasterRow, RegisterRow } from '../detector/types';

const NOW = new Date('2026-10-01');

function m(classNumber: string, over: Partial<MasterRow> = {}): MasterRow {
  return { rawName: 'X', enrolDate: '', classNumber, dayTime: 'Monday 10h00-12h00', status: 'active', renewalType: '', rowNumber: 2, ...over };
}
function r(classId: string, over: Partial<RegisterRow> = {}): RegisterRow {
  return { rawName: 'Y', email: '', classId, teacher: 'Sue', level: 'B1', ...over };
}
function rc(id: string, over: Partial<RosterClass> = {}): RosterClass {
  return { id, fee: '', totalWeeks: null, termStart: '', ...over };
}
const CAP = { general: 10, story: 8 };

describe('deriveClassInfo (from the spreadsheets only)', () => {
  it('counts enrolled from Master and reads teacher/level from Register', () => {
    const info = deriveClassInfo([m('1'), m('1'), m('2')], [r('1', { teacher: 'Ann', level: 'A2' })]);
    expect(info.get('1')).toMatchObject({ enrolled: 2, teacher: 'Ann', level: 'A2' });
    expect(info.get('2')!.enrolled).toBe(1);
  });

  it('normalizes combined/spaced class ids', () => {
    const info = deriveClassInfo([m('11 & 12')], [r('11&12')]);
    expect(info.has('11&12')).toBe(true);
  });

  it('takes the modal DAY/TIME across the class members', () => {
    const info = deriveClassInfo(
      [m('1', { dayTime: 'Tue 9h' }), m('1', { dayTime: 'Tue 9h' }), m('1', { dayTime: 'typo' })],
      []
    );
    expect(info.get('1')!.dayTime).toBe('Tue 9h');
  });
});

describe('weeksLeft', () => {
  it('is null when term dates are unknown (not in the spreadsheets)', () => {
    expect(weeksLeft('', 10, NOW)).toBeNull();
    expect(weeksLeft('2026-09-01', null, NOW)).toBeNull();
  });
});

describe('buildSchedule', () => {
  it('derives teacher/level/day-time/enrolment from the uploads', () => {
    const rows = buildSchedule([rc('1')], [m('1'), m('1')], [r('1', { teacher: 'Ann', level: 'B2' })], CAP, NOW);
    expect(rows[0]).toMatchObject({ id: '1', teacher: 'Ann', level: 'B2', enrolled: 2 });
  });

  it('computes places = general capacity − enrolled for a normal class', () => {
    const rows = buildSchedule([rc('1')], [m('1'), m('1'), m('1')], [r('1')], CAP, NOW);
    expect(rows[0].capacity).toBe(10);
    expect(rows[0].placesAvailable).toBe(7);
  });

  it('uses the Story Time capacity for flagged classes', () => {
    const rows = buildSchedule([rc('8a', { storyTime: true })], [m('8a'), m('8a')], [r('8a')], CAP, NOW);
    expect(rows[0].capacity).toBe(8);
    expect(rows[0].placesAvailable).toBe(6);
  });

  it('never goes negative (over-capacity shows 0 places)', () => {
    const rows = buildSchedule([rc('9')], Array.from({ length: 12 }, () => m('9')), [r('9')], CAP, NOW);
    expect(rows[0].placesAvailable).toBe(0);
  });

  it('leaves Weeks/Fee unknown (null/"") when the roster has no term/fee', () => {
    const rows = buildSchedule([rc('1')], [m('1')], [r('1')], CAP, NOW);
    expect(rows[0].weeksLeft).toBeNull();
    expect(rows[0].fee).toBe('');
  });

  it('includes a class present in the data but missing from the roster (general capacity)', () => {
    const rows = buildSchedule([rc('1')], [m('1'), m('99')], [r('1'), r('99')], CAP, NOW);
    expect(rows.map((x) => x.id)).toEqual(['1', '99']);
    expect(rows.find((x) => x.id === '99')!.capacity).toBe(10);
  });
});
