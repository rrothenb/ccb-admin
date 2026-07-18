import { runDetector } from './index';
import { DetectorInput, MasterRow, AppMember } from './types';

const NOW = new Date('2026-07-09');

function master(rawName: string, over: Partial<MasterRow> = {}): MasterRow {
  return { rawName, enrolDate: '2025-09-01', classNumber: '1', dayTime: '', status: 'active', renewalType: 'renewal', rowNumber: 2, ...over };
}
function app(id: string, rawName: string, email = 'x@ex.fr', over: Partial<AppMember> = {}): AppMember {
  return { id, rawName, email, expiryDate: '2027-09-01', ...over };
}
function input(over: Partial<DetectorInput>): DetectorInput {
  return { master: [], register: [], app: [], roster: { validClassIds: ['1', '2'] }, ...over };
}

describe('runDetector — gate + ordering', () => {
  it('is clean (canSync) when nothing is wrong', () => {
    const r = runDetector(input({ master: [master('Fine, Fay')], app: [app('B1', 'Fine, Fay')] }), { now: NOW });
    expect(r.findings).toHaveLength(0);
    expect(r.canSync).toBe(true);
    expect(r.counts).toEqual({ block: 0, confirm: 0, fyi: 0 });
  });

  it('blocks the sync when a fatal finding is present (name collision)', () => {
    const r = runDetector(input({
      app: [app('B1', 'Dupe, Alex', 'a@ex.fr'), app('B2', 'Dupe, Alex', 'b@ex.fr')],
    }), { now: NOW });
    expect(r.canSync).toBe(false);
    expect(r.counts.block).toBe(1);
    expect(r.findings[0].tier).toBe('block'); // block sorts first
  });

  it('orders block > confirm > fyi', () => {
    const r = runDetector(input({
      master: [
        master('Odd, Ollie', { classNumber: '99' }),    // confirm (nonexistent class)
        master('Owe, Sonia', { paid: false }),          // fyi (unpaid rollup)
      ],
      app: [
        app('B1', 'Dupe, Alex', 'a@ex.fr'),             // block: name collision...
        app('B2', 'Dupe, Alex', 'z@ex.fr'),             // ...with this one
        app('B3', 'Owe, Sonia'),
        app('B4', 'Odd, Ollie', 'o@ex.fr'),
      ],
    }), { now: NOW });
    const tiers = r.findings.map((f) => f.tier);
    const firstConfirm = tiers.indexOf('confirm');
    const firstFyi = tiers.indexOf('fyi');
    expect(tiers[0]).toBe('block');
    expect(firstConfirm).toBeLessThan(firstFyi);
  });
});

describe('runDetector — stateless (every run is fresh)', () => {
  it('produces the same findings on repeated runs (no suppression)', () => {
    const inp = input({ master: [master('Martin, Louise')], app: [app('B1', 'Martin, Louisa')] });
    const first = runDetector(inp, { now: NOW });
    const second = runDetector(inp, { now: NOW });
    expect(second.findings.map((f) => f.code)).toEqual(first.findings.map((f) => f.code));
    expect(second.findings.some((f) => f.code === 'fuzzy-name-match')).toBe(true);
  });

  it('de-duplicates findings that share a key', () => {
    const inp = input({ master: [master('New, Guy')], app: [] });
    const r = runDetector(inp, { now: NOW });
    const keys = r.findings.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
