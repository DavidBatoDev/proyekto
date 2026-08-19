import { ForbiddenException } from '@nestjs/common';
import { RoadmapCommentSummaryService } from './roadmap-comment-summary.service';
import type { RoadmapCommentSummaryRow } from '../repositories/roadmap-comment-summary.repository.interface';

describe('RoadmapCommentSummaryService', () => {
  const roadmapId = 'rm-1';
  const userId = 'u-1';

  function build(
    rows: RoadmapCommentSummaryRow[] = [],
    assertCanViewRoadmap = jest.fn().mockResolvedValue(undefined),
  ) {
    const repo = { listForRoadmap: jest.fn().mockResolvedValue(rows) };
    const service = new RoadmapCommentSummaryService(
      repo as never,
      {
        assertCanViewRoadmap,
      } as never,
    );
    return { service, repo, assertCanViewRoadmap };
  }

  const row = (
    over: Partial<RoadmapCommentSummaryRow> = {},
  ): RoadmapCommentSummaryRow => ({
    node_type: 'task',
    node_id: 't-1',
    comment_count: 2,
    last_comment_id: 'c-9',
    last_comment_at: '2026-08-19T10:00:00.000Z',
    last_author_id: 'u-2',
    last_author_name: 'Ada Lovelace',
    last_content: '<p>Blocked until the test key lands.</p>',
    ...over,
  });

  it('authorizes the roadmap BEFORE querying', async () => {
    // The RPC is SECURITY INVOKER but runs under the service role, which
    // bypasses RLS — this assert is the access check, not a formality.
    const deny = jest.fn().mockRejectedValue(new ForbiddenException());
    const { service, repo } = build([row()], deny);

    await expect(service.list(roadmapId, userId)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(repo.listForRoadmap).not.toHaveBeenCalled();
  });

  it('maps a row into a count plus a text preview', async () => {
    const { service } = build([row()]);

    const [summary] = await service.list(roadmapId, userId);

    expect(summary).toEqual({
      node_type: 'task',
      node_id: 't-1',
      comment_count: 2,
      last_comment: {
        id: 'c-9',
        created_at: '2026-08-19T10:00:00.000Z',
        author_id: 'u-2',
        author_name: 'Ada Lovelace',
        excerpt: 'Blocked until the test key lands.',
      },
    });
  });

  it('reports a node with no comments as count 0 and no preview', async () => {
    const { service } = build([
      row({
        comment_count: 0,
        last_comment_id: null,
        last_comment_at: null,
        last_author_id: null,
        last_author_name: null,
        last_content: null,
      }),
    ]);

    const [summary] = await service.list(roadmapId, userId);

    expect(summary.comment_count).toBe(0);
    expect(summary.last_comment).toBeNull();
  });

  it('strips markup rather than leaking it into the preview', async () => {
    const { service } = build([
      row({
        last_content:
          '<p>See <span class="mention" data-user-id="u-3">@Bob</span> above</p>',
      }),
    ]);

    const [summary] = await service.list(roadmapId, userId);

    expect(summary.last_comment?.excerpt).not.toMatch(/[<>]/);
    expect(summary.last_comment?.excerpt).toContain('@Bob');
  });

  it('drops a trailing partial tag left by the RPC truncation', async () => {
    // `left(content, 2000)` can cut mid-tag, and htmlToText's regex only
    // matches CLOSED tags — so an unterminated one would survive as visible
    // markup. This is the guard for that.
    const { service } = build([
      row({ last_content: '<p>Blocked until the test key <span class="men' }),
    ]);

    const [summary] = await service.list(roadmapId, userId);

    expect(summary.last_comment?.excerpt).toBe('Blocked until the test key');
    expect(summary.last_comment?.excerpt).not.toContain('<');
  });

  it('never emits a script fragment, even from a truncated one', async () => {
    const { service } = build([
      row({ last_content: 'hi <script>alert(1)</script> there <script' }),
    ]);

    const [summary] = await service.list(roadmapId, userId);

    expect(summary.last_comment?.excerpt).not.toContain('script');
    expect(summary.last_comment?.excerpt).not.toContain('<');
  });
});
