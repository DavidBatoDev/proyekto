import { BadRequestException } from '@nestjs/common';
import { normalizeReorderItems, reorderTempBase } from './reorder';

/**
 * This logic guarded project resources for months with no test of its own — the
 * resources spec mocks the repository, so the repository's own validation was
 * never exercised. Lifting it into a shared module for team resources is the
 * moment to fix that, because both surfaces now depend on it being right.
 */
describe('normalizeReorderItems', () => {
  const EXISTING = ['a', 'b', 'c'];

  it('returns the items sorted by position', () => {
    const out = normalizeReorderItems(
      [
        { id: 'c', position: 2 },
        { id: 'a', position: 0 },
        { id: 'b', position: 1 },
      ],
      EXISTING,
      'Link',
    );
    expect(out.map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });

  it('rejects a partial payload, which would leave a gap in the positions', () => {
    expect(() =>
      normalizeReorderItems([{ id: 'a', position: 0 }], EXISTING, 'Link'),
    ).toThrow(BadRequestException);
  });

  it('rejects duplicate ids', () => {
    expect(() =>
      normalizeReorderItems(
        [
          { id: 'a', position: 0 },
          { id: 'a', position: 1 },
          { id: 'b', position: 2 },
        ],
        EXISTING,
        'Link',
      ),
    ).toThrow(/duplicate ids/);
  });

  it('rejects an id from outside the container, so one folder cannot reorder another', () => {
    expect(() =>
      normalizeReorderItems(
        [
          { id: 'a', position: 0 },
          { id: 'b', position: 1 },
          { id: 'intruder', position: 2 },
        ],
        EXISTING,
        'Link',
      ),
    ).toThrow(/outside the container/);
  });

  it('rejects positions that do not start at 0', () => {
    expect(() =>
      normalizeReorderItems(
        [
          { id: 'a', position: 1 },
          { id: 'b', position: 2 },
          { id: 'c', position: 3 },
        ],
        EXISTING,
        'Link',
      ),
    ).toThrow(/contiguous and start at 0/);
  });

  it('rejects a gap in the middle', () => {
    expect(() =>
      normalizeReorderItems(
        [
          { id: 'a', position: 0 },
          { id: 'b', position: 1 },
          { id: 'c', position: 3 },
        ],
        EXISTING,
        'Link',
      ),
    ).toThrow(/contiguous and start at 0/);
  });

  it('names the subject, so the message says whether a folder or a link was wrong', () => {
    expect(() =>
      normalizeReorderItems([{ id: 'a', position: 0 }], EXISTING, 'Folder'),
    ).toThrow(/^Folder reorder/);
  });

  it('accepts an empty payload against an empty container', () => {
    expect(normalizeReorderItems([], [], 'Link')).toEqual([]);
  });
});

describe('reorderTempBase', () => {
  it('clears the current maximum and the rows about to be parked', () => {
    // Highest live position 5, three rows moving: the parking band must start
    // above every position either set can occupy.
    expect(reorderTempBase([0, 3, 5], 3)).toBe(1008);
  });

  it('is safe on an empty container', () => {
    expect(reorderTempBase([], 0)).toBe(1000);
  });

  it('does not go negative on unexpected input', () => {
    expect(reorderTempBase([-4], 1)).toBeGreaterThan(0);
  });
});
