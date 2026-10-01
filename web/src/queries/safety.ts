import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import {
	type BlockedPerson,
	type ReportInput,
	safetyService,
} from "@/services/safety.service";
import { useAuthStore } from "@/stores/authStore";
import { chatKeys } from "./chat";

export const safetyKeys = {
	blocks: (userId: string) => ["safety", "blocks", userId] as const,
};

/** Everyone the signed-in user has blocked, plus a Set for render-time checks. */
export function useBlockedPeople() {
	const userId = useAuthStore((state) => state.user?.id ?? null);
	const query = useQuery({
		queryKey: safetyKeys.blocks(userId ?? "anon"),
		queryFn: () => safetyService.listBlocks(),
		enabled: Boolean(userId),
		staleTime: 5 * 60 * 1000,
	});
	const blockedIds = useMemo(
		() => new Set((query.data ?? []).map((person) => person.user_id)),
		[query.data],
	);
	return { ...query, people: query.data ?? [], blockedIds };
}

export interface PersonRef {
	id: string;
	name: string;
	avatarUrl?: string | null;
}

/**
 * Block and unblock with an optimistic list: the person's messages collapse the
 * moment you confirm, and come back if the request fails.
 */
export function useBlockMutations() {
	const queryClient = useQueryClient();
	const userId = useAuthStore((state) => state.user?.id ?? null);
	const key = safetyKeys.blocks(userId ?? "anon");

	const settle = () => {
		void queryClient.invalidateQueries({ queryKey: key });
		// Blocking hides the DM from the list; unblocking brings it back.
		void queryClient.invalidateQueries({ queryKey: chatKeys.dmRooms() });
	};

	const block = useMutation({
		mutationFn: (person: PersonRef) => safetyService.block(person.id),
		onMutate: async (person) => {
			await queryClient.cancelQueries({ queryKey: key });
			const previous = queryClient.getQueryData<BlockedPerson[]>(key);
			queryClient.setQueryData<BlockedPerson[]>(key, (current = []) =>
				current.some((p) => p.user_id === person.id)
					? current
					: [
							{
								user_id: person.id,
								blocked_at: new Date().toISOString(),
								display_name: person.name,
								avatar_url: person.avatarUrl ?? null,
							},
							...current,
						],
			);
			return { previous };
		},
		onError: (_error, _person, context) => {
			queryClient.setQueryData(key, context?.previous);
		},
		onSettled: settle,
	});

	const unblock = useMutation({
		mutationFn: (person: PersonRef) => safetyService.unblock(person.id),
		onMutate: async (person) => {
			await queryClient.cancelQueries({ queryKey: key });
			const previous = queryClient.getQueryData<BlockedPerson[]>(key);
			queryClient.setQueryData<BlockedPerson[]>(key, (current = []) =>
				current.filter((p) => p.user_id !== person.id),
			);
			return { previous };
		},
		onError: (_error, _person, context) => {
			queryClient.setQueryData(key, context?.previous);
		},
		onSettled: settle,
	});

	return { block, unblock };
}

export function useReportContent() {
	const queryClient = useQueryClient();
	const userId = useAuthStore((state) => state.user?.id ?? null);
	return useMutation({
		mutationFn: (input: ReportInput) => safetyService.report(input),
		onSuccess: (result) => {
			if (result.blocked) {
				void queryClient.invalidateQueries({
					queryKey: safetyKeys.blocks(userId ?? "anon"),
				});
				void queryClient.invalidateQueries({ queryKey: chatKeys.dmRooms() });
			}
		},
	});
}
