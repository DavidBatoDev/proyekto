/** One row per epic/feature/task on the roadmap, as returned by the RPC. */
export interface RoadmapCommentSummaryRow {
  node_type: 'epic' | 'feature' | 'task';
  node_id: string;
  comment_count: number;
  last_comment_id: string | null;
  last_comment_at: string | null;
  last_author_id: string | null;
  last_author_name: string | null;
  /** Raw comment HTML, truncated by the RPC. The service turns it into text. */
  last_content: string | null;
}

export interface IRoadmapCommentSummaryRepository {
  /**
   * Every node's comment count and latest-comment preview, in one call. The
   * canvas needs the whole set at once — it decorates every card on screen —
   * so this is deliberately roadmap-scoped rather than per-node.
   */
  listForRoadmap(roadmapId: string): Promise<RoadmapCommentSummaryRow[]>;
}
