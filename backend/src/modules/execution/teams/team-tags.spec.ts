import {
  TEAM_TAG_MAX_COUNT,
  TEAM_TAG_MAX_LENGTH,
  normalizeTeamTags,
} from './team-tags';

/**
 * Tags reach this function straight from user typing, so the cases that matter
 * are the sloppy ones: stray whitespace, the same label typed twice with
 * different casing, and a paste far longer than anything meant to be a label.
 */
describe('normalizeTeamTags', () => {
  it('trims and collapses inner whitespace', () => {
    expect(normalizeTeamTags(['  design  ', 'growth\t\tteam'])).toEqual([
      'design',
      'growth team',
    ]);
  });

  it('drops empty and whitespace-only entries', () => {
    expect(normalizeTeamTags(['', '   ', '\t', 'design'])).toEqual(['design']);
  });

  it('dedupes case-insensitively, keeping the first spelling typed', () => {
    expect(normalizeTeamTags(['Beta', 'beta', 'BETA'])).toEqual(['Beta']);
  });

  it('preserves insertion order rather than sorting', () => {
    expect(normalizeTeamTags(['zulu', 'alpha', 'mike'])).toEqual([
      'zulu',
      'alpha',
      'mike',
    ]);
  });

  it('truncates an over-long tag to TEAM_TAG_MAX_LENGTH', () => {
    const [tag] = normalizeTeamTags(['x'.repeat(60)]);
    expect(tag).toHaveLength(TEAM_TAG_MAX_LENGTH);
  });

  it('caps the list at TEAM_TAG_MAX_COUNT', () => {
    const many = Array.from({ length: 50 }, (_, i) => `tag-${i}`);
    const out = normalizeTeamTags(many);
    expect(out).toHaveLength(TEAM_TAG_MAX_COUNT);
    expect(out[0]).toBe('tag-0');
  });

  it('skips non-string elements without throwing', () => {
    expect(normalizeTeamTags([1, null, undefined, {}, 'design'])).toEqual([
      'design',
    ]);
  });

  it('degrades a non-array payload to an empty list', () => {
    expect(normalizeTeamTags(undefined)).toEqual([]);
    expect(normalizeTeamTags(null)).toEqual([]);
    expect(normalizeTeamTags('design')).toEqual([]);
  });
});
