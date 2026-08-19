import { Inject, Injectable } from '@nestjs/common';
import { htmlToText } from '../../../../common/utils/html-to-text.util';
import {
  IRoadmapCommentSummaryRepository,
  RoadmapCommentSummaryRow,
} from '../repositories/roadmap-comment-summary.repository.interface';
import { RoadmapAuthorizationService } from './roadmap-authorization.service';

export const ROADMAP_COMMENT_SUMMARY_REPOSITORY = Symbol(
  'ROADMAP_COMMENT_SUMMARY_REPOSITORY',
);

/**
 * How much of the latest comment to carry into a canvas hover preview. Short
 * on purpose: this is a teaser that says "there is a conversation here and
 * roughly what about", not a substitute for opening the thread.
 */
export const COMMENT_PREVIEW_MAX_CHARS = 140;

export interface CommentPreview {
  id: string;
  created_at: string;
  author_id: string | null;
  author_name: string | null;
  excerpt: string;
}

export interface NodeCommentSummary {
  node_type: 'epic' | 'feature' | 'task';
  node_id: string;
  comment_count: number;
  last_comment: CommentPreview | null;
}

/**
 * Comment counts and previews for every node on a roadmap.
 *
 * Roadmap-scoped for the same reason feature dependencies are: the canvas
 * decorates every card on screen at once, so a per-node endpoint would mean N
 * requests for one paint. Deliberately NOT folded into GET /roadmaps/:id/full,
 * which is the hottest read in the app and is needed on loads that never look
 * at a comment.
 */
@Injectable()
export class RoadmapCommentSummaryService {
  constructor(
    @Inject(ROADMAP_COMMENT_SUMMARY_REPOSITORY)
    private readonly repo: IRoadmapCommentSummaryRepository,
    private readonly roadmapAuthz: RoadmapAuthorizationService,
  ) {}

  async list(roadmapId: string, userId: string): Promise<NodeCommentSummary[]> {
    // The RPC is SECURITY INVOKER but we call it as the service role, which
    // bypasses RLS — so this assert is the access check, not a formality.
    await this.roadmapAuthz.assertCanViewRoadmap(roadmapId, userId);
    const rows = await this.repo.listForRoadmap(roadmapId);
    return rows.map((row) => this.toSummary(row));
  }

  private toSummary(row: RoadmapCommentSummaryRow): NodeCommentSummary {
    const count = Math.max(0, Number(row.comment_count) || 0);
    return {
      node_type: row.node_type,
      node_id: row.node_id,
      comment_count: count,
      last_comment:
        row.last_comment_id && row.last_comment_at
          ? {
              id: row.last_comment_id,
              created_at: row.last_comment_at,
              author_id: row.last_author_id,
              author_name: row.last_author_name,
              excerpt: this.toExcerpt(row.last_content),
            }
          : null,
    };
  }

  /**
   * Comment bodies are editor-authored HTML. The RPC truncates them with
   * `left(content, 2000)`, which can cut mid-tag — and htmlToText's tag regex
   * only matches CLOSED tags, so an unterminated `<span class="men` would
   * survive into the preview as visible markup. Drop any trailing partial tag
   * before stripping. The client renders the result as text, never as HTML.
   */
  private toExcerpt(raw: string | null): string {
    if (!raw) return '';
    return htmlToText(raw.replace(/<[^>]*$/, ''), COMMENT_PREVIEW_MAX_CHARS);
  }
}
