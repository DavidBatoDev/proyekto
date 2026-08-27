import { resolveBookPermissions } from '../books/finance-book-permissions';
import { exportColumns } from './export-columns';
import { buildCsv, csvField } from './export-formats';

describe('exportColumns', () => {
  const COST_KEYS = ['rate', 'amount'];

  it('excludes every rate-derived column without view_costs', () => {
    const permissions = resolveBookPermissions('accountant');
    expect(permissions.view_costs).toBe(false);
    const keys = exportColumns('time_logs', permissions).map((c) => c.key);
    for (const key of COST_KEYS) expect(keys).not.toContain(key);
    expect(keys).not.toContain('currency');
  });

  it('includes rate, currency, and amount with view_costs', () => {
    const permissions = resolveBookPermissions('owner');
    const keys = exportColumns('time_logs', permissions).map((c) => c.key);
    expect(keys).toEqual(
      expect.arrayContaining(['rate', 'currency', 'amount']),
    );
  });

  it('viewer_client can never resolve cost columns, even with an override', () => {
    const permissions = resolveBookPermissions('viewer_client', {
      view_costs: true,
    });
    const keys = exportColumns('time_logs', permissions).map((c) => c.key);
    for (const key of COST_KEYS) expect(keys).not.toContain(key);
  });

  it('payout columns never include rate_snapshot-derived fields', () => {
    const keys = exportColumns('payouts', resolveBookPermissions('owner')).map(
      (c) => c.key,
    );
    expect(keys).toContain('total_amount');
    for (const key of COST_KEYS) expect(keys).not.toContain(key);
  });
});

describe('csv building', () => {
  it('passes plain fields through unquoted', () => {
    expect(csvField('hello')).toBe('hello');
    expect(csvField(42)).toBe('42');
    expect(csvField(null)).toBe('');
  });

  it('quotes fields containing commas, quotes, and newlines', () => {
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField('line1\nline2')).toBe('"line1\nline2"');
    expect(csvField('cr\rlf')).toBe('"cr\rlf"');
  });

  it('emits a BOM, header row, and quoted data rows', () => {
    const columns = [
      { key: 'a', header: 'A' },
      { key: 'b', header: 'B, or not' },
    ];
    const buffer = buildCsv(columns, [{ a: 'x"y', b: 1 }]);
    expect([...buffer.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(buffer.subarray(3).toString('utf8')).toBe(
      'A,"B, or not"\r\n"x""y",1',
    );
  });
});
