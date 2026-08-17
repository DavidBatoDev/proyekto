import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
// Aliased: `withSubmitted` and `withLinkRemoved` exist for both entities with
// the same names, and the two must not be confusable at a call site.
import {
	optimisticChangeRequest,
	removeChangeRequest,
	replaceChangeRequest,
	upsertChangeRequest,
	withApplied as withCrApplied,
	withDecision as withCrDecision,
	withLinkRemoved as withCrLinkRemoved,
	withSubmitted as withCrSubmitted,
	withWithdrawn as withCrWithdrawn,
} from "@/components/project/delivery/changeRequestCache";
import {
	isOptimisticId as isOptimisticDecisionId,
	optimisticDecision,
	removeDecision,
	replaceDecision,
	upsertDecision,
	withCategory,
	withLinkRemoved as withDecisionLinkRemoved,
	withFinalized,
	withOptionAdded,
	withOptionEdited,
	withOptionRemoved,
	withOptionSelected,
} from "@/components/project/delivery/decisionCache";
import {
	optimisticDeliverable,
	replaceDeliverable,
	upsertDeliverable,
	withCriterionAdded,
	withCriterionRemoved,
	withCriterionToggled,
	withEvidenceAdded,
	withEvidenceRemoved,
	withLinkRemoved,
	removeDeliverable as withoutDeliverable,
	withReviewDecision,
	withReviewerAdded,
	withReviewerRemoved,
	withSubmitted,
} from "@/components/project/delivery/deliverableCache";
import { todayIsoDate } from "@/components/project/delivery/deliverableForm";
import { createOptimisticEntity } from "@/hooks/useOptimisticEntity";
import { useToast } from "@/hooks/useToast";
import {
	type ChangeRequest,
	type ChangeRequestStatus,
	type ChangeRequestView,
	type CreateDecisionBody,
	changeRequestsService,
	type Decision,
	type DecisionCategory,
	type DecisionLinkTarget,
	type DecisionStatus,
	type Deliverable,
	type DeliverableStatus,
	decisionCategoriesService,
	decisionsService,
	deliverablesService,
	type RiskKind,
	type RiskStatus,
	risksService,
} from "@/services/delivery.service";
import type { ProfileSummary } from "@/services/teams.service";
import { useUser } from "@/stores/authStore";

/**
 * Server state for the four delivery-governance surfaces.
 *
 * Deliverable, change-request and decision mutations are OPTIMISTIC: they patch
 * the cache, then reconcile from the response rather than refetching. Every one
 * of those endpoints returns the full updated row (see `delivery.service.ts`),
 * so the response is authoritative and a refetch is only needed where list
 * membership changes. The rules the patches apply live in the matching
 * `*Cache.ts` and mirror the backend — see the note at the top of each.
 *
 * Risks still invalidate: their writes are page-level forms rather than in-place
 * toggles, so the round trip is not what they feel like.
 */

export const deliveryKeys = {
	deliverables: (projectId: string, status?: string) =>
		["delivery", "deliverables", projectId, status ?? "all"] as const,
	/** Prefix matching every cached list variant for a project. */
	deliverablesAll: (projectId: string) =>
		["delivery", "deliverables", projectId] as const,
	deliverable: (projectId: string, id: string) =>
		["delivery", "deliverable", projectId, id] as const,
	changeRequests: (projectId: string, status?: string, view?: string) =>
		[
			"delivery",
			"change-requests",
			projectId,
			status ?? "all",
			view ?? "all",
		] as const,
	/** Prefix matching every cached list variant for a project. */
	changeRequestsAll: (projectId: string) =>
		["delivery", "change-requests", projectId] as const,
	changeRequest: (projectId: string, id: string) =>
		["delivery", "change-request", projectId, id] as const,
	risks: (projectId: string, kind?: string, status?: string) =>
		["delivery", "risks", projectId, kind ?? "all", status ?? "all"] as const,
	riskCandidates: (projectId: string) =>
		["delivery", "risks", projectId, "candidates"] as const,
	decisions: (projectId: string, status?: string, categoryId?: string) =>
		[
			"delivery",
			"decisions",
			projectId,
			status ?? "all",
			categoryId ?? "all",
		] as const,
	/** Prefix matching every cached list variant for a project. */
	decisionsAll: (projectId: string) =>
		["delivery", "decisions", projectId] as const,
	decision: (projectId: string, id: string) =>
		["delivery", "decision", projectId, id] as const,
	decisionCategories: (projectId: string) =>
		["delivery", "decision-categories", projectId] as const,
};

const STALE = 30 * 1000;

// ─── Deliverables ───────────────────────────────────────────────────────────

export function useDeliverablesQuery(
	projectId: string,
	status?: DeliverableStatus,
	/**
	 * Pass false when the caller lacks `access.delivery`. The route bodies are
	 * already gated, but Overview reads this list for its health strip and would
	 * otherwise 403 on every load for a member without the gate.
	 */
	enabled = true,
) {
	return useQuery({
		queryKey: deliveryKeys.deliverables(projectId, status),
		queryFn: () => deliverablesService.list(projectId, status),
		enabled: Boolean(projectId) && enabled,
		staleTime: STALE,
	});
}

export function useDeliverableMutations(projectId: string) {
	const queryClient = useQueryClient();
	const toast = useToast();
	const user = useUser();
	const userId = user?.id ?? null;

	const listsKey = deliveryKeys.deliverablesAll(projectId);

	// The cancel/snapshot/patch/reconcile/rollback machinery lives in
	// `useOptimisticEntity` — change requests need the identical behaviour over a
	// different row type, and two copies would be two places to fix the next
	// cache bug in.
	const cache = createOptimisticEntity<Deliverable>({
		queryClient,
		listsKey,
		detailKey: (id) => deliveryKeys.deliverable(projectId, id),
		replaceInList: replaceDeliverable,
		notifyError: (message) => toast.error(message),
	});
	const { optimistic, writeServerRow, snapshot, rollback } = cache;

	// Submit and review write project_activity_log rows that the detail page's
	// Activity tab reads. Its key is ["activity","feed",projectId,filters], so
	// the prefix has to include "feed" — ["activity", projectId] matches nothing.
	const activityKey = ["activity", "feed", projectId] as const;

	return {
		create: useMutation({
			mutationFn: (body: Parameters<typeof deliverablesService.create>[1]) =>
				deliverablesService.create(projectId, body),
			onMutate: async (body) => {
				await queryClient.cancelQueries({ queryKey: listsKey });
				const lists = queryClient.getQueriesData<Deliverable[]>({
					queryKey: listsKey,
				});
				const draft = optimisticDeliverable(projectId, body);
				queryClient.setQueriesData<Deliverable[]>(
					{ queryKey: listsKey },
					(list) => (list ? upsertDeliverable(list, draft) : list),
				);
				return { lists, draftId: draft.id };
			},
			onError: (error, _body, context) => {
				for (const [key, value] of context?.lists ?? []) {
					queryClient.setQueryData(key, value);
				}
				toast.error(
					error instanceof Error
						? error.message
						: "Couldn't create that deliverable.",
				);
			},
			onSuccess: (created, _body, context) => {
				// Swap the temp row in place rather than appending a duplicate.
				writeServerRow(created, context?.draftId);
			},
		}),
		update: useMutation(
			optimistic<{
				id: string;
				body: Parameters<typeof deliverablesService.update>[2];
			}>({
				mutationFn: (args) =>
					deliverablesService.update(projectId, args.id, args.body),
				id: (args) => args.id,
				patch: (d, args) => ({ ...d, ...args.body }),
			}),
		),
		submit: useMutation(
			optimistic<string>({
				mutationFn: (id) => deliverablesService.submit(projectId, id),
				id: (id) => id,
				patch: (d) => withSubmitted(d, userId),
				alsoInvalidate: [activityKey],
			}),
		),
		review: useMutation(
			optimistic<{
				id: string;
				body: Parameters<typeof deliverablesService.review>[2];
			}>({
				mutationFn: (args) =>
					deliverablesService.review(projectId, args.id, args.body),
				id: (args) => args.id,
				patch: (d, args) =>
					withReviewDecision(
						d,
						userId,
						args.body.decision,
						args.body.review_note,
					),
				alsoInvalidate: [activityKey],
			}),
		),
		remove: useMutation({
			mutationFn: (id: string) => deliverablesService.remove(projectId, id),
			onMutate: async (id: string) => {
				const context = await snapshot(id);
				queryClient.setQueriesData<Deliverable[]>(
					{ queryKey: listsKey },
					(list) => (list ? withoutDeliverable(list, id) : list),
				);
				return context;
			},
			onError: (error, _id, context) => rollback(context, error),
			onSuccess: (_result, id) => {
				queryClient.removeQueries({
					queryKey: deliveryKeys.deliverable(projectId, id),
				});
			},
		}),
		addLink: useMutation(
			optimistic<{
				id: string;
				target: Parameters<typeof deliverablesService.addLink>[2];
			}>({
				mutationFn: (args) =>
					deliverablesService.addLink(projectId, args.id, args.target),
				id: (args) => args.id,
				// No optimistic patch: the trail needs the epic/feature titles and
				// `progress` needs a task expansion only the server can do. The row
				// arrives with the response a moment later.
				patch: (d) => d,
			}),
		),
		removeLink: useMutation(
			optimistic<{ id: string; linkId: string }>({
				mutationFn: (args) =>
					deliverablesService.removeLink(projectId, args.id, args.linkId),
				id: (args) => args.id,
				patch: (d, args) => withLinkRemoved(d, args.linkId),
			}),
		),
		addCriterion: useMutation(
			optimistic<{ id: string; label: string }>({
				mutationFn: (args) =>
					deliverablesService.addCriterion(projectId, args.id, args.label),
				id: (args) => args.id,
				patch: (d, args) => withCriterionAdded(d, args.label),
			}),
		),
		updateCriterion: useMutation(
			optimistic<{
				id: string;
				criterionId: string;
				body: { label?: string; is_met?: boolean };
			}>({
				mutationFn: (args) =>
					deliverablesService.updateCriterion(
						projectId,
						args.id,
						args.criterionId,
						args.body,
					),
				id: (args) => args.id,
				patch: (d, args) =>
					args.body.is_met === undefined
						? {
								...d,
								criteria: (d.criteria ?? []).map((c) =>
									c.id === args.criterionId
										? { ...c, label: args.body.label ?? c.label }
										: c,
								),
							}
						: withCriterionToggled(
								d,
								args.criterionId,
								args.body.is_met,
								userId,
							),
			}),
		),
		removeCriterion: useMutation(
			optimistic<{ id: string; criterionId: string }>({
				mutationFn: (args) =>
					deliverablesService.removeCriterion(
						projectId,
						args.id,
						args.criterionId,
					),
				id: (args) => args.id,
				patch: (d, args) => withCriterionRemoved(d, args.criterionId),
			}),
		),
		addReviewer: useMutation(
			optimistic<{
				id: string;
				reviewerId: string;
				/** Passed by the picker so the avatar renders before the response. */
				profile?: ProfileSummary | null;
			}>({
				mutationFn: (args) =>
					deliverablesService.addReviewer(projectId, args.id, args.reviewerId),
				id: (args) => args.id,
				patch: (d, args) =>
					withReviewerAdded(d, args.reviewerId, args.profile ?? null),
			}),
		),
		removeReviewer: useMutation(
			optimistic<{ id: string; reviewerId: string }>({
				mutationFn: (args) =>
					deliverablesService.removeReviewer(
						projectId,
						args.id,
						args.reviewerId,
					),
				id: (args) => args.id,
				patch: (d, args) => withReviewerRemoved(d, args.reviewerId),
			}),
		),
		addEvidence: useMutation(
			optimistic<{
				id: string;
				body: Parameters<typeof deliverablesService.addEvidence>[2];
			}>({
				mutationFn: (args) =>
					deliverablesService.addEvidence(projectId, args.id, args.body),
				id: (args) => args.id,
				patch: (d, args) => withEvidenceAdded(d, args.body),
			}),
		),
		removeEvidence: useMutation(
			optimistic<{ id: string; attachmentId: string }>({
				mutationFn: (args) =>
					deliverablesService.removeEvidence(
						projectId,
						args.id,
						args.attachmentId,
					),
				id: (args) => args.id,
				patch: (d, args) => withEvidenceRemoved(d, args.attachmentId),
			}),
		),
	};
}

/** One deliverable, for the detail route. */
export function useDeliverableQuery(projectId: string, deliverableId: string) {
	return useQuery({
		queryKey: deliveryKeys.deliverable(projectId, deliverableId),
		queryFn: () => deliverablesService.get(projectId, deliverableId),
		enabled: Boolean(projectId && deliverableId),
		staleTime: STALE,
	});
}

// ─── Change requests ────────────────────────────────────────────────────────

export function useChangeRequestsQuery(
	projectId: string,
	params: { status?: ChangeRequestStatus; view?: ChangeRequestView } = {},
) {
	return useQuery({
		queryKey: deliveryKeys.changeRequests(
			projectId,
			params.status,
			params.view,
		),
		queryFn: () => changeRequestsService.list(projectId, params),
		enabled: Boolean(projectId),
		staleTime: STALE,
	});
}

export function useChangeRequestQuery(projectId: string, id: string) {
	return useQuery({
		queryKey: deliveryKeys.changeRequest(projectId, id),
		queryFn: () => changeRequestsService.get(projectId, id),
		enabled: Boolean(projectId && id),
		staleTime: STALE,
	});
}

export function useChangeRequestMutations(projectId: string) {
	const queryClient = useQueryClient();
	const toast = useToast();
	const user = useUser();
	const userId = user?.id ?? null;

	const listsKey = deliveryKeys.changeRequestsAll(projectId);

	const cache = createOptimisticEntity<ChangeRequest>({
		queryClient,
		listsKey,
		detailKey: (id) => deliveryKeys.changeRequest(projectId, id),
		replaceInList: replaceChangeRequest,
		notifyError: (message) => toast.error(message),
		fallbackErrorMessage: "That change didn't save.",
	});

	// Submit, decide and apply all write project_activity_log rows the detail
	// page's Activity tab reads. Its key is ["activity","feed",projectId,filters],
	// so the prefix must include "feed" — ["activity", projectId] matches nothing.
	const activityKey = ["activity", "feed", projectId] as const;

	return {
		create: useMutation({
			mutationFn: (body: Parameters<typeof changeRequestsService.create>[1]) =>
				changeRequestsService.create(projectId, body),
			onMutate: async (body) => {
				await queryClient.cancelQueries({ queryKey: listsKey });
				const lists = queryClient.getQueriesData<ChangeRequest[]>({
					queryKey: listsKey,
				});
				const draft = optimisticChangeRequest(projectId, body, userId);
				queryClient.setQueriesData<ChangeRequest[]>(
					{ queryKey: listsKey },
					(list) => (list ? upsertChangeRequest(list, draft) : list),
				);
				return { lists, draftId: draft.id };
			},
			onError: (error, _body, context) => {
				for (const [key, value] of context?.lists ?? []) {
					queryClient.setQueryData(key, value);
				}
				toast.error(
					error instanceof Error
						? error.message
						: "Couldn't raise that change request.",
				);
			},
			onSuccess: (created, body, context) => {
				// Swap the temp row in place rather than appending a duplicate — the
				// server row carries the real CR number the draft could not know.
				cache.writeServerRow(created, context?.draftId);
				if (body.submit) {
					void queryClient.invalidateQueries({ queryKey: activityKey });
				}
			},
		}),
		submit: useMutation(
			cache.optimistic<string>({
				mutationFn: (id) => changeRequestsService.submit(projectId, id),
				id: (id) => id,
				patch: (request) => withCrSubmitted(request),
				alsoInvalidate: [activityKey],
			}),
		),
		withdraw: useMutation(
			cache.optimistic<string>({
				mutationFn: (id) => changeRequestsService.withdraw(projectId, id),
				id: (id) => id,
				patch: (request) => withCrWithdrawn(request),
				alsoInvalidate: [activityKey],
			}),
		),
		decide: useMutation(
			cache.optimistic<{
				id: string;
				body: Parameters<typeof changeRequestsService.decide>[2];
			}>({
				mutationFn: (args) =>
					changeRequestsService.decide(projectId, args.id, args.body),
				id: (args) => args.id,
				patch: (request, args) =>
					withCrDecision(
						request,
						args.body.decision,
						args.body.decision_note,
						userId,
					),
				alsoInvalidate: [activityKey],
			}),
		),
		update: useMutation(
			cache.optimistic<{
				id: string;
				body: Parameters<typeof changeRequestsService.update>[2];
			}>({
				mutationFn: (args) =>
					changeRequestsService.update(projectId, args.id, args.body),
				id: (args) => args.id,
				patch: (request, args) => ({ ...request, ...args.body }),
			}),
		),
		addLink: useMutation(
			cache.optimistic<{
				id: string;
				target: Parameters<typeof changeRequestsService.addLink>[2];
			}>({
				// No optimistic patch: a new link's row needs the embedded Epic →
				// Feature → Task titles to render, and only the server can resolve
				// those from the id the picker supplied. The response fills it in.
				mutationFn: (args) =>
					changeRequestsService.addLink(projectId, args.id, args.target),
				id: (args) => args.id,
				patch: (request) => request,
				alsoInvalidate: [activityKey],
			}),
		),
		removeLink: useMutation(
			cache.optimistic<{ id: string; linkId: string }>({
				mutationFn: (args) =>
					changeRequestsService.removeLink(projectId, args.id, args.linkId),
				id: (args) => args.id,
				patch: (request, args) => withCrLinkRemoved(request, args.linkId),
				alsoInvalidate: [activityKey],
			}),
		),
		markApplied: useMutation(
			cache.optimistic<{ id: string; appliedChangeId: string }>({
				mutationFn: (args) =>
					changeRequestsService.markApplied(
						projectId,
						args.id,
						args.appliedChangeId,
					),
				id: (args) => args.id,
				patch: (request, args) =>
					withCrApplied(request, args.appliedChangeId, userId),
				alsoInvalidate: [activityKey],
			}),
		),
		remove: useMutation({
			mutationFn: (id: string) => changeRequestsService.remove(projectId, id),
			onMutate: async (id) => {
				await queryClient.cancelQueries({ queryKey: listsKey });
				const lists = queryClient.getQueriesData<ChangeRequest[]>({
					queryKey: listsKey,
				});
				queryClient.setQueriesData<ChangeRequest[]>(
					{ queryKey: listsKey },
					(list) => (list ? removeChangeRequest(list, id) : list),
				);
				return { lists };
			},
			onError: (error, _id, context) => {
				for (const [key, value] of context?.lists ?? []) {
					queryClient.setQueryData(key, value);
				}
				toast.error(
					error instanceof Error
						? error.message
						: "Couldn't delete that change request.",
				);
			},
			onSuccess: () => {
				void queryClient.invalidateQueries({ queryKey: activityKey });
			},
		}),
	};
}

// ─── Risks & issues ─────────────────────────────────────────────────────────

export function useRisksQuery(
	projectId: string,
	params: { kind?: RiskKind; status?: RiskStatus } = {},
	/** See `useDeliverablesQuery` — Overview reads this without the route gate. */
	enabled = true,
) {
	return useQuery({
		queryKey: deliveryKeys.risks(projectId, params.kind, params.status),
		queryFn: () => risksService.list(projectId, params),
		enabled: Boolean(projectId) && enabled,
		staleTime: STALE,
	});
}

/** Blocked work and at-risk milestones nobody has entered in the register yet. */
export function useRiskCandidatesQuery(projectId: string, enabled = true) {
	return useQuery({
		queryKey: deliveryKeys.riskCandidates(projectId),
		queryFn: () => risksService.candidates(projectId),
		enabled: Boolean(projectId) && enabled,
		staleTime: STALE,
	});
}

export function useRiskMutations(projectId: string) {
	const queryClient = useQueryClient();
	const invalidate = () =>
		queryClient.invalidateQueries({
			queryKey: ["delivery", "risks", projectId],
		});

	return {
		create: useMutation({
			mutationFn: (body: Parameters<typeof risksService.create>[1]) =>
				risksService.create(projectId, body),
			onSuccess: invalidate,
		}),
		update: useMutation({
			mutationFn: (args: {
				id: string;
				body: Parameters<typeof risksService.update>[2];
			}) => risksService.update(projectId, args.id, args.body),
			onSuccess: invalidate,
		}),
		remove: useMutation({
			mutationFn: (id: string) => risksService.remove(projectId, id),
			onSuccess: invalidate,
		}),
	};
}

// ─── Decisions ──────────────────────────────────────────────────────────────

export function useDecisionsQuery(
	projectId: string,
	filters?: { status?: DecisionStatus; categoryId?: string },
) {
	return useQuery({
		queryKey: deliveryKeys.decisions(
			projectId,
			filters?.status,
			filters?.categoryId,
		),
		queryFn: () =>
			decisionsService.list(projectId, {
				status: filters?.status,
				category_id: filters?.categoryId,
			}),
		enabled: Boolean(projectId),
		staleTime: STALE,
	});
}

export function useDecisionQuery(projectId: string, id: string) {
	return useQuery({
		queryKey: deliveryKeys.decision(projectId, id),
		queryFn: () => decisionsService.get(projectId, id),
		enabled: Boolean(projectId && id) && !isOptimisticDecisionId(id),
		staleTime: STALE,
	});
}

export function useDecisionCategoriesQuery(projectId: string) {
	return useQuery({
		queryKey: deliveryKeys.decisionCategories(projectId),
		queryFn: () => decisionCategoriesService.list(projectId),
		enabled: Boolean(projectId),
		// Categories change far less often than the decisions filed under them.
		staleTime: 5 * 60 * 1000,
	});
}

/**
 * Decision writes are OPTIMISTIC, on the same machinery as deliverables and
 * change requests: every endpoint returns the full hydrated row, so the cache is
 * patched and then reconciled from the response rather than refetched.
 *
 * The rules those patches apply live in `decisionCache.ts` and mirror the
 * backend — see the note at the top of that file.
 */
export function useDecisionMutations(projectId: string) {
	const queryClient = useQueryClient();
	const toast = useToast();
	const user = useUser();
	const userId = user?.id ?? undefined;

	const listsKey = deliveryKeys.decisionsAll(projectId);
	const cache = createOptimisticEntity<Decision>({
		queryClient,
		listsKey,
		detailKey: (id) => deliveryKeys.decision(projectId, id),
		replaceInList: replaceDecision,
		notifyError: (message) => toast.error(message),
	});
	const { optimistic, writeServerRow, snapshot, rollback } = cache;

	// Finalizing and superseding write project_activity_log rows that the detail
	// page's Activity tab reads. Its key is ["activity","feed",projectId,filters],
	// so the prefix has to include "feed" — ["activity", projectId] matches
	// nothing.
	const activityKey = ["activity", "feed", projectId] as const;
	const today = todayIsoDate();

	return {
		create: useMutation({
			mutationFn: (body: CreateDecisionBody) =>
				decisionsService.create(projectId, body),
			onMutate: async (body) => {
				await queryClient.cancelQueries({ queryKey: listsKey });
				const lists = queryClient.getQueriesData<Decision[]>({
					queryKey: listsKey,
				});
				// The category is looked up from cache so the chip renders with the
				// right colour immediately rather than appearing a round trip later.
				const category =
					queryClient
						.getQueryData<DecisionCategory[]>(
							deliveryKeys.decisionCategories(projectId),
						)
						?.find((c) => c.id === body.category_id) ?? null;
				const draft = optimisticDecision(projectId, body, {
					userId,
					today,
					category,
				});
				queryClient.setQueriesData<Decision[]>(
					{ queryKey: listsKey },
					(list) => (list ? upsertDecision(list, draft) : list),
				);
				return { lists, draftId: draft.id };
			},
			onError: (error, _body, context) => {
				for (const [key, value] of context?.lists ?? []) {
					queryClient.setQueryData(key, value);
				}
				toast.error(
					error instanceof Error
						? error.message
						: "Couldn't record that decision.",
				);
			},
			onSuccess: (created, _body, context) => {
				// Swap the temp row in place rather than appending a duplicate.
				writeServerRow(created, context?.draftId);
				// Superseding retires another row, and only a refetch shows that.
				if (created.supersedes_decision_id) {
					void queryClient.invalidateQueries({ queryKey: listsKey });
				}
				void queryClient.invalidateQueries({ queryKey: activityKey });
			},
		}),
		update: useMutation(
			optimistic<{
				id: string;
				body: Parameters<typeof decisionsService.update>[2];
				/** Passed so the chip can repaint before the response lands. */
				category?: DecisionCategory | null;
			}>({
				mutationFn: (args) =>
					decisionsService.update(projectId, args.id, args.body),
				id: (args) => args.id,
				patch: (decision, args) => {
					const next = { ...decision, ...args.body };
					return args.category !== undefined
						? withCategory(next, args.category)
						: next;
				},
			}),
		),
		finalize: useMutation(
			optimistic<string>({
				mutationFn: (id) => decisionsService.finalize(projectId, id),
				id: (id) => id,
				patch: (decision) => withFinalized(decision, userId, today),
				alsoInvalidate: [activityKey],
			}),
		),
		addLink: useMutation(
			optimistic<{ id: string; target: DecisionLinkTarget }>({
				mutationFn: (args) =>
					decisionsService.addLink(projectId, args.id, args.target),
				id: (args) => args.id,
				// Not patched: the Epic -> Feature -> Task trail needs titles embedded
				// upward, which only the server read supplies. A row with no label
				// would be worse than a short wait.
				patch: (decision) => decision,
			}),
		),
		removeLink: useMutation(
			optimistic<{ id: string; linkId: string }>({
				mutationFn: (args) =>
					decisionsService.removeLink(projectId, args.id, args.linkId),
				id: (args) => args.id,
				patch: (decision, args) =>
					withDecisionLinkRemoved(decision, args.linkId),
			}),
		),
		addOption: useMutation(
			optimistic<{
				id: string;
				body: { title: string; detail?: string; is_selected?: boolean };
			}>({
				mutationFn: (args) =>
					decisionsService.addOption(projectId, args.id, args.body),
				id: (args) => args.id,
				patch: (decision, args) => withOptionAdded(decision, args.body),
			}),
		),
		updateOption: useMutation(
			optimistic<{
				id: string;
				optionId: string;
				body: Partial<{ title: string; detail: string; is_selected: boolean }>;
			}>({
				mutationFn: (args) =>
					decisionsService.updateOption(
						projectId,
						args.id,
						args.optionId,
						args.body,
					),
				id: (args) => args.id,
				patch: (decision, args) =>
					args.body.is_selected === true
						? withOptionSelected(decision, args.optionId)
						: withOptionEdited(decision, args.optionId, args.body),
			}),
		),
		removeOption: useMutation(
			optimistic<{ id: string; optionId: string }>({
				mutationFn: (args) =>
					decisionsService.removeOption(projectId, args.id, args.optionId),
				id: (args) => args.id,
				patch: (decision, args) => withOptionRemoved(decision, args.optionId),
			}),
		),
		remove: useMutation({
			mutationFn: (id: string) => decisionsService.remove(projectId, id),
			onMutate: async (id: string) => {
				const context = await snapshot(id);
				queryClient.setQueriesData<Decision[]>(
					{ queryKey: listsKey },
					(list) => (list ? removeDecision(list, id) : list),
				);
				return context;
			},
			onError: (error, _id, context) => rollback(context, error),
			onSuccess: () => {
				void queryClient.invalidateQueries({ queryKey: activityKey });
			},
		}),
	};
}

/**
 * Category writes stay non-optimistic.
 *
 * They happen in a management dialog rather than in-place, so the round trip is
 * not what they feel like — and creating one has to surface the 409 the
 * case-insensitive unique index raises, which a patched cache would hide.
 */
export function useDecisionCategoryMutations(projectId: string) {
	const queryClient = useQueryClient();
	const toast = useToast();

	const invalidate = () => {
		void queryClient.invalidateQueries({
			queryKey: deliveryKeys.decisionCategories(projectId),
		});
		// A rename or a delete changes the chip on every decision filed under it.
		void queryClient.invalidateQueries({
			queryKey: deliveryKeys.decisionsAll(projectId),
		});
	};
	const onError = (error: unknown, fallback: string) =>
		toast.error(error instanceof Error ? error.message : fallback);

	return {
		create: useMutation({
			mutationFn: (
				body: Parameters<typeof decisionCategoriesService.create>[1],
			) => decisionCategoriesService.create(projectId, body),
			onSuccess: invalidate,
			onError: (error) => onError(error, "Couldn't create that category."),
		}),
		update: useMutation({
			mutationFn: (args: {
				id: string;
				body: Parameters<typeof decisionCategoriesService.update>[2];
			}) => decisionCategoriesService.update(projectId, args.id, args.body),
			onSuccess: invalidate,
			onError: (error) => onError(error, "Couldn't update that category."),
		}),
		remove: useMutation({
			mutationFn: (id: string) =>
				decisionCategoriesService.remove(projectId, id),
			onSuccess: invalidate,
			onError: (error) => onError(error, "Couldn't delete that category."),
		}),
	};
}
