import type {
  EntitlementsService,
  FeatureKey,
} from '../../shared/entitlements/entitlements.service';

/**
 * Deliverables that name reviewers use the review feature on top of the
 * register itself, so submit, review and reviewer edits need both.
 */
export const DELIVERABLE_REVIEW_FEATURES = [
  'deliverables',
  'deliverable_review',
] as const satisfies readonly FeatureKey[];

/**
 * The plan gate every delivery write runs.
 *
 * Call it on the line AFTER the method's permission check, never before: a
 * non-member must keep getting missing_permission and learn nothing about the
 * project's plan. Reads (list, get, candidates) are never gated, so a
 * downgraded workspace can still see everything it recorded.
 *
 * The project's workspace decides; an unhomed project gets Free, and a lookup
 * failure fails open inside EntitlementsService.
 */
export async function assertDeliveryFeature(
  entitlements: EntitlementsService,
  projectId: string,
  keys: FeatureKey | readonly FeatureKey[],
): Promise<void> {
  const scope = await entitlements.resolveScopeForProject(projectId);
  await entitlements.assertFeature(scope, keys, { context: 'write' });
}
