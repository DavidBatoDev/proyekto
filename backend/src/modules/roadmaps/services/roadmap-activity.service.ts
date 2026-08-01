import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditService } from '../../audit/audit.service';
import {
  ACTIVITY_ACTIONS,
  type ActivityAction,
  type ActivityEntityType,
} from '../../audit/activity-actions';
import type { RoadmapWriteContext } from './roadmap-authorization.service';

/** Longest a text value may be before we store lengths instead of content. */
const REDACT_TEXT_OVER = 120;
/** Hard ceiling on a serialized metadata blob. */
const MAX_METADATA_BYTES = 4096;
/** Cap on the per-item detail carried by a reorder row. */
const MAX_REORDER_ITEMS = 10;

export interface FieldChange {
  field: string;
  from?: unknown;
  to?: unknown;
  /** Set instead of from/to when the value was too long to store. */
  from_len?: number;
  to_len?: number;
}

export interface ActivityEvent {
  action: ActivityAction;
  entityType: ActivityEntityType;
  entityId?: string | null;
  /** Entity title AS OF THIS MOMENT — see recordEvent for why. */
  title?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Turns roadmap write operations into project_activity_log rows.
 *
 * Two invariants matter more than anything else here:
 *
 * 1. TITLES ARE DENORMALIZED AT WRITE TIME. The entity may later be renamed or
 *    deleted, and a feed that reads "deleted task 7f3a-..." is useless. The
 *    title the user saw is stored on the row.
 *
 * 2. ONE ROW PER HTTP MUTATION. A PATCH that changes title + status + assignees
 *    is one user gesture and must read as one line. A bulk reorder of 50 items
 *    is one row with item_count: 50, never 50 rows. This is also what keeps the
 *    volume estimate (~6k rows/month/project) honest.
 *
 * Recording is gated on ROADMAP_ACTIVITY_LOG_ENABLED so the feature ships dark.
 */
@Injectable()
export class RoadmapActivityService {
  constructor(
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  isEnabled(): boolean {
    const flag = this.config.get<string>('ROADMAP_ACTIVITY_LOG_ENABLED');
    return flag === 'true' || flag === '1';
  }

  /**
   * Record one or more events against an already-resolved write scope.
   *
   * No-ops when the flag is off, when the scope is missing (defensive: unit
   * mocks return undefined), or when the roadmap has no project — a personal
   * roadmap has nothing to log against, since project_activity_log.project_id
   * is NOT NULL. Those commits keep roadmap_change_history as their record.
   */
  record(
    ctx: RoadmapWriteContext | null | undefined,
    actorId: string,
    events: ActivityEvent | ActivityEvent[],
  ): void {
    if (!this.isEnabled()) return;
    if (!ctx?.projectId) return;

    for (const event of Array.isArray(events) ? events : [events]) {
      this.audit.log({
        projectId: ctx.projectId,
        actorId,
        action: event.action,
        entityType: event.entityType,
        entityId: event.entityId ?? null,
        roadmapId: ctx.roadmapId ?? null,
        metadata: this.buildMetadata(event),
      });
    }
  }

  private buildMetadata(event: ActivityEvent): Record<string, unknown> {
    const metadata: Record<string, unknown> = {
      ...(event.metadata ?? {}),
    };
    if (event.title != null) metadata.title = event.title;
    return this.truncate(metadata);
  }

  /**
   * Bound the blob. One pathological write (a giant checklist, a 200-item
   * reorder) must not bloat a row that is read back on every page load.
   */
  private truncate(metadata: Record<string, unknown>): Record<string, unknown> {
    if (Buffer.byteLength(JSON.stringify(metadata)) <= MAX_METADATA_BYTES) {
      return metadata;
    }
    const trimmed: Record<string, unknown> = { ...metadata, truncated: true };
    for (const key of ['moved', 'changes', 'assignees'] as const) {
      const value = trimmed[key];
      if (Array.isArray(value) && value.length > 1) {
        trimmed[key] = value.slice(0, MAX_REORDER_ITEMS);
      }
      if (Buffer.byteLength(JSON.stringify(trimmed)) <= MAX_METADATA_BYTES) {
        return trimmed;
      }
    }
    // Still too big — drop the detail arrays entirely rather than store a
    // half-serialized blob.
    for (const key of ['moved', 'changes', 'assignees'] as const) {
      delete trimmed[key];
    }
    return trimmed;
  }

  // ── Diffing ───────────────────────────────────────────────────────────────

  /**
   * Field-level diff between two entity snapshots.
   *
   * Long free text (descriptions, rich-text bodies) is reduced to lengths.
   * An audit log is not the place to duplicate client-confidential prose, and
   * storing it would also double it into the RAG index.
   */
  diff(
    before: Record<string, any> | null | undefined,
    after: Record<string, any> | null | undefined,
    fields: string[],
  ): FieldChange[] {
    const changes: FieldChange[] = [];
    if (!before || !after) return changes;

    for (const field of fields) {
      const from = before[field];
      const to = after[field];
      if (this.sameValue(from, to)) continue;

      if (this.isLongText(from) || this.isLongText(to)) {
        changes.push({
          field,
          from_len: typeof from === 'string' ? from.length : 0,
          to_len: typeof to === 'string' ? to.length : 0,
        });
        continue;
      }
      changes.push({ field, from: from ?? null, to: to ?? null });
    }
    return changes;
  }

  private isLongText(value: unknown): boolean {
    return typeof value === 'string' && value.length > REDACT_TEXT_OVER;
  }

  private sameValue(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (a == null && b == null) return true;
    if (a instanceof Date || b instanceof Date) {
      return String(a) === String(b);
    }
    if (typeof a === 'object' || typeof b === 'object') {
      return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
    }
    return false;
  }

  // ── Action selection ──────────────────────────────────────────────────────

  /**
   * Pick the single most specific action for a task update.
   *
   * Precedence: assignment > status > move > generic update. A PATCH touching
   * several fields still yields ONE row; the full diff rides along in metadata
   * so nothing is lost.
   */
  taskUpdateAction(params: {
    assigneesChanged: boolean;
    assigneesAdded: number;
    statusChanged: boolean;
    featureChanged: boolean;
  }): ActivityAction {
    if (params.assigneesChanged) {
      return params.assigneesAdded > 0
        ? ACTIVITY_ACTIONS.TASK_ASSIGNED
        : ACTIVITY_ACTIONS.TASK_UNASSIGNED;
    }
    if (params.statusChanged) return ACTIVITY_ACTIONS.TASK_STATUS_CHANGED;
    if (params.featureChanged) return ACTIVITY_ACTIONS.TASK_MOVED;
    return ACTIVITY_ACTIONS.TASK_UPDATED;
  }

  /** Same idea for epics/features, which have status but no assignment. */
  nodeUpdateAction(
    entity: 'epic' | 'feature',
    params: { statusChanged: boolean; parentChanged?: boolean },
  ): ActivityAction {
    if (entity === 'epic') {
      return params.statusChanged
        ? ACTIVITY_ACTIONS.EPIC_STATUS_CHANGED
        : ACTIVITY_ACTIONS.EPIC_UPDATED;
    }
    if (params.statusChanged) return ACTIVITY_ACTIONS.FEATURE_STATUS_CHANGED;
    if (params.parentChanged) return ACTIVITY_ACTIONS.FEATURE_MOVED;
    return ACTIVITY_ACTIONS.FEATURE_UPDATED;
  }

  // ── Metadata builders ─────────────────────────────────────────────────────

  /** One row for a whole reorder, with a capped sample of what moved. */
  reorderMetadata(params: {
    scopeType: 'roadmap' | 'epic' | 'feature';
    scopeId: string;
    itemCount: number;
    moved?: Array<{ id: string; title?: string | null; position: number }>;
  }): Record<string, unknown> {
    return {
      scope: { type: params.scopeType, id: params.scopeId },
      item_count: params.itemCount,
      ...(params.moved?.length
        ? { moved: params.moved.slice(0, MAX_REORDER_ITEMS) }
        : {}),
    };
  }

  /** Comment rows carry a short plain-text excerpt, never the raw HTML body. */
  commentMetadata(
    commentId: string | null | undefined,
    html: string | null | undefined,
  ): Record<string, unknown> {
    return {
      comment_id: commentId ?? null,
      excerpt: this.excerpt(html),
    };
  }

  private excerpt(html: string | null | undefined): string {
    if (!html) return '';
    const text = html
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\s+/g, ' ')
      .trim();
    return text.length > 140 ? `${text.slice(0, 137)}...` : text;
  }

  /** Normalizes the two assignee shapes the task payloads use. */
  assigneeSummary(
    ids: string[],
    lookup?: Map<string, string | null>,
  ): Array<{ id: string; display_name: string | null }> {
    return ids.map((id) => ({ id, display_name: lookup?.get(id) ?? null }));
  }
}
