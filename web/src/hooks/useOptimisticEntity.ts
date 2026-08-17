import type { QueryClient } from "@tanstack/react-query";

/**
 * The optimistic-write machinery shared by the delivery surfaces.
 *
 * Every one of these mutations has the same shape — cancel in-flight reads,
 * snapshot what we're about to overwrite, patch the caches, reconcile from the
 * server's row, restore on failure — and differs only in the one line that
 * actually transforms the entity. Open-coding that around each of ~20 mutations
 * buries the interesting line in ceremony.
 *
 * Extracted from `useDeliverableMutations`, where it was closed over
 * `Deliverable`. Change requests need the identical behaviour over a different
 * row type, and a second copy would be two places to fix the next cache bug in.
 *
 * Two cache shapes are kept in step deliberately: the LIST key carries a filter
 * (status, view), so several lists for one project can be cached at once and all
 * of them have to move together — otherwise switching a filter shows the
 * pre-mutation row. The DETAIL key is what the detail route reads.
 */

/** Snapshot of every cache entry one optimistic patch touched. */
export interface OptimisticSnapshot<T> {
	lists: Array<[readonly unknown[], T[] | undefined]>;
	detail: T | undefined;
	detailKey: readonly unknown[];
}

export interface OptimisticEntityConfig<T extends { id: string }> {
	queryClient: QueryClient;
	/** Prefix matching every cached list variant for the project. */
	listsKey: readonly unknown[];
	detailKey: (id: string) => readonly unknown[];
	/**
	 * Swap a server row into a list in place. Takes `previousId` so a temp
	 * optimistic row can be replaced by the real one rather than appended
	 * alongside it as a duplicate.
	 */
	replaceInList: (list: T[], previousId: string, updated: T) => T[];
	/** Shown when a write fails; axios only toasts 403s on its own. */
	notifyError: (message: string) => void;
	fallbackErrorMessage?: string;
}

export interface OptimisticEntity<T extends { id: string }> {
	snapshot: (id: string) => Promise<OptimisticSnapshot<T>>;
	rollback: (
		context: OptimisticSnapshot<T> | undefined,
		error: unknown,
	) => void;
	patchCaches: (id: string, patch: (entity: T) => T) => void;
	writeServerRow: (updated: T, previousId?: string) => void;
	/** Build the `useMutation` config for a patch-then-reconcile write. */
	optimistic: <TVars>(config: {
		mutationFn: (vars: TVars) => Promise<T>;
		id: (vars: TVars) => string;
		patch: (entity: T, vars: TVars) => T;
		/** Extra keys to refresh once the write lands (activity rows, mostly). */
		alsoInvalidate?: readonly (readonly unknown[])[];
	}) => {
		mutationFn: (vars: TVars) => Promise<T>;
		onMutate: (vars: TVars) => Promise<OptimisticSnapshot<T>>;
		onError: (
			error: unknown,
			vars: TVars,
			context?: OptimisticSnapshot<T>,
		) => void;
		onSuccess: (updated: T) => void;
	};
}

export function createOptimisticEntity<T extends { id: string }>(
	config: OptimisticEntityConfig<T>,
): OptimisticEntity<T> {
	const {
		queryClient,
		listsKey,
		detailKey,
		replaceInList,
		notifyError,
		fallbackErrorMessage = "That change didn't save.",
	} = config;

	const snapshot = async (id: string): Promise<OptimisticSnapshot<T>> => {
		const key = detailKey(id);
		await Promise.all([
			queryClient.cancelQueries({ queryKey: listsKey }),
			queryClient.cancelQueries({ queryKey: key }),
		]);
		return {
			lists: queryClient.getQueriesData<T[]>({ queryKey: listsKey }),
			detail: queryClient.getQueryData<T>(key),
			detailKey: key,
		};
	};

	const rollback = (
		context: OptimisticSnapshot<T> | undefined,
		error: unknown,
	) => {
		if (!context) return;
		for (const [key, value] of context.lists) {
			queryClient.setQueryData(key, value);
		}
		queryClient.setQueryData(context.detailKey, context.detail);
		notifyError(error instanceof Error ? error.message : fallbackErrorMessage);
	};

	const patchCaches = (id: string, patch: (entity: T) => T) => {
		queryClient.setQueriesData<T[]>({ queryKey: listsKey }, (list) =>
			list?.map((entity) => (entity.id === id ? patch(entity) : entity)),
		);
		queryClient.setQueryData<T>(detailKey(id), (current) =>
			current ? patch(current) : current,
		);
	};

	const writeServerRow = (updated: T, previousId = updated.id) => {
		queryClient.setQueriesData<T[]>({ queryKey: listsKey }, (list) =>
			list ? replaceInList(list, previousId, updated) : list,
		);
		queryClient.setQueryData(detailKey(updated.id), updated);
	};

	return {
		snapshot,
		rollback,
		patchCaches,
		writeServerRow,
		optimistic: (mutationConfig) => ({
			mutationFn: mutationConfig.mutationFn,
			onMutate: async (vars) => {
				const context = await snapshot(mutationConfig.id(vars));
				patchCaches(mutationConfig.id(vars), (entity) =>
					mutationConfig.patch(entity, vars),
				);
				return context;
			},
			onError: (error, _vars, context) => rollback(context, error),
			onSuccess: (updated) => {
				writeServerRow(updated);
				for (const key of mutationConfig.alsoInvalidate ?? []) {
					void queryClient.invalidateQueries({ queryKey: key });
				}
			},
		}),
	};
}
