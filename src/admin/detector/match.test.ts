import { reconcile, expandRegisterNames, MasterLink } from './match';
import {
  DetectorInput,
  MasterRow,
  RegisterRow,
  AppMember,
} from './types';

// --- tiny builders to keep the fixtures readable ---------------------------
function master(rawName: string, over: Partial<MasterRow> = {}): MasterRow {
  return { rawName, enrolDate: '2025-09-01', classNumber: '1', dayTime: '', status: 'active', renewalType: 'renewal', rowNumber: 2, ...over };
}
function reg(rawName: string, email: string, over: Partial<RegisterRow> = {}): RegisterRow {
  return { rawName, email, classId: '1', teacher: 'Sue', level: 'B1', ...over };
}
function app(id: string, rawName: string, email = '', over: Partial<AppMember> = {}): AppMember {
  return { id, rawName, email, expiryDate: '2026-09-01', ...over };
}
function input(over: Partial<DetectorInput>): DetectorInput {
  return { master: [], register: [], app: [], roster: { validClassIds: ['1', '2'] }, ...over };
}
function linkFor(ctx: ReturnType<typeof reconcile>, rawName: string): MasterLink {
  return ctx.linkByMasterRaw.get(rawName)!;
}

describe('expandRegisterNames', () => {
  it('splits combined siblings and re-attaches the surname', () => {
    expect(expandRegisterNames('CELARIER FRAUDET, Alban / Maxence')).toEqual([
      'CELARIER FRAUDET, Alban',
      'CELARIER FRAUDET, Maxence',
    ]);
  });
  it('leaves a single name untouched', () => {
    expect(expandRegisterNames('DELCOURT, Syma')).toEqual(['DELCOURT, Syma']);
  });
});

describe('reconcile — linking', () => {
  it('links an exact name match silently', () => {
    const ctx = reconcile(input({
      master: [master('Sion, François-Xavier')],
      app: [app('B1', 'Sion, François-Xavier', 'fx@ex.fr')],
    }));
    const l = linkFor(ctx, 'Sion, François-Xavier');
    expect(l.kind).toBe('exact');
    expect(l.app?.id).toBe('B1');
    expect(ctx.unmatchedApp).toHaveLength(0);
  });

  it('offers a fuzzy candidate for a spacing variant, does not treat it as exact', () => {
    const ctx = reconcile(input({
      master: [master('LEMAHIEU, Anne')],
      app: [app('B2', 'Le Mahieu, Anne', 'anne@ex.fr')],
    }));
    const l = linkFor(ctx, 'LEMAHIEU, Anne');
    expect(l.kind).toBe('fuzzy');
    expect(l.app?.id).toBe('B2');
    expect(l.distance).toBeLessThanOrEqual(2);
  });

  it('flags a real trap pair as fuzzy (surfaced, never silently merged)', () => {
    const ctx = reconcile(input({
      master: [master('Martin, Louise')],
      app: [app('B3', 'Martin, Louisa', 'lou@ex.fr')],
    }));
    const l = linkFor(ctx, 'Martin, Louise');
    // A candidate is offered, but it is fuzzy — the caller must confirm, not auto-apply.
    expect(l.kind).toBe('fuzzy');
    expect(l.distance).toBe(1);
  });

  it('bridges via a Register household email when names differ entirely', () => {
    const ctx = reconcile(input({
      master: [master('COISNE, Véronique')],
      register: [reg('COISNE, Véronique', 'xavier.sion@ex.fr')],
      app: [app('B4', 'Sion, François-Xavier', 'xavier.sion@ex.fr')],
    }));
    const l = linkFor(ctx, 'COISNE, Véronique');
    expect(l.kind).toBe('email-bridge');
    expect(l.app?.id).toBe('B4');
    expect(l.bridgeEmail).toBe('xavier.sion@ex.fr');
  });

  it('leaves a genuinely new member unlinked', () => {
    const ctx = reconcile(input({
      master: [master('Newcomer, Pat')],
      app: [app('B5', 'Established, Chris', 'chris@ex.fr')],
    }));
    expect(linkFor(ctx, 'Newcomer, Pat').kind).toBe('none');
    expect(ctx.unmatchedApp.map((a) => a.id)).toEqual(['B5']);
  });
});

describe('reconcile — children under one parent', () => {
  it('groups multiple Master child-rows onto one App record via the household email', () => {
    const ctx = reconcile(input({
      master: [
        master('CELARIER-FRAUDET, Alban'),
        master('CELARIER-FRAUDET, Maxence'),
      ],
      register: [reg('CELARIER FRAUDET, Alban / Maxence', 'laurine@ex.fr')],
      app: [app('B6', 'Celarier Fraudet, Laurine', 'laurine@ex.fr')],
    }));
    // Both children bridge to the single parent record...
    expect(linkFor(ctx, 'CELARIER-FRAUDET, Alban').app?.id).toBe('B6');
    expect(linkFor(ctx, 'CELARIER-FRAUDET, Maxence').app?.id).toBe('B6');
    // ...and surface as one sibling group.
    expect(ctx.siblingGroups).toHaveLength(1);
    expect(ctx.siblingGroups[0].app.id).toBe('B6');
    expect(ctx.siblingGroups[0].masters.map((m) => m.rawName).sort()).toEqual([
      'CELARIER-FRAUDET, Alban',
      'CELARIER-FRAUDET, Maxence',
    ]);
    expect(ctx.unmatchedApp).toHaveLength(0);
  });
});
