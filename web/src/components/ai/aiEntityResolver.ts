import { type QueryClient, useQuery } from "@tanstack/react-query";
import { getGuestSessionId } from "@/lib/guestAuth";
import {
	type AiEntityRef,
	type AiResolvedEntity,
	aiContextService,
} from "@/services/ai-context.service";
import { useAuthStore, useUser } from "@/stores/authStore";
import { entityKey } from "./aiEntityLinks";
import type { AiMentionKind } from "./aiMentions";

export const AI_CONTEXT_MAX_REFS = 25;
const BATCH_WINDOW_MS = 30;

type ResolveEntities = (refs: AiEntityRef[]) => Promise<AiResolvedEntity[]>;
type PendingEntity = {
	ref: AiEntityRef;
	waiters: ((entity: AiResolvedEntity) => void)[];
};

const failedEntity = (ref: AiEntityRef): AiResolvedEntity => ({
	...ref,
	accessible: false,
	error_code: "RESOLVE_FAILED",
});

export function createEntityBatcher(resolve: ResolveEntities) {
	let pending = new Map<string, PendingEntity>();
	let timer: ReturnType<typeof setTimeout> | undefined;

	async function send(entries: PendingEntity[]) {
		let byKey = new Map<string, AiResolvedEntity>();
		try {
			const results = await resolve(entries.map(({ ref }) => ref));
			byKey = new Map(
				results.map((entity) => [entityKey(entity.kind, entity.id), entity]),
			);
		} catch {
			// Network and authorization failures degrade to the supplied title.
		}
		for (const { ref, waiters } of entries) {
			const entity =
				byKey.get(entityKey(ref.kind, ref.id)) ?? failedEntity(ref);
			for (const settle of waiters) settle(entity);
		}
	}

	function flush() {
		const entries = [...pending.values()];
		pending = new Map();
		timer = undefined;
		for (let start = 0; start < entries.length; start += AI_CONTEXT_MAX_REFS) {
			void send(entries.slice(start, start + AI_CONTEXT_MAX_REFS));
		}
	}

	return {
		load(kind: AiMentionKind, id: string): Promise<AiResolvedEntity> {
			return new Promise((settle) => {
				const key = entityKey(kind, id);
				const existing = pending.get(key);
				if (existing) existing.waiters.push(settle);
				else pending.set(key, { ref: { kind, id }, waiters: [settle] });
				if (timer === undefined) timer = setTimeout(flush, BATCH_WINDOW_MS);
			});
		},
	};
}

export const aiEntityKeys = {
	all: ["ai", "entity"] as const,
	one: (kind: AiMentionKind, id: string) =>
		[...aiEntityKeys.all, kind, id] as const,
};

// Keep bearer-style guest credentials out of query keys. A new guest session
// gets a new opaque key, even if no cached guest profile id is available yet.
let guestSession: string | null = null;
let guestGeneration = 0;

function actorKey(userId: string | undefined): string {
	if (userId) return `user:${userId}`;
	const session = getGuestSessionId();
	if (session !== guestSession) {
		guestSession = session;
		guestGeneration += 1;
	}
	return session ? `guest:${guestGeneration}` : "anonymous";
}

function currentActorKey() {
	return actorKey(useAuthStore.getState().user?.id);
}

let activeBatcher:
	| { actor: string; batcher: ReturnType<typeof createEntityBatcher> }
	| undefined;

function loadForActor(actor: string, kind: AiMentionKind, id: string) {
	if (currentActorKey() !== actor) {
		return Promise.resolve(failedEntity({ kind, id }));
	}
	if (activeBatcher?.actor !== actor) {
		activeBatcher = {
			actor,
			batcher: createEntityBatcher(async (refs) => {
				if (currentActorKey() !== actor) return refs.map(failedEntity);
				let changedActor = false;
				const unsubscribe = useAuthStore.subscribe((next, previous) => {
					if (next.user?.id !== previous.user?.id) changedActor = true;
				});
				try {
					const entities = await aiContextService.resolveRefs(refs);
					return changedActor || currentActorKey() !== actor
						? refs.map(failedEntity)
						: entities;
				} finally {
					unsubscribe();
				}
			}),
		};
	}
	return activeBatcher.batcher.load(kind, id);
}

export function useAiEntity(kind: AiMentionKind, id: string) {
	const actor = actorKey(useUser()?.id);
	return useQuery({
		queryKey: [...aiEntityKeys.one(kind, id), actor],
		queryFn: () => loadForActor(actor, kind, id),
		staleTime: 5 * 60_000,
		gcTime: 30 * 60_000,
		retry: false,
	});
}

export function invalidateAiEntities(queryClient: QueryClient) {
	return queryClient.invalidateQueries({ queryKey: aiEntityKeys.all });
}
