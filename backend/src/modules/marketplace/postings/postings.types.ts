/**
 * The marketplace's demand side: a client-authored project brief, its
 * attachments, and the proposals consultants send against it.
 *
 * "Posting" in code, "project brief" in the UI. The two names are deliberate:
 * `project_briefs` is already the brief INSIDE a project, and reusing that word
 * in code would make two very different authorization models share a
 * vocabulary. See supabase/migrations/20260826100000_project_postings.sql.
 */

/** One flexible section. Shape is identical to `project_briefs.custom_fields`. */
export interface PostingSection {
  key: string;
  value: string;
  position: number;
}

export type PostingStatus = 'draft' | 'published' | 'closed';
export type PostingEngagementType = 'ongoing' | 'one_time';
export type ProposalStatus =
  | 'submitted'
  | 'withdrawn'
  | 'shortlisted'
  | 'declined';

export interface PostingAuthorSummary {
  id: string;
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
}

export interface PostingAttachment {
  id: string;
  posting_id: string;
  url: string;
  name: string;
  content_type: string | null;
  size: number | null;
  uploaded_by: string | null;
  created_at: string;
}

/**
 * What a consultant is shown about an attached roadmap: its name and how big it
 * is. Never its contents — attaching a roadmap to a brief is a reference, not
 * an access grant, and reading the roadmap itself still needs a share.
 */
export interface PostingRoadmapSummary {
  id: string;
  name: string;
  epic_count: number;
  feature_count: number;
  task_count: number;
}

export interface ProjectPosting {
  id: string;
  author_id: string;
  title: string;
  engagement_type: PostingEngagementType;
  summary: string | null;
  sections: PostingSection[];
  category_id: string | null;
  subcategory_id: string | null;
  budget_min: number | null;
  budget_max: number | null;
  currency: string;
  duration: string | null;
  /** Free text, and only when `duration` is 'custom'. Display only. */
  duration_custom: string | null;
  roadmap_id: string | null;
  status: PostingStatus;
  published_at: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
}

/** A posting as a surface renders it, with the joins that surface needs. */
export interface ProjectPostingDetail extends ProjectPosting {
  author: PostingAuthorSummary | null;
  attachments: PostingAttachment[];
  roadmap: PostingRoadmapSummary | null;
  proposal_count: number;
  /** Set only for a consultant viewer: their own proposal, if they sent one. */
  my_proposal: PostingProposal | null;
}

export interface PostingProposal {
  id: string;
  posting_id: string;
  consultant_id: string;
  pitch: string;
  indicative_rate: number | null;
  rate_currency: string;
  rate_unit: 'project' | 'hour' | 'month';
  status: ProposalStatus;
  created_at: string;
  updated_at: string;
}

export interface PostingProposalWithConsultant extends PostingProposal {
  consultant: PostingAuthorSummary | null;
}

export interface BoardFilters {
  category_id?: string;
  subcategory_id?: string;
  engagement_type?: PostingEngagementType;
  duration?: string;
  budget_min?: number;
  limit: number;
  offset: number;
}
