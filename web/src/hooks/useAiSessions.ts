import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type AiSessionScope, aiScopeKey } from "@/components/ai/scope";
import {
	type AiMessage,
	type AiSession,
	type AppendAiMessagePayload,
	type AppendAiMessageResult,
	aiSessionsService,
	type CreateAiSessionPayload,
	type UpdateAiSessionPayload,
} from "@/services/ai-sessions.service";

// =============================================================================
// TanStack Query hooks over the scope-aware sessions client. Keys are keyed by
// the scope key (`roadmap:{id}` / `workspace:{id}`), never by a raw id, so a
// roadmap thread and a workspace thread can never share a cache entry.
// =============================================================================

export const aiSessionKeys = {
	all: (scopeKey: string) => ["ai-sessions", scopeKey] as const,
	list: (scopeKey: string, archived: boolean) =>
		["ai-sessions", scopeKey, "list", { archived }] as const,
	detail: (scopeKey: string, sessionId: string) =>
		["ai-sessions", scopeKey, "detail", sessionId] as const,
	messages: (scopeKey: string, sessionId: string) =>
		["ai-sessions", scopeKey, "messages", sessionId] as const,
};

type MaybeScope = AiSessionScope | null | undefined;

function requireScope(scope: MaybeScope): AiSessionScope {
	if (!scope) {
		throw new Error("AI session scope is not resolved yet");
	}
	return scope;
}

function scopeKeyOf(scope: MaybeScope): string {
	return scope ? aiScopeKey(scope) : "";
}

export function useAiSessionsList(
	scope: MaybeScope,
	options: { archived?: boolean } = {},
) {
	const archived = options.archived ?? false;
	return useQuery({
		queryKey: aiSessionKeys.list(scopeKeyOf(scope), archived),
		queryFn: () => aiSessionsService.list(requireScope(scope), { archived }),
		enabled: Boolean(scope),
		staleTime: 30 * 1000,
	});
}

export function useAiMessages(
	scope: MaybeScope,
	sessionId: string | null | undefined,
) {
	return useQuery({
		queryKey: aiSessionKeys.messages(scopeKeyOf(scope), sessionId ?? ""),
		queryFn: () =>
			aiSessionsService.listMessages(requireScope(scope), sessionId ?? "", {
				limit: 100,
			}),
		enabled: Boolean(scope && sessionId),
		staleTime: 5 * 1000,
	});
}

export function useCreateAiSession(scope: MaybeScope) {
	const queryClient = useQueryClient();
	const scopeKey = scopeKeyOf(scope);
	return useMutation({
		mutationFn: (payload: CreateAiSessionPayload = {}) =>
			aiSessionsService.create(requireScope(scope), payload),
		onSuccess: (created) => {
			// Seed the new session into the active-list cache synchronously so the
			// panel's auto-select reconciliation finds it immediately. Without this,
			// setActiveThread(newId) runs before the invalidate-triggered refetch
			// lands; the reconcile effect doesn't see newId in the stale list and
			// bounces back to threads[0] -- the "New thread flashes then reverts to
			// the old thread" bug. The refetch below still reconciles server fields.
			queryClient.setQueryData<AiSession[]>(
				aiSessionKeys.list(scopeKey, false),
				(prev) =>
					prev
						? [created, ...prev.filter((s) => s.id !== created.id)]
						: [created],
			);
			queryClient.invalidateQueries({
				queryKey: aiSessionKeys.all(scopeKey),
			});
		},
	});
}

export function useUpdateAiSession(scope: MaybeScope) {
	const queryClient = useQueryClient();
	const scopeKey = scopeKeyOf(scope);
	return useMutation({
		mutationFn: ({
			sessionId,
			payload,
		}: {
			sessionId: string;
			payload: UpdateAiSessionPayload;
		}) => aiSessionsService.update(requireScope(scope), sessionId, payload),
		// Optimistic update for pin/archive/rename — feels instant in the picker.
		onMutate: async ({ sessionId, payload }) => {
			await queryClient.cancelQueries({
				queryKey: aiSessionKeys.all(scopeKey),
			});
			const previous = new Map<unknown, AiSession[] | undefined>();
			for (const archived of [false, true]) {
				const key = aiSessionKeys.list(scopeKey, archived);
				const existing = queryClient.getQueryData<AiSession[]>(key);
				previous.set(key, existing);
				if (!existing) continue;
				queryClient.setQueryData<AiSession[]>(
					key,
					existing.map((s) => (s.id === sessionId ? { ...s, ...payload } : s)),
				);
			}
			return { previous };
		},
		onError: (_err, _vars, context) => {
			if (!context) return;
			for (const [key, data] of context.previous.entries()) {
				queryClient.setQueryData(
					key as ReturnType<typeof aiSessionKeys.list>,
					data,
				);
			}
		},
		onSettled: () => {
			queryClient.invalidateQueries({
				queryKey: aiSessionKeys.all(scopeKey),
			});
		},
	});
}

export function useDeleteAiSession(scope: MaybeScope) {
	const queryClient = useQueryClient();
	const scopeKey = scopeKeyOf(scope);
	return useMutation({
		mutationFn: (sessionId: string) =>
			aiSessionsService.delete(requireScope(scope), sessionId),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: aiSessionKeys.all(scopeKey),
			});
		},
	});
}

export function useAppendAiMessage(scope: MaybeScope) {
	const queryClient = useQueryClient();
	const scopeKey = scopeKeyOf(scope);
	return useMutation({
		mutationFn: ({
			sessionId,
			payload,
		}: {
			sessionId: string;
			payload: AppendAiMessagePayload;
		}): Promise<AppendAiMessageResult> =>
			aiSessionsService.appendMessage(requireScope(scope), sessionId, payload),
		onSuccess: (_result, { sessionId }) => {
			queryClient.invalidateQueries({
				queryKey: aiSessionKeys.messages(scopeKey, sessionId),
			});
			// Session list shows last_message_at and message_count, both of which
			// change on insert; cheap to invalidate.
			queryClient.invalidateQueries({
				queryKey: aiSessionKeys.all(scopeKey),
			});
		},
	});
}

export type { AiMessage, AiSession };
