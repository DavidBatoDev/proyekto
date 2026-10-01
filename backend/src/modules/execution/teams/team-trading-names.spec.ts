import {
  TEAM_TRADING_NAME_MAX_COUNT,
  TEAM_TRADING_NAME_MAX_LENGTH,
  normalizeTradingNames,
} from './team-tags';

describe('normalizeTradingNames', () => {
  it('trims, collapses whitespace and drops empties', () => {
    expect(
      normalizeTradingNames(['  PRODIGITALITY ', '', '  ', 'Pro   Digitality']),
    ).toEqual(['PRODIGITALITY', 'Pro Digitality']);
  });

  it('dedupes case-insensitively, keeping the first spelling', () => {
    expect(normalizeTradingNames(['PRODIGITALITY', 'Prodigitality'])).toEqual([
      'PRODIGITALITY',
    ]);
  });

  it('caps length and count, and degrades a malformed payload to []', () => {
    const long = 'x'.repeat(TEAM_TRADING_NAME_MAX_LENGTH + 10);
    expect(normalizeTradingNames([long])[0]).toHaveLength(
      TEAM_TRADING_NAME_MAX_LENGTH,
    );
    const many = Array.from({ length: 30 }, (_, i) => `Name ${i}`);
    expect(normalizeTradingNames(many)).toHaveLength(
      TEAM_TRADING_NAME_MAX_COUNT,
    );
    expect(normalizeTradingNames('PRODIGITALITY')).toEqual([]);
    expect(normalizeTradingNames([1, null, 'A'])).toEqual(['A']);
  });
});
