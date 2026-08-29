import type {
  BoardFilters,
  PostingAttachment,
  PostingProposal,
  PostingProposalWithConsultant,
  PostingRoadmapSummary,
  PostingSection,
  ProjectPosting,
  ProposalStatus,
} from '../postings.types';

export const POSTINGS_REPOSITORY = Symbol('POSTINGS_REPOSITORY');

export interface CreatePostingInput {
  author_id: string;
  title: string;
  engagement_type: string;
  summary: string | null;
  sections: PostingSection[];
  category_id: string | null;
  subcategory_id: string | null;
  budget_min: number | null;
  budget_max: number | null;
  currency: string;
  duration: string | null;
  duration_custom: string | null;
  roadmap_id: string | null;
}

export type UpdatePostingInput = Partial<
  Omit<CreatePostingInput, 'author_id'>
> & {
  status?: string;
  published_at?: string | null;
  closed_at?: string | null;
};

export interface SubmitProposalInput {
  posting_id: string;
  consultant_id: string;
  pitch: string;
  indicative_rate: number | null;
  rate_currency: string;
  rate_unit: string;
}

export interface PostingsRepository {
  findById(id: string): Promise<ProjectPosting | null>;

  /** The author's own briefs, drafts included. */
  findAllByAuthor(authorId: string): Promise<ProjectPosting[]>;

  /** Published briefs for the consultant board. */
  findBoard(filters: BoardFilters): Promise<ProjectPosting[]>;

  create(input: CreatePostingInput): Promise<ProjectPosting>;

  update(id: string, input: UpdatePostingInput): Promise<ProjectPosting>;

  remove(id: string): Promise<void>;

  findAttachments(postingId: string): Promise<PostingAttachment[]>;

  addAttachment(
    input: Omit<PostingAttachment, 'id' | 'created_at'>,
  ): Promise<PostingAttachment>;

  removeAttachment(postingId: string, attachmentId: string): Promise<void>;

  /**
   * Name and node counts for an attached roadmap — never its contents. See
   * `PostingRoadmapSummary`.
   */
  findRoadmapSummary(roadmapId: string): Promise<PostingRoadmapSummary | null>;

  findProposalById(id: string): Promise<PostingProposal | null>;

  findProposalsForPosting(
    postingId: string,
  ): Promise<PostingProposalWithConsultant[]>;

  findProposalByConsultant(
    postingId: string,
    consultantId: string,
  ): Promise<PostingProposal | null>;

  findProposalsByConsultant(consultantId: string): Promise<PostingProposal[]>;

  /** Proposal counts for a batch of postings, for the author's list. */
  countProposals(postingIds: string[]): Promise<Map<string, number>>;

  /** Insert, or overwrite the consultant's existing pitch on the same brief. */
  upsertProposal(input: SubmitProposalInput): Promise<PostingProposal>;

  setProposalStatus(
    id: string,
    status: ProposalStatus,
  ): Promise<PostingProposal>;

  /** Author display fields for a batch of user ids. */
  findAuthorSummaries(userIds: string[]): Promise<
    Map<
      string,
      {
        id: string;
        first_name: string | null;
        last_name: string | null;
        avatar_url: string | null;
      }
    >
  >;
}
