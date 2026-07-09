import { schoolYearStartYear, expiryForSchoolYear, membershipExpiry } from './expiry';

describe('schoolYearStartYear', () => {
  it('reads the two-digit tab form', () => {
    expect(schoolYearStartYear('Master File (26-27)')).toBe(2026);
    expect(schoolYearStartYear('Master File (25-26)')).toBe(2025);
  });
  it('reads a four-digit form', () => {
    expect(schoolYearStartYear('Master 2026-2027')).toBe(2026);
    expect(schoolYearStartYear('roster 2026/27')).toBe(2026);
  });
  it('returns null when there is no year', () => {
    expect(schoolYearStartYear('Office Summary')).toBeNull();
  });
});

describe('expiryForSchoolYear', () => {
  it('is one year after the school-year start (1 Sept)', () => {
    expect(expiryForSchoolYear(2026)).toBe('2027-09-01');
    expect(expiryForSchoolYear(2025)).toBe('2026-09-01');
  });
});

describe('membershipExpiry — uniform for everyone', () => {
  it('is identical regardless of when the member enrolled', () => {
    // Same Master → same expiry for the June-payer and the September-payer.
    expect(membershipExpiry('Master File (26-27)')).toBe('2027-09-01');
  });

  it('falls back to the current school year from `now` when the tab has no year', () => {
    // July 2026 is before September → the current school year started 2025.
    expect(membershipExpiry('Master File', new Date('2026-07-09'))).toBe('2026-09-01');
    // October 2026 is after September → the current school year started 2026.
    expect(membershipExpiry('Master File', new Date('2026-10-09'))).toBe('2027-09-01');
  });
});
