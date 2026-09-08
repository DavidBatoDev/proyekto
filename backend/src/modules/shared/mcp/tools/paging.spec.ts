import {
  MAX_OFFSET,
  cappedList,
  clampOffset,
  fetchWindow,
  pageFetchedList,
  pageFromBackend,
  pageFromStart,
  pagingClause,
  serializeToolResult,
} from './tool-helpers';

const rows = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    id: `r${index}`,
    title: `Row ${index}`,
  }));

describe('clampOffset', () => {
  it('accepts a non-negative integer and rejects everything else', () => {
    expect(clampOffset(25)).toBe(25);
    expect(clampOffset(0)).toBe(0);
    expect(clampOffset(undefined)).toBe(0);
    expect(clampOffset(-4)).toBe(0);
    expect(clampOffset('7' as unknown)).toBe(0);
    expect(clampOffset(true as unknown)).toBe(0);
    expect(clampOffset(10.9)).toBe(10);
    expect(clampOffset(1e9)).toBe(MAX_OFFSET);
  });
});

describe('fetchWindow', () => {
  it('asks for the page plus one probe row, never past the source cap', () => {
    expect(fetchWindow(0, 10, 50)).toBe(11);
    expect(fetchWindow(45, 10, 50)).toBe(50);
    expect(fetchWindow(0, 0, 50)).toBe(1);
  });
});

describe('pageFromStart', () => {
  it('reports a total only when the set is proven complete', () => {
    const page = pageFromStart(rows(7), 'tasks', {
      offset: 5,
      limit: 2,
      complete: true,
      extra: { roadmap_id: 'r1' },
    });
    expect(page).toEqual({
      roadmap_id: 'r1',
      tasks: [
        { id: 'r5', title: 'Row 5' },
        { id: 'r6', title: 'Row 6' },
      ],
      offset: 5,
      returned_tasks: 2,
      total_tasks: 7,
      next_offset: null,
    });

    const first = pageFromStart(rows(7), 'tasks', {
      offset: 0,
      limit: 3,
      complete: true,
    });
    expect(first.next_offset).toBe(3);
    expect(first.total_tasks).toBe(7);
  });

  it('omits the total and keeps advertising a next page when the fetch filled its window', () => {
    // 4 rows for offset 0 / limit 3 means the probe row came back: more exist.
    const page = pageFromStart(rows(4), 'items', {
      offset: 0,
      limit: 3,
      complete: false,
    });
    expect(page).not.toHaveProperty('total_items');
    expect(page.next_offset).toBe(3);

    // A later filter ate the probe row, but a full page still continues.
    expect(
      pageFromStart(rows(3), 'items', { offset: 0, limit: 3, complete: false })
        .next_offset,
    ).toBe(3);

    // A short page from an incomplete source is the end of what it found.
    expect(
      pageFromStart(rows(2), 'items', { offset: 0, limit: 3, complete: false })
        .next_offset,
    ).toBeNull();
  });

  it('returns an empty final page past the end', () => {
    const page = pageFromStart(rows(2), 'epics', {
      offset: 9,
      limit: 5,
      complete: true,
    });
    expect(page).toMatchObject({
      epics: [],
      offset: 9,
      returned_epics: 0,
      total_epics: 2,
      next_offset: null,
    });
  });
});

describe('pageFetchedList', () => {
  it('pages the list and carries the payload scalars through', () => {
    const page = pageFetchedList(
      { tasks: rows(4), parent_id: 'e1', parent_type: 'epic' },
      'tasks',
      { offset: 0, limit: 3, window: 4 },
    );
    expect(page).toMatchObject({
      parent_id: 'e1',
      parent_type: 'epic',
      offset: 0,
      returned_tasks: 3,
      next_offset: 3,
    });
    // Window filled, so the set is not proven complete.
    expect(page).not.toHaveProperty('total_tasks');
  });

  it('treats a short fetch as the whole set', () => {
    const page = pageFetchedList({ matches: rows(2) }, 'matches', {
      offset: 0,
      limit: 5,
      window: 6,
    });
    expect(page).toMatchObject({ total_matches: 2, next_offset: null });
  });
});

describe('pageFromBackend', () => {
  it('renames an already-paged backend result onto the tool contract', () => {
    const page = pageFromBackend(
      { tasks: rows(2), offset: 25, total: 30, next_offset: null },
      'tasks',
      { offset: 25 },
    );
    expect(page).toEqual({
      tasks: rows(2),
      offset: 25,
      returned_tasks: 2,
      total_tasks: 30,
      next_offset: null,
    });
    expect(page).not.toHaveProperty('total');
  });

  it('falls back to the requested offset when the backend sent none', () => {
    const page = pageFromBackend({ matches: rows(3) }, 'matches', {
      offset: 0,
    });
    expect(page).toMatchObject({
      offset: 0,
      returned_matches: 3,
      next_offset: null,
    });
    expect(page).not.toHaveProperty('total_matches');
  });
});

describe('cappedList', () => {
  it('bounds a non-paged list and says how many exist', () => {
    const page = cappedList(
      { projects: rows(70), workspace: { id: 'w' } },
      'projects',
      60,
    );
    expect(page).toMatchObject({
      total_projects: 70,
      returned_projects: 60,
      workspace: { id: 'w' },
    });
    expect((page.projects as unknown[]).length).toBe(60);
  });

  it('leaves a non-list value alone', () => {
    const payload = { projects: 'nope' };
    expect(cappedList(payload, 'projects', 60)).toBe(payload);
  });
});

describe('pagingClause', () => {
  it('names the cap and how to continue, matching the agent wording', () => {
    expect(pagingClause(50, 25)).toBe(
      ' Returns up to 50 per call (limit, default 25); pass offset = next_offset from the previous result to continue.',
    );
  });
});

describe('serializeToolResult', () => {
  const bigTask = (index: number) => ({
    id: `a852a3e8-f1bd-42e7-b426-ddb43e908${String(index).padStart(3, '0')}`,
    title: `Task ${index}: build the media storage and upload pipeline with large-video support`,
    status: 'in_progress',
    feature_title:
      'Build CMS create/edit/publish for articles, blogs and resources',
    epic_title: 'CMS and content pipeline',
    roadmap_name: 'PRD - Yachatdac Website',
    project_title: 'PRD - Yachatdac Website',
  });

  it('leaves a result that fits untouched', () => {
    const data = { tasks: [bigTask(0)] };
    expect(serializeToolResult(data)).toBe(JSON.stringify(data, null, 2));
  });

  it('cuts an over-large list on whole items and says how to resume', () => {
    const data = { tasks: Array.from({ length: 200 }, (_, i) => bigTask(i)) };
    const parsed = JSON.parse(serializeToolResult(data, 4000));

    expect(parsed.result_truncated).toBe(true);
    expect(parsed.total_tasks).toBe(200);
    expect(parsed.returned_tasks).toBe(parsed.tasks.length);
    expect(parsed.returned_tasks).toBeGreaterThan(0);
    expect(parsed.next_offset).toBe(parsed.returned_tasks);
    // Whole items only: every row still parses with its id intact.
    for (const task of parsed.tasks) expect(task.id).toMatch(/^a852a3e8/);
    expect(parsed.truncation_hint).toContain(`offset=${parsed.next_offset}`);
  });

  it('resumes from the page it was handed and keeps a handler total', () => {
    const data = {
      tasks: Array.from({ length: 200 }, (_, i) => bigTask(i)),
      offset: 10,
      total_tasks: 900,
    };
    const parsed = JSON.parse(serializeToolResult(data, 4000));
    expect(parsed.total_tasks).toBe(900);
    expect(parsed.next_offset).toBe(10 + parsed.returned_tasks);
  });

  it('hard-cuts a result with no list to cut', () => {
    const text = serializeToolResult({ content: 'x'.repeat(5000) }, 1000);
    expect(text.endsWith('…(truncated)')).toBe(true);
  });
});
