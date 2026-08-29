import { normalizeGeneratedBrief } from './brief-generator.service';

/**
 * The agent is a separate deployable on its own release cadence, so its
 * response is an untrusted boundary rather than a typed contract. These cases
 * are the shapes that would otherwise reach the editor and render as a bug.
 */
describe('normalizeGeneratedBrief', () => {
  it('numbers sections by document order rather than trusting the model', () => {
    const brief = normalizeGeneratedBrief({
      title: 'Event supplier marketplace',
      engagement_type: 'one_time',
      summary: 'A marketplace.',
      sections: [
        { key: 'Scope of work', value: '- Two user types' },
        { key: 'Deliverables', value: '- A web app' },
      ],
    });

    expect(brief.sections.map((section) => section.position)).toEqual([0, 1]);
  });

  it('drops sections with an empty heading or body, then re-numbers', () => {
    const brief = normalizeGeneratedBrief({
      title: 'T',
      summary: 'S',
      sections: [
        { key: 'Scope', value: '  ' },
        { key: '', value: 'orphaned body' },
        { key: 'Deliverables', value: '- A web app' },
      ],
    });

    expect(brief.sections).toEqual([
      { key: 'Deliverables', value: '- A web app', position: 0 },
    ]);
  });

  it('falls back to one_time for an unrecognised engagement type', () => {
    expect(
      normalizeGeneratedBrief({ engagement_type: 'whenever' }).engagement_type,
    ).toBe('one_time');
  });

  it('survives a response missing every field', () => {
    expect(normalizeGeneratedBrief({})).toEqual({
      title: '',
      engagement_type: 'one_time',
      summary: '',
      sections: [],
    });
  });

  it('ignores a non-array sections field instead of throwing', () => {
    expect(
      normalizeGeneratedBrief({ sections: 'Scope of work' }).sections,
    ).toEqual([]);
  });
});
