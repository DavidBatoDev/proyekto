import { computeContractTerm, isWithinServiceWindow } from './contract-term';

describe('computeContractTerm', () => {
  it('ends a 12-month term the day before the anniversary', () => {
    expect(
      computeContractTerm({
        serviceStartDate: '2026-08-01',
        termCount: 12,
        termUnit: 'month',
      }),
    ).toEqual({
      serviceStartDate: '2026-08-01',
      serviceEndDate: '2027-07-31',
      contractEndDate: '2027-07-31',
    });
  });

  it('treats a year term as 12 months', () => {
    const byYear = computeContractTerm({
      serviceStartDate: '2026-08-01',
      termCount: 1,
      termUnit: 'year',
    });
    const byMonth = computeContractTerm({
      serviceStartDate: '2026-08-01',
      termCount: 12,
      termUnit: 'month',
    });
    expect(byYear).toEqual(byMonth);
  });

  it('handles a mid-month start', () => {
    expect(
      computeContractTerm({
        serviceStartDate: '2026-07-16',
        termCount: 3,
        termUnit: 'month',
      }).serviceEndDate,
    ).toBe('2026-10-15');
  });

  // Month arithmetic must clamp, not roll over: Jan 31 + 1 month is Feb 28,
  // so a one-month term starting Jan 31 ends Feb 27 — never in March.
  it('clamps a month-end start into a shorter month', () => {
    expect(
      computeContractTerm({
        serviceStartDate: '2027-01-31',
        termCount: 1,
        termUnit: 'month',
      }).serviceEndDate,
    ).toBe('2027-02-27');
  });

  it('respects a leap year', () => {
    expect(
      computeContractTerm({
        serviceStartDate: '2028-01-31',
        termCount: 1,
        termUnit: 'month',
      }).serviceEndDate,
    ).toBe('2028-02-28');

    expect(
      computeContractTerm({
        serviceStartDate: '2028-02-29',
        termCount: 12,
        termUnit: 'month',
      }).serviceEndDate,
    ).toBe('2029-02-27');
  });

  it('extends the contract end past the service end by the wind-down days', () => {
    expect(
      computeContractTerm({
        serviceStartDate: '2026-08-01',
        termCount: 6,
        termUnit: 'month',
        windDownDays: 30,
      }),
    ).toEqual({
      serviceStartDate: '2026-08-01',
      serviceEndDate: '2027-01-31',
      contractEndDate: '2027-03-02',
    });
  });

  it('rejects a non-positive term', () => {
    expect(() =>
      computeContractTerm({
        serviceStartDate: '2026-08-01',
        termCount: 0,
        termUnit: 'month',
      }),
    ).toThrow(/positive whole number/);
  });
});

describe('isWithinServiceWindow', () => {
  const term = {
    serviceStartDate: '2026-08-01',
    serviceEndDate: '2027-07-31',
  };

  it.each([
    ['2026-08-01', true],
    ['2027-07-31', true],
    ['2026-12-15', true],
    ['2026-07-31', false],
    ['2027-08-01', false],
  ])('%s -> %s', (date, expected) => {
    expect(isWithinServiceWindow(term, date)).toBe(expected);
  });
});
