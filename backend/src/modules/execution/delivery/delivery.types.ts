/**
 * Row shapes for the delivery tables.
 *
 * The injected Supabase client is untyped, so PostgREST's select-string types
 * cannot resolve an embedded relationship (`links:deliverable_links(...)`) and
 * widen the row to `GenericStringError`. Query sites therefore end with
 * `.overrideTypes<XRow, { merge: false }>()`, which states the shape once per
 * query instead of casting at every property access.
 */

/** Minimal parent shape embedded upward from a linked row. */
interface NamedNode {
  id: string;
  title: string;
  status: string;
}

export interface DeliverableLinkRow {
  id: string;
  feature_id: string | null;
  task_id: string | null;
  milestone_id: string | null;
  position: number;
  // Embedded upward so the card can render the Epic → Feature → Task trail the
  // deliverable came from without a second round trip. Exactly one of these is
  // non-null, matching the table's num_nonnulls CHECK.
  task?:
    | (NamedNode & { feature?: (NamedNode & { epic?: NamedNode }) | null })
    | null;
  feature?: (NamedNode & { epic?: NamedNode | null }) | null;
  milestone?: (NamedNode & { target_date: string | null }) | null;
}

export interface DeliverableCriterionRow {
  id: string;
  deliverable_id: string;
  label: string;
  is_met: boolean;
  met_by: string | null;
  met_at: string | null;
  position: number;
}

export interface DeliverableReviewerRow {
  id: string;
  deliverable_id: string;
  reviewer_id: string;
  decision: 'pending' | 'approved' | 'changes_requested';
  note: string | null;
  decided_at: string | null;
  reviewer?: {
    id: string;
    display_name: string | null;
    avatar_url: string | null;
  } | null;
}

/**
 * Completion traced back to real roadmap tasks.
 *
 * Computed server-side rather than on the web because a link may point at a
 * different roadmap than `deliverable.roadmap_id` — that column is nullable so
 * a deliverable outlives a roadmap swap, and a project can hold several
 * roadmaps (the UNIQUE on `roadmaps.project_id` was dropped in 20260210000001).
 */
export interface DeliverableProgress {
  tasks_total: number;
  tasks_done: number;
  /** 0-100, or null when nothing is linked yet. */
  percent: number | null;
  criteria_total: number;
  criteria_met: number;
}

export interface DeliverableRow {
  id: string;
  project_id: string;
  roadmap_id: string | null;
  title: string;
  description: string | null;
  acceptance_criteria: string | null;
  status:
    | 'not_started'
    | 'in_progress'
    | 'in_review'
    | 'approved'
    | 'changes_requested';
  owner_id: string | null;
  due_date: string | null;
  position: number;
  submitted_by: string | null;
  submitted_at: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  links?: DeliverableLinkRow[];
  attachments?: Array<Record<string, unknown>>;
  criteria?: DeliverableCriterionRow[];
  reviewers?: DeliverableReviewerRow[];
  /** Attached by the service after expanding links; never selected from SQL. */
  progress?: DeliverableProgress;
}

export interface ChangeRequestRow {
  id: string;
  project_id: string;
  roadmap_id: string | null;
  reference: number;
  title: string;
  description: string | null;
  requested_by: string | null;
  impact_scope: string | null;
  impact_timeline_days: number | null;
  target_date_before: string | null;
  target_date_after: string | null;
  status:
    | 'draft'
    | 'submitted'
    | 'approved'
    | 'rejected'
    | 'changes_requested'
    | 'withdrawn'
    | 'applied';
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  applied_change_id: string | null;
  applied_by: string | null;
  applied_at: string | null;
  created_at: string;
  updated_at: string;
  links?: ChangeRequestLinkRow[];
  /**
   * The commit that carried this change onto the roadmap, embedded so the detail
   * page can say what landed without a second round trip. Null until someone
   * runs Apply to roadmap.
   */
  applied_change?: AppliedChangeRow | null;
}

/**
 * What a change request affects. Exactly one target column is non-null, matching
 * the table's `num_nonnulls(...) = 1` CHECK.
 *
 * Note the difference from `DeliverableLinkRow`: this junction has `epic_id` and
 * `deliverable_id` but NO `milestone_id`. The two shapes are deliberately not
 * interchangeable.
 */
export interface ChangeRequestLinkRow {
  id: string;
  epic_id: string | null;
  feature_id: string | null;
  task_id: string | null;
  deliverable_id: string | null;
  position: number;
  // Embedded upward so the Epic → Feature → Task trail renders from one read.
  epic?: NamedNode | null;
  feature?: (NamedNode & { epic?: NamedNode | null }) | null;
  task?:
    | (NamedNode & { feature?: (NamedNode & { epic?: NamedNode }) | null })
    | null;
  deliverable?: NamedNode | null;
}

export interface AppliedChangeRow {
  change_id: string;
  committed_at: string | null;
  operations_count: number | null;
  semantic_change_count: number | null;
}

export interface RiskRow {
  id: string;
  project_id: string;
  kind: 'risk' | 'issue';
  title: string;
  description: string | null;
  severity: 'low' | 'medium' | 'high' | 'critical';
  likelihood: 'low' | 'medium' | 'high' | null;
  status:
    | 'open'
    | 'mitigating'
    | 'monitoring'
    | 'resolved'
    | 'accepted'
    | 'closed';
  impact: string | null;
  mitigation: string | null;
  owner_id: string | null;
  due_date: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  visibility: 'internal' | 'shared';
  source_kind: 'manual' | 'blocked_task' | 'at_risk_milestone';
  created_by: string | null;
  created_at: string;
  updated_at: string;
  links?: Array<Record<string, unknown>>;
}

export interface DecisionCategoryRow {
  id: string;
  project_id: string;
  name: string;
  /** A theme-token key, never a hex value — see the migration's header note. */
  color: string;
  /** A key into CATEGORY_ICON in web, never an icon component name. */
  icon: string;
  position: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * What a decision bears on. Exactly one target column is non-null.
 *
 * This junction carries the SUPERSET of targets — the other three each omit one
 * or two, and those gaps read as accidents rather than decisions. A decision can
 * plausibly bear on any of the five.
 */
export interface DecisionLinkRow {
  id: string;
  epic_id: string | null;
  feature_id: string | null;
  task_id: string | null;
  milestone_id: string | null;
  deliverable_id: string | null;
  position: number;
  // Embedded upward so the Epic → Feature → Task trail renders from one read.
  epic?: NamedNode | null;
  feature?: (NamedNode & { epic?: NamedNode | null }) | null;
  task?:
    | (NamedNode & { feature?: (NamedNode & { epic?: NamedNode }) | null })
    | null;
  milestone?: (NamedNode & { target_date: string | null }) | null;
  deliverable?: NamedNode | null;
}

export interface DecisionOptionRow {
  id: string;
  decision_id: string;
  title: string;
  detail: string | null;
  /**
   * At most one per decision, enforced by the partial unique index
   * `uq_decision_options_selected`. Selecting a new one must clear its sibling
   * in the same write or the insert is rejected.
   */
  is_selected: boolean;
  position: number;
}

export interface DecisionRow {
  id: string;
  project_id: string;
  /** Per-project human reference, rendered DEC-024. */
  reference: number | null;
  title: string;
  context: string | null;
  decision: string;
  rationale: string | null;
  /** Superseded by `options`; kept so existing prose is not lost. */
  alternatives_considered: string | null;
  category_id: string | null;
  decided_by: string | null;
  decided_on: string;
  status: 'proposed' | 'final' | 'superseded';
  supersedes_decision_id: string | null;
  version: number;
  source_chat_message_id: string | null;
  visibility: 'internal' | 'shared';
  created_by: string | null;
  created_at: string;
  updated_at: string;
  category?: DecisionCategoryRow | null;
  links?: DecisionLinkRow[];
  options?: DecisionOptionRow[];
}
