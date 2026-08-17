import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import { ACTIVITY_ACTIONS } from '../../shared/audit/activity-actions';
import { AuditService } from '../../shared/audit/audit.service';
import { NotificationsService } from '../../shared/notifications/notifications.service';
import { ProjectAuthorizationService } from '../projects/authorization/project-authorization.service';
import { normalizeLinkTargets } from './delivery-links';
import type { ChangeRequestRow } from './delivery.types';
import type {
  CreateChangeRequestDto,
  DecideChangeRequestDto,
  LinkTargetDto,
  ListChangeRequestsQueryDto,
  MarkChangeRequestAppliedDto,
  UpdateChangeRequestDto,
} from './dto/delivery.dto';

const TABLE = 'project_change_requests';
const LINKS_TABLE = 'change_request_links';

/**
 * Link parents are embedded upward so a card or the detail page can render the
 * Epic → Feature → Task trail from one read, matching how `deliverables.service`
 * selects `deliverable_links`. `applied_change` comes along for the same reason:
 * the detail page states what actually landed on the roadmap.
 */
const SELECT =
  'id, project_id, roadmap_id, reference, title, description, requested_by, ' +
  'impact_scope, impact_timeline_days, target_date_before, target_date_after, ' +
  'status, decided_by, decided_at, decision_note, applied_change_id, ' +
  'applied_by, applied_at, created_at, updated_at, ' +
  'links:change_request_links(' +
  'id, epic_id, feature_id, task_id, deliverable_id, position, ' +
  'epic:roadmap_epics(id, title, status), ' +
  'feature:roadmap_features(id, title, status, epic:roadmap_epics(id, title, status)), ' +
  'task:roadmap_tasks(' +
  'id, title, status, ' +
  'feature:roadmap_features(id, title, status, epic:roadmap_epics(id, title, status))' +
  '), ' +
  'deliverable:project_deliverables(id, title, status)' +
  '), ' +
  'applied_change:roadmap_change_history!project_change_requests_applied_change_id_fkey(' +
  'change_id, committed_at, operations_count, semantic_change_count' +
  ')';

const LINK_COLUMNS = [
  'epic_id',
  'feature_id',
  'task_id',
  'deliverable_id',
] as const;

/** Statuses a request can still be edited or withdrawn from. */
const OPEN_STATUSES = ['draft', 'changes_requested'];

/**
 * The filter chips on the list page, as status sets.
 *
 * `open` is "still in play" — not yet decided, so it includes a submitted
 * request awaiting someone. `decided` deliberately includes `applied`, because
 * an applied request was necessarily approved first.
 */
const VIEW_STATUSES: Record<string, string[]> = {
  open: ['draft', 'submitted', 'changes_requested'],
  awaiting_decision: ['submitted'],
  decided: ['approved', 'applied', 'rejected'],
  closed: ['rejected', 'withdrawn'],
};

/**
 * Change requests — the scope-change record the contract template already
 * promises clients but nothing implemented.
 *
 * Approving does NOT touch the roadmap. It unlocks `markApplied`, which the
 * caller reaches only after running the normal roadmap preview -> commit
 * round trip, because a request approved days ago carries a stale revision
 * token and auto-applying it would either 409 or clobber concurrent edits.
 */
@Injectable()
export class ChangeRequestsService {
  private readonly logger = new Logger(ChangeRequestsService.name);

  constructor(
    @Inject(SUPABASE_ADMIN) private readonly db: SupabaseClient,
    private readonly authorization: ProjectAuthorizationService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(
    projectId: string,
    userId: string,
    query: ListChangeRequestsQueryDto,
  ) {
    await this.authorization.assertPermission(
      userId,
      projectId,
      'access.delivery',
    );

    let builder = this.db
      .from(TABLE)
      .select(SELECT)
      .eq('project_id', projectId)
      .order('created_at', { ascending: false });

    // An exact status always wins over the coarse view — it is the more
    // specific intent, and applying both would silently AND them.
    if (query.status) {
      builder = builder.eq('status', query.status);
    } else if (query.view && query.view !== 'all') {
      builder = builder.in('status', VIEW_STATUSES[query.view]);
    }

    if (query.requested_by) {
      builder = builder.eq('requested_by', query.requested_by);
    }

    const { data, error } = await builder.overrideTypes<
      ChangeRequestRow[],
      { merge: false }
    >();
    if (error) {
      throw new InternalServerErrorException(
        `Failed to list change requests: ${error.message}`,
      );
    }
    return data ?? [];
  }

  async get(projectId: string, id: string, userId: string) {
    await this.authorization.assertPermission(
      userId,
      projectId,
      'access.delivery',
    );
    return this.loadOrThrow(projectId, id);
  }

  async create(projectId: string, userId: string, dto: CreateChangeRequestDto) {
    await this.authorization.assertPermission(
      userId,
      projectId,
      'change_requests.create',
    );

    const links = normalizeLinkTargets(dto.links, LINK_COLUMNS);
    const reference = await this.nextReference(projectId);

    const { data, error } = await this.db
      .from(TABLE)
      .insert({
        project_id: projectId,
        roadmap_id: dto.roadmap_id ?? null,
        reference,
        title: dto.title,
        description: dto.description ?? null,
        requested_by: userId,
        impact_scope: dto.impact_scope ?? null,
        impact_timeline_days: dto.impact_timeline_days ?? null,
        target_date_before: dto.target_date_before ?? null,
        target_date_after: dto.target_date_after ?? null,
        status: dto.submit ? 'submitted' : 'draft',
      })
      .select(SELECT)
      .single()
      .overrideTypes<ChangeRequestRow, { merge: false }>();

    if (error || !data) {
      throw new InternalServerErrorException(
        `Failed to create change request: ${error?.message ?? 'unknown error'}`,
      );
    }

    if (links.length) {
      const { error: linkError } = await this.db.from(LINKS_TABLE).insert(
        links.map((link, index) => ({
          change_request_id: data.id,
          position: index,
          ...link,
        })),
      );
      if (linkError) {
        throw new InternalServerErrorException(
          `Failed to link the change request: ${linkError.message}`,
        );
      }
    }

    this.audit.log({
      projectId,
      actorId: userId,
      action: ACTIVITY_ACTIONS.CHANGE_REQUEST_CREATED,
      entityType: 'change_request',
      entityId: data.id,
      roadmapId: dto.roadmap_id ?? null,
      metadata: { title: dto.title, reference },
    });

    if (dto.submit) {
      this.audit.log({
        projectId,
        actorId: userId,
        action: ACTIVITY_ACTIONS.CHANGE_REQUEST_SUBMITTED,
        entityType: 'change_request',
        entityId: data.id,
        metadata: { title: dto.title, reference },
      });
      // Raise-and-submit in one step must notify too, or the most common path —
      // someone raising a request and sending it straight on — reaches nobody.
      await this.notify({
        projectId,
        request: data,
        actorId: userId,
        typeName: 'change_request_submitted',
        message: 'needs a decision.',
        audience: { deciders: true },
      });
    }

    return links.length ? this.loadOrThrow(projectId, data.id) : data;
  }

  async update(
    projectId: string,
    id: string,
    userId: string,
    dto: UpdateChangeRequestDto,
  ) {
    await this.authorization.assertPermission(
      userId,
      projectId,
      'change_requests.create',
    );
    const existing = await this.loadOrThrow(projectId, id);
    this.assertEditable(existing, 'be edited');

    const patch = this.pick(dto, [
      'title',
      'description',
      'impact_scope',
      'impact_timeline_days',
      'target_date_before',
      'target_date_after',
      'roadmap_id',
    ]);
    if (Object.keys(patch).length === 0) return existing;

    const { data, error } = await this.db
      .from(TABLE)
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('project_id', projectId)
      .select(SELECT)
      .single()
      .overrideTypes<ChangeRequestRow, { merge: false }>();

    if (error || !data) {
      throw new InternalServerErrorException(
        `Failed to update change request: ${error?.message ?? 'unknown error'}`,
      );
    }

    this.audit.log({
      projectId,
      actorId: userId,
      action: ACTIVITY_ACTIONS.CHANGE_REQUEST_UPDATED,
      entityType: 'change_request',
      entityId: id,
      metadata: {
        title: data.title,
        reference: data.reference,
        changes: Object.keys(patch),
      },
    });

    return data;
  }

  async submit(projectId: string, id: string, userId: string) {
    await this.authorization.assertPermission(
      userId,
      projectId,
      'change_requests.create',
    );
    const existing = await this.loadOrThrow(projectId, id);
    this.assertEditable(existing, 'be submitted');

    const data = await this.setStatus(projectId, id, { status: 'submitted' });

    this.audit.log({
      projectId,
      actorId: userId,
      action: ACTIVITY_ACTIONS.CHANGE_REQUEST_SUBMITTED,
      entityType: 'change_request',
      entityId: id,
      metadata: {
        title: data.title,
        reference: data.reference,
      },
    });

    await this.notify({
      projectId,
      request: data,
      actorId: userId,
      typeName: 'change_request_submitted',
      message: 'needs a decision.',
      audience: { deciders: true },
    });

    return data;
  }

  async withdraw(projectId: string, id: string, userId: string) {
    await this.authorization.assertPermission(
      userId,
      projectId,
      'change_requests.create',
    );
    const existing = await this.loadOrThrow(projectId, id);

    if (['applied', 'withdrawn'].includes(existing.status as string)) {
      throw new BadRequestException(
        `A change request in ${existing.status as string} cannot be withdrawn.`,
      );
    }

    const data = await this.setStatus(projectId, id, { status: 'withdrawn' });

    this.audit.log({
      projectId,
      actorId: userId,
      action: ACTIVITY_ACTIONS.CHANGE_REQUEST_WITHDRAWN,
      entityType: 'change_request',
      entityId: id,
      metadata: {
        title: data.title,
        reference: data.reference,
      },
    });

    return data;
  }

  async decide(
    projectId: string,
    id: string,
    userId: string,
    dto: DecideChangeRequestDto,
  ) {
    await this.authorization.assertPermission(
      userId,
      projectId,
      'change_requests.decide',
    );
    const existing = await this.loadOrThrow(projectId, id);

    if (existing.status !== 'submitted') {
      throw new BadRequestException(
        'Only a submitted change request can be decided.',
      );
    }

    const data = await this.setStatus(projectId, id, {
      status: dto.decision,
      decided_by: userId,
      decided_at: new Date().toISOString(),
      decision_note: dto.decision_note ?? null,
    });

    const action =
      dto.decision === 'approved'
        ? ACTIVITY_ACTIONS.CHANGE_REQUEST_APPROVED
        : dto.decision === 'rejected'
          ? ACTIVITY_ACTIONS.CHANGE_REQUEST_REJECTED
          : ACTIVITY_ACTIONS.CHANGE_REQUEST_CHANGES_REQUESTED;

    this.audit.log({
      projectId,
      actorId: userId,
      action,
      entityType: 'change_request',
      entityId: id,
      metadata: {
        title: data.title,
        reference: data.reference,
      },
    });

    // The requester has been waiting on exactly this, so they hear it regardless
    // of which way it went.
    //
    // An approval additionally reaches everyone who can decide, because approval
    // does not write the roadmap — somebody still has to apply it, and that takes
    // `change_requests.decide`. A rejection ends the thread, so it goes no
    // further than the person who asked.
    await this.notify({
      projectId,
      request: data,
      actorId: userId,
      typeName: 'change_request_decided',
      message:
        dto.decision === 'approved'
          ? 'was approved and is ready to apply to the roadmap.'
          : dto.decision === 'rejected'
            ? 'was rejected.'
            : 'needs changes before it can be decided.',
      audience: {
        requester: true,
        deciders: dto.decision === 'approved',
      },
    });

    return data;
  }

  /**
   * Record that an approved change actually reached the roadmap.
   *
   * The caller supplies the `change_id` from a completed roadmap commit — this
   * endpoint deliberately does not perform the commit itself, so the roadmap's
   * optimistic-concurrency protocol stays the single writer.
   */
  async markApplied(
    projectId: string,
    id: string,
    userId: string,
    dto: MarkChangeRequestAppliedDto,
  ) {
    await this.authorization.assertPermission(
      userId,
      projectId,
      'change_requests.decide',
    );
    const existing = await this.loadOrThrow(projectId, id);

    if (existing.status !== 'approved') {
      throw new BadRequestException(
        'Only an approved change request can be marked as applied.',
      );
    }

    const { data: commit, error: commitError } = await this.db
      .from('roadmap_change_history')
      .select('change_id, project_id')
      .eq('change_id', dto.applied_change_id)
      .maybeSingle();

    if (commitError) {
      throw new InternalServerErrorException(
        `Failed to verify the roadmap commit: ${commitError.message}`,
      );
    }
    if (!commit || commit.project_id !== projectId) {
      throw new BadRequestException(
        'That roadmap change does not belong to this project.',
      );
    }

    const data = await this.setStatus(projectId, id, {
      status: 'applied',
      applied_change_id: dto.applied_change_id,
      applied_by: userId,
      applied_at: new Date().toISOString(),
    });

    this.audit.log({
      projectId,
      actorId: userId,
      action: ACTIVITY_ACTIONS.CHANGE_REQUEST_APPLIED,
      entityType: 'change_request',
      entityId: id,
      metadata: {
        title: data.title,
        reference: data.reference,
      },
    });

    await this.notify({
      projectId,
      request: data,
      actorId: userId,
      typeName: 'change_request_applied',
      message: 'is now on the roadmap.',
      audience: { requester: true },
    });

    return data;
  }

  /**
   * Attach a piece of roadmap work (or a deliverable) that this change affects.
   *
   * A sub-route rather than an array on PATCH: the whole-array replace would make
   * every optimistic cache patch a full-list diff, and `update` deliberately
   * touches only scalars.
   */
  async addLink(
    projectId: string,
    id: string,
    userId: string,
    link: LinkTargetDto,
  ) {
    await this.authorization.assertPermission(
      userId,
      projectId,
      'change_requests.create',
    );
    const existing = await this.loadOrThrow(projectId, id);
    this.assertEditable(existing, 'have its links changed');

    const [normalized] = normalizeLinkTargets([link], LINK_COLUMNS);

    // Appended, so an existing link's position is never rewritten by an add.
    const position = existing.links?.length ?? 0;
    const { error } = await this.db.from(LINKS_TABLE).insert({
      change_request_id: id,
      position,
      ...normalized,
    });
    if (error) {
      throw new InternalServerErrorException(
        `Failed to link the change request: ${error.message}`,
      );
    }

    this.audit.log({
      projectId,
      actorId: userId,
      action: ACTIVITY_ACTIONS.CHANGE_REQUEST_LINK_ADDED,
      entityType: 'change_request_link',
      entityId: id,
      metadata: { title: existing.title, reference: existing.reference },
    });

    return this.loadOrThrow(projectId, id);
  }

  async removeLink(
    projectId: string,
    id: string,
    linkId: string,
    userId: string,
  ) {
    await this.authorization.assertPermission(
      userId,
      projectId,
      'change_requests.create',
    );
    const existing = await this.loadOrThrow(projectId, id);
    this.assertEditable(existing, 'have its links changed');

    // Scoped by change_request_id as well as id, so a link id from another
    // request cannot be deleted through this route.
    const { error } = await this.db
      .from(LINKS_TABLE)
      .delete()
      .eq('id', linkId)
      .eq('change_request_id', id);
    if (error) {
      throw new InternalServerErrorException(
        `Failed to unlink: ${error.message}`,
      );
    }

    this.audit.log({
      projectId,
      actorId: userId,
      action: ACTIVITY_ACTIONS.CHANGE_REQUEST_LINK_REMOVED,
      entityType: 'change_request_link',
      entityId: id,
      metadata: { title: existing.title, reference: existing.reference },
    });

    return this.loadOrThrow(projectId, id);
  }

  async remove(projectId: string, id: string, userId: string) {
    await this.authorization.assertPermission(
      userId,
      projectId,
      'change_requests.decide',
    );
    const existing = await this.loadOrThrow(projectId, id);

    const { error } = await this.db
      .from(TABLE)
      .delete()
      .eq('id', id)
      .eq('project_id', projectId);

    if (error) {
      throw new InternalServerErrorException(
        `Failed to delete change request: ${error.message}`,
      );
    }

    this.audit.log({
      projectId,
      actorId: userId,
      action: ACTIVITY_ACTIONS.CHANGE_REQUEST_DELETED,
      entityType: 'change_request',
      entityId: id,
      metadata: {
        title: existing.title,
        reference: existing.reference,
      },
    });

    return { id, deleted: true };
  }

  // ── internals ─────────────────────────────────────────────────────────────

  /**
   * Per-project human reference (CR-012). Racy under true concurrency, which
   * the UNIQUE (project_id, reference) index turns into a retryable error
   * rather than a duplicate — acceptable at the write rate this surface sees.
   */
  private async nextReference(projectId: string): Promise<number> {
    const { data, error } = await this.db
      .from(TABLE)
      .select('reference')
      .eq('project_id', projectId)
      .order('reference', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new InternalServerErrorException(
        `Failed to allocate a change request number: ${error.message}`,
      );
    }
    return ((data?.reference as number | undefined) ?? 0) + 1;
  }

  private async setStatus(
    projectId: string,
    id: string,
    patch: Record<string, unknown>,
  ) {
    const { data, error } = await this.db
      .from(TABLE)
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('project_id', projectId)
      .select(SELECT)
      .single()
      .overrideTypes<ChangeRequestRow, { merge: false }>();

    if (error || !data) {
      throw new InternalServerErrorException(
        `Failed to update change request: ${error?.message ?? 'unknown error'}`,
      );
    }
    return data;
  }

  /**
   * Tell the people who need to act, or who were waiting on the outcome.
   *
   * Recipients are derived ENTIRELY from the permissions catalog and the
   * request's own `requested_by`. This is the execution layer: a project has
   * members with permissions, not a client and a consultant, so there is no
   * persona to look up. `deliverable-review.ts` states the same rule for the
   * sibling feature — review is capability-based and never tied to a declared
   * identity.
   *
   * The send loop mirrors `ContractsService.notifyCounterparty` — drop the actor
   * (nobody needs telling about their own click) and isolate every send in its
   * own try/catch, so a change request that was legitimately submitted does not
   * appear to fail because a push token was stale. Only the loop is borrowed:
   * a contract genuinely has counterparties, whereas a project has members.
   *
   * Deliberately fire-and-forget from the caller's perspective but awaited here,
   * so the recipient resolution error surfaces in logs rather than as an
   * unhandled rejection.
   */
  private async notify(params: {
    projectId: string;
    request: ChangeRequestRow;
    actorId: string;
    typeName: string;
    message: string;
    /**
     * Who to tell, stated in permissions. Composable rather than an enum because
     * an approval needs both: the requester was waiting on the answer, AND
     * somebody holding `change_requests.decide` still has to apply it to the
     * roadmap — approval deliberately does not write the roadmap itself.
     */
    audience: {
      /** Everyone holding `change_requests.decide` on this project. */
      deciders?: boolean;
      /** Whoever raised it, when that user still exists. */
      requester?: boolean;
    };
  }): Promise<void> {
    const { projectId, request, actorId, typeName, message, audience } = params;

    let recipients: Set<string>;
    try {
      recipients = new Set<string>();

      if (audience.deciders) {
        const deciders = await this.authorization.listUsersWithPermission(
          projectId,
          'change_requests.decide',
        );
        for (const userId of deciders) recipients.add(userId);
      }
      // Null when the profile was deleted (ON DELETE SET NULL) — there is simply
      // nobody to tell, which is not an error.
      if (audience.requester && request.requested_by) {
        recipients.add(request.requested_by);
      }

      recipients.delete(actorId);
    } catch (error) {
      this.logger.warn(
        `Could not resolve change-request notification recipients for ${request.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return;
    }

    const reference = `CR-${String(request.reference).padStart(3, '0')}`;
    for (const userId of recipients) {
      try {
        await this.notifications.createNotification({
          user_id: userId,
          project_id: projectId,
          actor_id: actorId,
          type_name: typeName,
          content: {
            message: `${reference} ${request.title} — ${message}`,
            change_request_id: request.id,
            reference: request.reference,
            context_title: request.title,
          },
          link_url: `/project/${projectId}/change-requests/${request.id}`,
        });
      } catch (error) {
        this.logger.warn(
          `Change-request notification to ${userId} failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }

  /**
   * Guard for the "only while still open" writes. `action` completes the
   * sentence, so the caller hears which write was refused rather than a generic
   * status complaint.
   */
  private assertEditable(existing: ChangeRequestRow, action: string): void {
    if (!OPEN_STATUSES.includes(existing.status)) {
      throw new BadRequestException(
        `A change request in ${existing.status} can no longer ${action}.`,
      );
    }
  }

  private async loadOrThrow(projectId: string, id: string) {
    const { data, error } = await this.db
      .from(TABLE)
      .select(SELECT)
      .eq('id', id)
      .eq('project_id', projectId)
      .maybeSingle()
      .overrideTypes<ChangeRequestRow, { merge: false }>();

    if (error) {
      throw new InternalServerErrorException(
        `Failed to load change request: ${error.message}`,
      );
    }
    if (!data) throw new NotFoundException('Change request not found');
    return data;
  }

  private pick<T extends object>(dto: T, keys: string[]) {
    const out: Record<string, unknown> = {};
    for (const key of keys) {
      const value = (dto as Record<string, unknown>)[key];
      if (value !== undefined) out[key] = value;
    }
    return out;
  }
}
