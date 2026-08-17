import type { DeliverableReviewerRow } from './delivery.types';

/**
 * Resolving named sign-offs into a deliverable status.
 *
 * Reviewers are ANY project member — this is the execution layer, so review is
 * capability-based and never tied to a declared client/lead identity.
 *
 * Rules:
 *   - any reviewer asking for changes bounces the whole deliverable
 *   - it is accepted only once EVERY named reviewer has approved
 *   - otherwise it stays in review
 *
 * Split out from the service so the rules are testable without a database.
 */

export type ReviewDecision = 'pending' | 'approved' | 'changes_requested';
export type DeliverableReviewStatus =
  | 'in_review'
  | 'approved'
  | 'changes_requested';

export interface ReviewOutcome {
  status: DeliverableReviewStatus;
  approvals: number;
  total: number;
  /** Still owed a decision. Drives "waiting on N" in the UI. */
  pending: number;
}

export function resolveReviewOutcome(
  reviewers: Pick<DeliverableReviewerRow, 'decision'>[],
): ReviewOutcome {
  const total = reviewers.length;
  const approvals = reviewers.filter((r) => r.decision === 'approved').length;
  const pending = reviewers.filter((r) => r.decision === 'pending').length;
  const bounced = reviewers.some((r) => r.decision === 'changes_requested');

  // One objection outweighs any number of approvals: it means the work is not
  // done, and the remaining reviewers should not have to repeat that finding.
  if (bounced) {
    return { status: 'changes_requested', approvals, total, pending };
  }
  if (total > 0 && approvals === total) {
    return { status: 'approved', approvals, total, pending };
  }
  return { status: 'in_review', approvals, total, pending };
}

/**
 * Whether `userId` may cast a decision on this deliverable.
 *
 * Being named IS the grant — a reviewer does not additionally need the blanket
 * `deliverables.approve`. That is safe because naming someone requires
 * `deliverables.edit`, so a member cannot add themselves as a reviewer to
 * escalate. When nobody is named, the deliverable falls back to the original
 * behaviour so the feature stays usable before reviewer lists are adopted.
 */
export function canDecide(
  userId: string,
  reviewers: Pick<DeliverableReviewerRow, 'reviewer_id'>[],
  hasApprovePermission: boolean,
): boolean {
  if (reviewers.length === 0) return hasApprovePermission;
  return (
    hasApprovePermission ||
    reviewers.some((reviewer) => reviewer.reviewer_id === userId)
  );
}
