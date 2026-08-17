import { canDecide, resolveReviewOutcome } from './deliverable-review';
import type { DeliverableReviewerRow } from './delivery.types';

const reviewer = (
  reviewer_id: string,
  decision: DeliverableReviewerRow['decision'] = 'pending',
) => ({ reviewer_id, decision });

describe('resolveReviewOutcome', () => {
  it('stays in review while anyone is pending', () => {
    const outcome = resolveReviewOutcome([
      reviewer('a', 'approved'),
      reviewer('b'),
    ]);
    expect(outcome.status).toBe('in_review');
    expect(outcome.approvals).toBe(1);
    expect(outcome.total).toBe(2);
    expect(outcome.pending).toBe(1);
  });

  it('accepts only when every reviewer has approved', () => {
    expect(
      resolveReviewOutcome([
        reviewer('a', 'approved'),
        reviewer('b', 'approved'),
      ]).status,
    ).toBe('approved');
  });

  // One objection means the work is not done; the remaining reviewers should
  // not have to repeat that finding.
  it('bounces on a single changes_requested, whatever else was approved', () => {
    const outcome = resolveReviewOutcome([
      reviewer('a', 'approved'),
      reviewer('b', 'approved'),
      reviewer('c', 'changes_requested'),
    ]);
    expect(outcome.status).toBe('changes_requested');
    expect(outcome.approvals).toBe(2);
  });

  it('does not accept an empty reviewer list', () => {
    // Zero named reviewers is the "open approval" case, resolved by the caller
    // rather than here — this must not read as unanimous consent.
    expect(resolveReviewOutcome([]).status).toBe('in_review');
  });
});

describe('canDecide', () => {
  it('falls back to the blanket permission when nobody is named', () => {
    expect(canDecide('u1', [], true)).toBe(true);
    expect(canDecide('u1', [], false)).toBe(false);
  });

  // Being named IS the grant: a named reviewer does not additionally need
  // deliverables.approve, which is what makes review capability-based rather
  // than role-based.
  it('lets a named reviewer decide without the approve permission', () => {
    expect(canDecide('u1', [reviewer('u1')], false)).toBe(true);
  });

  it('refuses a non-reviewer without the approve permission', () => {
    expect(canDecide('u2', [reviewer('u1')], false)).toBe(false);
  });

  it('still lets an approver decide even when they are not named', () => {
    expect(canDecide('u2', [reviewer('u1')], true)).toBe(true);
  });
});
