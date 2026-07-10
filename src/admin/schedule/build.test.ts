import { buildSchedule, deriveClassInfo } from './build';
import { MasterRow, RegisterRow } from '../detector/types';

function m(classNumber: string, over: Partial<MasterRow> = {}): MasterRow {
  return { rawName: 'X', enrolDate: '', classNumber, dayTime: 'Mon - 15h00', status: 'active', renewalType: '', rowNumber: 2, ...over };
}
function r(classId: string, over: Partial<RegisterRow> = {}): RegisterRow {
  return { rawName: 'Y', email: '', classId, teacher: 'Paula', level: 'Intermediate (B1+)', ...over };
}
const CAP = { general: 10, story: 8 };
const NONE = new Set<string>();

describe('deriveClassInfo (from the spreadsheets only)', () => {
  it('counts enrolled from Master and reads teacher/level from Register', () => {
    const info = deriveClassInfo([m('1'), m('1'), m('2')], [r('1', { teacher: 'Ann', level: 'A2' })]);
    expect(info.get('1')).toMatchObject({ enrolled: 2, teacher: 'Ann', level: 'A2' });
    expect(info.get('2')!.enrolled).toBe(1);
  });

  it('splits "11 & 12" so the member counts in both class 11 and class 12', () => {
    const info = deriveClassInfo([m('11 & 12')], [r('11'), r('12')]);
    expect(info.get('11')!.enrolled).toBe(1);
    expect(info.get('12')!.enrolled).toBe(1);
    expect(info.has('11&12')).toBe(false);
  });
});

describe('buildSchedule — capacity + places', () => {
  it('uses the general capacity for adult classes', () => {
    const { rows } = buildSchedule([m('1'), m('1'), m('1')], [r('1')], CAP, NONE);
    expect(rows[0]).toMatchObject({ capacity: 10, enrolled: 3, placesAvailable: 7, storyTime: false });
  });

  it('never goes negative (over capacity → 0 places)', () => {
    const { rows } = buildSchedule(Array.from({ length: 12 }, () => m('9')), [r('9')], CAP, NONE);
    expect(rows[0].placesAvailable).toBe(0);
  });
});

describe('buildSchedule — Story Time detection', () => {
  it('flags a class whose teacher is a "Children" teacher (signal 1)', () => {
    const children = new Set(['rebecca']);
    const { rows, warnings } = buildSchedule([m('8a'), m('8a')], [r('8a', { teacher: 'Rebecca', level: '6/7 yrs - Good English' })], CAP, children);
    expect(rows[0]).toMatchObject({ storyTime: true, capacity: 8, placesAvailable: 6 });
    expect(warnings).toHaveLength(0); // both signals agree
  });

  it('flags a class whose level has a kids age-marker (signal 2)', () => {
    const { rows } = buildSchedule([m('8b')], [r('8b', { teacher: 'Rebecca', level: '5 ans' })], CAP, NONE);
    expect(rows[0].storyTime).toBe(true);
    expect(rows[0].capacity).toBe(8);
  });

  it('warns when the two signals disagree', () => {
    const children = new Set(['rebecca']);
    // teacher says Children, but the level looks adult → disagreement
    const { rows, warnings } = buildSchedule([m('8a')], [r('8a', { teacher: 'Rebecca', level: 'Intermediate (B1+)' })], CAP, children);
    expect(rows[0].storyTime).toBe(true); // OR of the two signals
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/signals disagree/i);
  });

  it('leaves an ordinary adult class untouched (no signal)', () => {
    const { rows, warnings } = buildSchedule([m('1')], [r('1', { teacher: 'Hannah', level: 'Intermediate (B1+)' })], CAP, NONE);
    expect(rows[0].storyTime).toBe(false);
    expect(rows[0].capacity).toBe(10);
    expect(warnings).toHaveLength(0);
  });
});
