import {
  buildMyFinanceTotals,
  decideTeamScope,
  moneyOutFromExpenseSummary,
  type MyFinanceTeam,
  summarizeMoneyIn,
  summarizePaidToMe,
} from './my-finance-summary';

function team(partial: Partial<MyFinanceTeam>): MyFinanceTeam {
  return {
    team_id: 't',
    team_name: 'Team',
    is_owner: false,
    team_role: 'member',
    finance_role: null,
    scope: 'self',
    hours: { total_seconds: 0, month_seconds: 0, pending_seconds: 0 },
    money_in: [],
    money_out: [],
    paid_to_me: [],
    ...partial,
  };
}

describe('decideTeamScope', () => {
  it('team owner is always team scope, book or not', () => {
    expect(decideTeamScope({ isTeamOwner: true, financeRole: null })).toBe(
      'team',
    );
  });

  it.each(['owner', 'manager', 'accountant'] as const)(
    'finance role %s gets team scope',
    (role) => {
      expect(decideTeamScope({ isTeamOwner: false, financeRole: role })).toBe(
        'team',
      );
    },
  );

  it.each(['viewer', 'viewer_client', null] as const)(
    'finance role %s is self scope',
    (role) => {
      expect(decideTeamScope({ isTeamOwner: false, financeRole: role })).toBe(
        'self',
      );
    },
  );
});

describe('summarizeMoneyIn', () => {
  it('groups invoiced/collected/outstanding per currency', () => {
    const rows = summarizeMoneyIn(
      [
        { id: 'i1', currency: 'USD', total: '100.00' },
        { id: 'i2', currency: 'USD', total: 50 },
        { id: 'i3', currency: 'PHP', total: 1000 },
      ],
      new Map([
        ['i1', 100],
        ['i2', 20],
      ]),
    );
    expect(rows).toEqual([
      { currency: 'PHP', invoiced: 1000, collected: 0, outstanding: 1000 },
      { currency: 'USD', invoiced: 150, collected: 120, outstanding: 30 },
    ]);
  });
});

describe('summarizePaidToMe / moneyOutFromExpenseSummary', () => {
  it('sums payouts per currency', () => {
    expect(
      summarizePaidToMe([
        { currency: 'USD', total_amount: '10.10' },
        { currency: 'USD', total_amount: 5 },
      ]),
    ).toEqual([{ currency: 'USD', amount: 15.1 }]);
  });

  it('maps an expense summary to money-out rows', () => {
    expect(
      moneyOutFromExpenseSummary([
        {
          currency: 'USD',
          expenses_total: 30,
          payouts_total: 70,
          total: 100,
          by_category: {
            salary: 70,
            contractor: 30,
            software_subscription: 0,
            overhead: 0,
            tax_fees: 0,
            other: 0,
          },
        },
      ]),
    ).toEqual([{ currency: 'USD', payouts: 70, expenses: 30, total: 100 }]);
  });
});

describe('buildMyFinanceTotals', () => {
  const owned = team({
    team_id: 't1',
    is_owner: true,
    team_role: 'owner',
    scope: 'team',
    money_in: [
      { currency: 'USD', invoiced: 1000, collected: 600, outstanding: 400 },
    ],
    money_out: [{ currency: 'USD', payouts: 200, expenses: 100, total: 300 }],
    // Ignored in totals: already inside this team's money_out.
    paid_to_me: [{ currency: 'USD', amount: 200 }],
  });
  const memberOf = team({
    team_id: 't2',
    scope: 'self',
    paid_to_me: [
      { currency: 'USD', amount: 50 },
      { currency: 'PHP', amount: 2000 },
    ],
  });

  it('adds self-scope paid_to_me as income and nets per currency', () => {
    const totals = buildMyFinanceTotals([owned, memberOf]);
    expect(totals.money_in).toEqual([
      {
        currency: 'PHP',
        invoiced: 0,
        collected: 0,
        outstanding: 0,
        paid_to_me: 2000,
      },
      {
        currency: 'USD',
        invoiced: 1000,
        collected: 600,
        outstanding: 400,
        paid_to_me: 50,
      },
    ]);
    expect(totals.money_out).toEqual([
      { currency: 'USD', payouts: 200, expenses: 100, total: 300 },
    ]);
    // USD: 600 + 50 - 300; PHP: 2000.
    expect(totals.net).toEqual([
      { currency: 'PHP', amount: 2000 },
      { currency: 'USD', amount: 350 },
    ]);
  });

  it('nets a currency that only has money out as negative', () => {
    const totals = buildMyFinanceTotals([
      team({
        scope: 'team',
        money_out: [{ currency: 'EUR', payouts: 0, expenses: 40, total: 40 }],
      }),
    ]);
    expect(totals.net).toEqual([{ currency: 'EUR', amount: -40 }]);
    expect(totals.money_in).toEqual([]);
  });

  it('uses the deduplicated team money_in when given', () => {
    const second = team({
      team_id: 't3',
      scope: 'team',
      money_in: owned.money_in, // same project linked to both teams
    });
    const naive = buildMyFinanceTotals([owned, second]);
    expect(naive.money_in[0].invoiced).toBe(2000);

    const deduped = buildMyFinanceTotals([owned, second], owned.money_in);
    expect(deduped.money_in[0].invoiced).toBe(1000);
    expect(deduped.net).toEqual([{ currency: 'USD', amount: 300 }]);
  });

  it('empty input yields empty totals', () => {
    expect(buildMyFinanceTotals([])).toEqual({
      money_in: [],
      money_out: [],
      net: [],
    });
  });
});
