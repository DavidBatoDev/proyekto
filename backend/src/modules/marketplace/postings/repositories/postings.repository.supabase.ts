import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../../config/supabase.module';
import type {
  BoardFilters,
  PostingAttachment,
  PostingAuthorSummary,
  PostingProposal,
  PostingProposalWithConsultant,
  PostingRoadmapSummary,
  PostingSection,
  ProjectPosting,
  ProposalStatus,
} from '../postings.types';
import type {
  CreatePostingInput,
  PostingsRepository,
  SubmitProposalInput,
  UpdatePostingInput,
} from './postings.repository.interface';

const POSTING_COLUMNS =
  'id, author_id, title, engagement_type, summary, sections, category_id, subcategory_id, budget_min, budget_max, currency, duration, duration_custom, roadmap_id, status, published_at, closed_at, created_at, updated_at';

const ATTACHMENT_COLUMNS =
  'id, posting_id, url, name, content_type, size, uploaded_by, created_at';

const PROPOSAL_COLUMNS =
  'id, posting_id, consultant_id, pitch, indicative_rate, rate_currency, rate_unit, status, created_at, updated_at';

const PROFILE_COLUMNS = 'id, first_name, last_name, avatar_url';

type Row = Record<string, any>;

/** PostgREST returns numeric(12,2) as a string so it cannot lose precision in
 *  a float. Every read path funnels through here so the API never emits a
 *  money field as a string. */
function toNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function toPosting(row: Row): ProjectPosting {
  return {
    ...(row as ProjectPosting),
    sections: normalizeSections(row.sections),
    budget_min: toNumber(row.budget_min),
    budget_max: toNumber(row.budget_max),
  };
}

/**
 * `sections` is jsonb the DB only checks is an array. A malformed element would
 * otherwise reach the renderer, so it is filtered and re-ordered here rather
 * than trusted.
 */
function normalizeSections(value: unknown): PostingSection[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (entry): entry is PostingSection =>
        !!entry &&
        typeof entry === 'object' &&
        typeof (entry as PostingSection).key === 'string' &&
        typeof (entry as PostingSection).value === 'string',
    )
    .map((entry, index) => ({
      key: entry.key,
      value: entry.value,
      position: typeof entry.position === 'number' ? entry.position : index,
    }))
    .sort((a, b) => a.position - b.position);
}

function toProposal(row: Row): PostingProposal {
  return {
    ...(row as PostingProposal),
    indicative_rate: toNumber(row.indicative_rate),
  };
}

@Injectable()
export class SupabasePostingsRepository implements PostingsRepository {
  constructor(
    @Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient,
  ) {}

  async findById(id: string): Promise<ProjectPosting | null> {
    const { data, error } = await this.supabase
      .from('project_postings')
      .select(POSTING_COLUMNS)
      .eq('id', id)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    return data ? toPosting(data as Row) : null;
  }

  async findAllByAuthor(authorId: string): Promise<ProjectPosting[]> {
    const { data, error } = await this.supabase
      .from('project_postings')
      .select(POSTING_COLUMNS)
      .eq('author_id', authorId)
      .order('created_at', { ascending: false });
    if (error) throw new BadRequestException(error.message);
    return ((data ?? []) as Row[]).map(toPosting);
  }

  async findBoard(filters: BoardFilters): Promise<ProjectPosting[]> {
    let query = this.supabase
      .from('project_postings')
      .select(POSTING_COLUMNS)
      .eq('status', 'published');

    if (filters.category_id)
      query = query.eq('category_id', filters.category_id);
    if (filters.subcategory_id) {
      query = query.eq('subcategory_id', filters.subcategory_id);
    }
    if (filters.engagement_type) {
      query = query.eq('engagement_type', filters.engagement_type);
    }
    if (filters.duration) query = query.eq('duration', filters.duration);
    // "Pays at least X" means the TOP of the range clears X: a brief offering
    // 500-5000 is a real answer to "show me work paying 2000+", and filtering
    // on budget_min would hide it.
    if (filters.budget_min !== undefined) {
      query = query.gte('budget_max', filters.budget_min);
    }

    const { data, error } = await query
      .order('published_at', { ascending: false })
      .range(filters.offset, filters.offset + filters.limit - 1);
    if (error) throw new BadRequestException(error.message);
    return ((data ?? []) as Row[]).map(toPosting);
  }

  async create(input: CreatePostingInput): Promise<ProjectPosting> {
    const { data, error } = await this.supabase
      .from('project_postings')
      .insert(input)
      .select(POSTING_COLUMNS)
      .single();
    if (error) throw new BadRequestException(error.message);
    return toPosting(data as Row);
  }

  async update(id: string, input: UpdatePostingInput): Promise<ProjectPosting> {
    const { data, error } = await this.supabase
      .from('project_postings')
      .update(input)
      .eq('id', id)
      .select(POSTING_COLUMNS)
      .single();
    if (error) throw new BadRequestException(error.message);
    return toPosting(data as Row);
  }

  async remove(id: string): Promise<void> {
    const { error } = await this.supabase
      .from('project_postings')
      .delete()
      .eq('id', id);
    if (error) throw new BadRequestException(error.message);
  }

  async findAttachments(postingId: string): Promise<PostingAttachment[]> {
    const { data, error } = await this.supabase
      .from('project_posting_attachments')
      .select(ATTACHMENT_COLUMNS)
      .eq('posting_id', postingId)
      .order('created_at', { ascending: true });
    if (error) throw new BadRequestException(error.message);
    return (data ?? []) as PostingAttachment[];
  }

  async addAttachment(
    input: Omit<PostingAttachment, 'id' | 'created_at'>,
  ): Promise<PostingAttachment> {
    const { data, error } = await this.supabase
      .from('project_posting_attachments')
      .insert(input)
      .select(ATTACHMENT_COLUMNS)
      .single();
    if (error) throw new BadRequestException(error.message);
    return data as PostingAttachment;
  }

  async removeAttachment(
    postingId: string,
    attachmentId: string,
  ): Promise<void> {
    const { error } = await this.supabase
      .from('project_posting_attachments')
      .delete()
      .eq('id', attachmentId)
      .eq('posting_id', postingId);
    if (error) throw new BadRequestException(error.message);
  }

  /**
   * Counts, not contents. Three round trips because features hang off epics and
   * tasks off features — there is no `roadmap_id` on either — and this runs once
   * per brief detail view, not per card.
   */
  async findRoadmapSummary(
    roadmapId: string,
  ): Promise<PostingRoadmapSummary | null> {
    const { data: roadmap, error } = await this.supabase
      .from('roadmaps')
      .select('id, name')
      .eq('id', roadmapId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!roadmap) return null;

    const { data: epics, error: epicError } = await this.supabase
      .from('roadmap_epics')
      .select('id')
      .eq('roadmap_id', roadmapId);
    if (epicError) throw new BadRequestException(epicError.message);

    const epicIds = ((epics ?? []) as Row[]).map((row) => row.id as string);
    let featureIds: string[] = [];
    if (epicIds.length > 0) {
      const { data: features, error: featureError } = await this.supabase
        .from('roadmap_features')
        .select('id')
        .in('epic_id', epicIds);
      if (featureError) throw new BadRequestException(featureError.message);
      featureIds = ((features ?? []) as Row[]).map((row) => row.id as string);
    }

    let taskCount = 0;
    if (featureIds.length > 0) {
      const { count, error: taskError } = await this.supabase
        .from('roadmap_tasks')
        .select('id', { count: 'exact', head: true })
        .in('feature_id', featureIds);
      if (taskError) throw new BadRequestException(taskError.message);
      taskCount = count ?? 0;
    }

    return {
      id: roadmap.id as string,
      name: roadmap.name as string,
      epic_count: epicIds.length,
      feature_count: featureIds.length,
      task_count: taskCount,
    };
  }

  async findProposalById(id: string): Promise<PostingProposal | null> {
    const { data, error } = await this.supabase
      .from('project_posting_proposals')
      .select(PROPOSAL_COLUMNS)
      .eq('id', id)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    return data ? toProposal(data as Row) : null;
  }

  async findProposalsForPosting(
    postingId: string,
  ): Promise<PostingProposalWithConsultant[]> {
    const { data, error } = await this.supabase
      .from('project_posting_proposals')
      .select(PROPOSAL_COLUMNS)
      .eq('posting_id', postingId)
      .order('created_at', { ascending: false });
    if (error) throw new BadRequestException(error.message);

    const proposals = ((data ?? []) as Row[]).map(toProposal);
    const consultants = await this.findAuthorSummaries(
      proposals.map((proposal) => proposal.consultant_id),
    );
    return proposals.map((proposal) => ({
      ...proposal,
      consultant: consultants.get(proposal.consultant_id) ?? null,
    }));
  }

  async findProposalByConsultant(
    postingId: string,
    consultantId: string,
  ): Promise<PostingProposal | null> {
    const { data, error } = await this.supabase
      .from('project_posting_proposals')
      .select(PROPOSAL_COLUMNS)
      .eq('posting_id', postingId)
      .eq('consultant_id', consultantId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    return data ? toProposal(data as Row) : null;
  }

  async findProposalsByConsultant(
    consultantId: string,
  ): Promise<PostingProposal[]> {
    const { data, error } = await this.supabase
      .from('project_posting_proposals')
      .select(PROPOSAL_COLUMNS)
      .eq('consultant_id', consultantId)
      .order('created_at', { ascending: false });
    if (error) throw new BadRequestException(error.message);
    return ((data ?? []) as Row[]).map(toProposal);
  }

  async countProposals(postingIds: string[]): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    if (postingIds.length === 0) return counts;

    const { data, error } = await this.supabase
      .from('project_posting_proposals')
      .select('posting_id')
      .in('posting_id', postingIds)
      .neq('status', 'withdrawn');
    if (error) throw new BadRequestException(error.message);

    for (const row of (data ?? []) as Row[]) {
      const key = row.posting_id as string;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }

  async upsertProposal(input: SubmitProposalInput): Promise<PostingProposal> {
    const { data, error } = await this.supabase
      .from('project_posting_proposals')
      .upsert(
        { ...input, status: 'submitted' },
        { onConflict: 'posting_id,consultant_id' },
      )
      .select(PROPOSAL_COLUMNS)
      .single();
    if (error) throw new BadRequestException(error.message);
    return toProposal(data as Row);
  }

  async setProposalStatus(
    id: string,
    status: ProposalStatus,
  ): Promise<PostingProposal> {
    const { data, error } = await this.supabase
      .from('project_posting_proposals')
      .update({ status })
      .eq('id', id)
      .select(PROPOSAL_COLUMNS)
      .single();
    if (error) throw new BadRequestException(error.message);
    return toProposal(data as Row);
  }

  async findAuthorSummaries(
    userIds: string[],
  ): Promise<Map<string, PostingAuthorSummary>> {
    const summaries = new Map<string, PostingAuthorSummary>();
    const unique = [...new Set(userIds)];
    if (unique.length === 0) return summaries;

    const { data, error } = await this.supabase
      .from('profiles')
      .select(PROFILE_COLUMNS)
      .in('id', unique);
    if (error) throw new BadRequestException(error.message);

    for (const row of (data ?? []) as Row[]) {
      summaries.set(row.id as string, row as PostingAuthorSummary);
    }
    return summaries;
  }
}
