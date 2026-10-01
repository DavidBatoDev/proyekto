import { ratesInForceOn } from './engagements.service';

/**
 * The rate rows the signing RPC leaves behind for a recorded agreement signed
 * in March with paper amendments effective June and September: each version
 * closes the one before it the day before it starts.
 */
const chain = [
  {
    source_contract_id: 'v1',
    amount: 1000,
    effective_from: '2026-03-01',
    effective_until: '2026-05-31',
  },
  {
    source_contract_id: 'v2',
    amount: 1200,
    effective_from: '2026-06-01',
    effective_until: '2026-08-31',
  },
  {
    source_contract_id: 'v3',
    amount: 1500,
    effective_from: '2026-09-01',
    effective_until: null,
  },
];

describe('past-period reports use the terms in force at the time', () => {
  it.each([
    ['2026-03-15', 'v1', 1000],
    ['2026-05-31', 'v1', 1000],
    ['2026-06-01', 'v2', 1200],
    ['2026-08-20', 'v2', 1200],
    ['2026-09-01', 'v3', 1500],
    ['2026-12-31', 'v3', 1500],
  ])('on %s it is %s at %d', (date, version, amount) => {
    const inForce = ratesInForceOn(chain, date);
    expect(inForce).toHaveLength(1);
    expect(inForce[0]).toMatchObject({
      source_contract_id: version,
      amount,
    });
  });

  it('has nothing in force before the agreement', () => {
    expect(ratesInForceOn(chain, '2026-02-28')).toEqual([]);
  });

  it('prices a quarter across versions month by month', () => {
    const months = ['2026-05-15', '2026-06-15', '2026-09-15'];
    expect(months.map((day) => ratesInForceOn(chain, day)[0].amount)).toEqual([
      1000, 1200, 1500,
    ]);
  });
});
