import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { isActiveConsultantEnrollment } from '../../../common/auth/consultant-capability';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import type {
  AddPostingAttachmentDto,
  BoardQueryDto,
  CreatePostingDto,
  SubmitProposalDto,
  TriageProposalDto,
  UpdatePostingDto,
} from './dto/postings.dto';
import type {
  PostingProposal,
  PostingProposalWithConsultant,
  PostingSection,
  ProjectPosting,
  ProjectPostingDetail,
} from './postings.types';
import {
  POSTINGS_REPOSITORY,
  type PostingsRepository,
} from './repositories/postings.repository.interface';

/** Matches the DTO's ArrayMaxSize so the author reads a sentence. */
const MAX_SECTIONS = 30;
const MAX_ATTACHMENTS = 20;
const MAX_DRAFTS = 25;
const DEFAULT_BOARD_LIMIT = 24;
const MAX_BOARD_LIMIT = 48;

/**
 * What a brief must carry before it can go on the board.
 *
 * These are the structured fields the board filters on plus the summary, NOT
 * the prose sections: sections are the flexible part and demanding particular
 * ones would defeat the point. A brief nobody can filter for is a brief nobody
 * finds, which is worse for its author than being told to fill in a budget.
 *
 * Exported because the editor renders the same list as "N missing fields"; the
 * server is the authority and the client is the convenience.
 */
export function missingPublishFields(posting: ProjectPosting): string[] {
  const missing: string[] = [];
  if (
    !posting.summary ||
    posting.summary.replace(/<[^>]*>/g, '').trim() === ''
  ) {
    missing.push('Overview');
  }
  if (posting.budget_min === null && posting.budget_max === null) {
    missing.push('Budget');
  }
  // 'custom' is the author saying "none of your buckets fit"; with nothing
  // typed beside it, that says less than leaving the field alone.
  if (
    !posting.duration ||
    (posting.duration === 'custom' && !posting.duration_custom?.trim())
  ) {
    missing.push('Timeline');
  }
  if (!posting.category_id) missing.push('Category');
  return missing;
}

/**
 * The free-text timeline, kept only where it means something.
 *
 * Anything but `duration: 'custom'` clears it, so a change of mind cannot leave
 * a sentence contradicting the bucket displayed beside it. The database enforces
 * the same pairing; this is what stops a legitimate edit from tripping it.
 */
function customDurationFor(
  duration: string | null,
  custom: string | null | undefined,
): string | null {
  if (duration !== 'custom') return null;
  const trimmed = custom?.trim();
  return trimmed ? trimmed : null;
}

@Injectable()
export class PostingsService {
  constructor(
    @Inject(POSTINGS_REPOSITORY) private readonly repo: PostingsRepository,
    @Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient,
  ) {}

  // ── Authoring ────────────────────────────────────────────────────────────

  async listMine(
    authorId: string,
  ): Promise<Array<ProjectPosting & { proposal_count: number }>> {
    const postings = await this.repo.findAllByAuthor(authorId);
    const counts = await this.repo.countProposals(
      postings.map((posting) => posting.id),
    );
    return postings.map((posting) => ({
      ...posting,
      proposal_count: counts.get(posting.id) ?? 0,
    }));
  }

  async create(
    authorId: string,
    dto: CreatePostingDto,
  ): Promise<ProjectPosting> {
    const existing = await this.repo.findAllByAuthor(authorId);
    const drafts = existing.filter((posting) => posting.status === 'draft');
    if (drafts.length >= MAX_DRAFTS) {
      throw new BadRequestException(
        `You already have ${MAX_DRAFTS} unpublished briefs. Publish or delete one to start another.`,
      );
    }

    return this.repo.create({
      author_id: authorId,
      title: dto.title,
      engagement_type: dto.engagement_type ?? 'one_time',
      summary: dto.summary ?? null,
      sections: normalizeSections(dto.sections),
      category_id: dto.category_id ?? null,
      subcategory_id: dto.subcategory_id ?? null,
      budget_min: dto.budget_min ?? null,
      budget_max: dto.budget_max ?? null,
      currency: (dto.currency ?? 'USD').toUpperCase(),
      duration: dto.duration ?? null,
      duration_custom: customDurationFor(
        dto.duration ?? null,
        dto.duration_custom,
      ),
      roadmap_id: dto.roadmap_id ?? null,
    });
  }

  async update(
    authorId: string,
    id: string,
    dto: UpdatePostingDto,
  ): Promise<ProjectPosting> {
    const posting = await this.assertAuthor(authorId, id);
    if (posting.status === 'closed') {
      throw new BadRequestException(
        'This brief is closed. Reopen it before editing.',
      );
    }

    const budgetMin = dto.budget_min ?? posting.budget_min;
    const budgetMax = dto.budget_max ?? posting.budget_max;
    if (budgetMin !== null && budgetMax !== null && budgetMin > budgetMax) {
      throw new BadRequestException(
        'The minimum budget cannot be above the maximum.',
      );
    }

    return this.repo.update(id, {
      ...(dto.title !== undefined ? { title: dto.title } : {}),
      ...(dto.engagement_type !== undefined
        ? { engagement_type: dto.engagement_type }
        : {}),
      ...(dto.summary !== undefined ? { summary: dto.summary } : {}),
      ...(dto.sections !== undefined
        ? { sections: normalizeSections(dto.sections) }
        : {}),
      ...(dto.category_id !== undefined
        ? { category_id: dto.category_id }
        : {}),
      ...(dto.subcategory_id !== undefined
        ? { subcategory_id: dto.subcategory_id }
        : {}),
      ...(dto.budget_min !== undefined ? { budget_min: dto.budget_min } : {}),
      ...(dto.budget_max !== undefined ? { budget_max: dto.budget_max } : {}),
      ...(dto.currency !== undefined
        ? { currency: dto.currency.toUpperCase() }
        : {}),
      // Written together, always: a bucket chosen after a custom answer has to
      // take the stale sentence with it, and the DB refuses the mismatched pair
      // anyway. Patch semantics stop at the pair, not at each half of it.
      ...(dto.duration !== undefined || dto.duration_custom !== undefined
        ? {
            duration: dto.duration ?? null,
            duration_custom: customDurationFor(
              dto.duration ?? null,
              dto.duration_custom,
            ),
          }
        : {}),
      ...(dto.roadmap_id !== undefined ? { roadmap_id: dto.roadmap_id } : {}),
    });
  }

  async publish(authorId: string, id: string): Promise<ProjectPosting> {
    const posting = await this.assertAuthor(authorId, id);
    const missing = missingPublishFields(posting);
    if (missing.length > 0) {
      throw new BadRequestException(
        `This brief is not ready to publish. Still missing: ${missing.join(', ')}.`,
      );
    }
    return this.repo.update(id, {
      status: 'published',
      published_at: new Date().toISOString(),
      closed_at: null,
    });
  }

  async close(authorId: string, id: string): Promise<ProjectPosting> {
    await this.assertAuthor(authorId, id);
    return this.repo.update(id, {
      status: 'closed',
      closed_at: new Date().toISOString(),
    });
  }

  async remove(authorId: string, id: string): Promise<void> {
    await this.assertAuthor(authorId, id);
    await this.repo.remove(id);
  }

  // ── Reading ──────────────────────────────────────────────────────────────

  /**
   * One brief, as whoever is asking is allowed to see it.
   *
   * A viewer with no claim gets 404, not 403 — the same posture the engagement
   * routes take, so the endpoint cannot be used to discover which brief ids
   * exist.
   */
  async getDetail(viewerId: string, id: string): Promise<ProjectPostingDetail> {
    const posting = await this.repo.findById(id);
    if (!posting) throw new NotFoundException('Brief not found.');

    const isAuthor = posting.author_id === viewerId;
    if (!isAuthor) {
      const isConsultant = await isActiveConsultantEnrollment(
        this.supabase,
        viewerId,
      );
      if (!isConsultant || posting.status !== 'published') {
        throw new NotFoundException('Brief not found.');
      }
    }

    const [authors, attachments, counts] = await Promise.all([
      this.repo.findAuthorSummaries([posting.author_id]),
      this.repo.findAttachments(posting.id),
      this.repo.countProposals([posting.id]),
    ]);

    const roadmap = posting.roadmap_id
      ? await this.repo.findRoadmapSummary(posting.roadmap_id)
      : null;

    const myProposal = isAuthor
      ? null
      : await this.repo.findProposalByConsultant(posting.id, viewerId);

    return {
      ...posting,
      author: authors.get(posting.author_id) ?? null,
      attachments,
      roadmap,
      proposal_count: counts.get(posting.id) ?? 0,
      my_proposal: myProposal,
    };
  }

  /** The consultant board. The controller's guard is what makes it consultant-only. */
  async board(
    query: BoardQueryDto,
  ): Promise<
    Array<ProjectPosting & { proposal_count: number; author: unknown }>
  > {
    const postings = await this.repo.findBoard({
      category_id: query.category_id,
      subcategory_id: query.subcategory_id,
      engagement_type: query.engagement_type,
      duration: query.duration,
      budget_min: query.budget_min,
      limit: Math.min(query.limit ?? DEFAULT_BOARD_LIMIT, MAX_BOARD_LIMIT),
      offset: query.offset ?? 0,
    });

    const [authors, counts] = await Promise.all([
      this.repo.findAuthorSummaries(
        postings.map((posting) => posting.author_id),
      ),
      this.repo.countProposals(postings.map((posting) => posting.id)),
    ]);

    return postings.map((posting) => ({
      ...posting,
      author: authors.get(posting.author_id) ?? null,
      proposal_count: counts.get(posting.id) ?? 0,
    }));
  }

  // ── Attachments ──────────────────────────────────────────────────────────

  async addAttachment(
    authorId: string,
    postingId: string,
    dto: AddPostingAttachmentDto,
  ) {
    await this.assertAuthor(authorId, postingId);
    const existing = await this.repo.findAttachments(postingId);
    if (existing.length >= MAX_ATTACHMENTS) {
      throw new BadRequestException(
        `A brief can carry up to ${MAX_ATTACHMENTS} files.`,
      );
    }
    return this.repo.addAttachment({
      posting_id: postingId,
      url: dto.url,
      name: dto.name,
      content_type: dto.content_type ?? null,
      size: dto.size ?? null,
      uploaded_by: authorId,
    });
  }

  async removeAttachment(
    authorId: string,
    postingId: string,
    attachmentId: string,
  ): Promise<void> {
    await this.assertAuthor(authorId, postingId);
    await this.repo.removeAttachment(postingId, attachmentId);
  }

  // ── Proposals ────────────────────────────────────────────────────────────

  async submitProposal(
    consultantId: string,
    postingId: string,
    dto: SubmitProposalDto,
  ): Promise<PostingProposal> {
    const posting = await this.repo.findById(postingId);
    // 404 rather than 403 for the same reason getDetail does it.
    if (!posting || posting.status !== 'published') {
      throw new NotFoundException('Brief not found.');
    }
    if (posting.author_id === consultantId) {
      throw new BadRequestException('You cannot apply to your own brief.');
    }

    return this.repo.upsertProposal({
      posting_id: postingId,
      consultant_id: consultantId,
      pitch: dto.pitch,
      indicative_rate: dto.indicative_rate ?? null,
      rate_currency: (dto.rate_currency ?? posting.currency).toUpperCase(),
      rate_unit: dto.rate_unit ?? 'project',
    });
  }

  async withdrawProposal(
    consultantId: string,
    proposalId: string,
  ): Promise<PostingProposal> {
    const proposal = await this.repo.findProposalById(proposalId);
    if (!proposal || proposal.consultant_id !== consultantId) {
      throw new NotFoundException('Proposal not found.');
    }
    return this.repo.setProposalStatus(proposalId, 'withdrawn');
  }

  async listProposals(
    authorId: string,
    postingId: string,
  ): Promise<PostingProposalWithConsultant[]> {
    await this.assertAuthor(authorId, postingId);
    return this.repo.findProposalsForPosting(postingId);
  }

  listMyProposals(consultantId: string): Promise<PostingProposal[]> {
    return this.repo.findProposalsByConsultant(consultantId);
  }

  /**
   * The author's triage. Only `status`, and only to the two decision values —
   * the DTO bounds the value, and a DB trigger (20260826100100) stops anybody
   * but the applicant touching the pitch or the rate.
   */
  async triageProposal(
    authorId: string,
    proposalId: string,
    dto: TriageProposalDto,
  ): Promise<PostingProposal> {
    const proposal = await this.repo.findProposalById(proposalId);
    if (!proposal) throw new NotFoundException('Proposal not found.');
    await this.assertAuthor(authorId, proposal.posting_id);

    if (proposal.status === 'withdrawn') {
      throw new BadRequestException('This consultant withdrew their proposal.');
    }
    return this.repo.setProposalStatus(proposalId, dto.status);
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private async assertAuthor(
    authorId: string,
    postingId: string,
  ): Promise<ProjectPosting> {
    const posting = await this.repo.findById(postingId);
    if (!posting) throw new NotFoundException('Brief not found.');
    if (posting.author_id !== authorId) {
      throw new ForbiddenException('This brief belongs to somebody else.');
    }
    return posting;
  }
}

/** Compact positions so a deleted section cannot leave a gap or a duplicate. */
function normalizeSections(
  sections: PostingSection[] | undefined,
): PostingSection[] {
  if (!sections) return [];
  return sections
    .slice(0, MAX_SECTIONS)
    .sort((a, b) => a.position - b.position)
    .map((section, index) => ({
      key: section.key,
      value: section.value,
      position: index,
    }));
}
