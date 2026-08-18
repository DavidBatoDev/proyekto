import type { ReactNode } from "react";
import { useState } from "react";
import {
	CONSULTANT_CARD_SKELETON_CLASS,
	ConsultantCard,
} from "@/components/marketplace/ConsultantCard";
import { useConsultantDirectoryQuery } from "@/hooks/useConsultants";
import type { ConsultantDirectoryParams } from "@/queries/consultants";

const PAGE_SIZE = 24;

const SKELETON_KEYS = [
	"consultant-grid-skeleton-1",
	"consultant-grid-skeleton-2",
	"consultant-grid-skeleton-3",
	"consultant-grid-skeleton-4",
];

interface ConsultantDirectoryGridProps {
	params: Omit<ConsultantDirectoryParams, "limit" | "offset">;
	emptyState: ReactNode;
}

/**
 * The consultant list shared by the category and sub-category pages.
 *
 * Paginates by growing `limit` rather than stepping `offset`, so "Load more"
 * appends without the previous page disappearing on refetch. At current
 * catalogue sizes one request per press is cheaper than stitching pages
 * together client-side.
 */
export function ConsultantDirectoryGrid({
	params,
	emptyState,
}: ConsultantDirectoryGridProps) {
	const [limit, setLimit] = useState(PAGE_SIZE);
	const query = useConsultantDirectoryQuery({ ...params, limit, offset: 0 });

	if (query.isPending) {
		return (
			<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
				{SKELETON_KEYS.map((key) => (
					<div key={key} className={CONSULTANT_CARD_SKELETON_CLASS} />
				))}
			</div>
		);
	}

	if (query.isError) {
		return (
			<div className="rounded-xl border border-destructive/30 bg-destructive/10 p-6 text-[13px] text-destructive">
				Could not load consultants for this category. Try again shortly.
			</div>
		);
	}

	const items = query.data?.items ?? [];
	const total = query.data?.total ?? 0;

	if (items.length === 0) return <>{emptyState}</>;

	return (
		<div>
			<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
				{items.map((consultant) => (
					<ConsultantCard key={consultant.id} consultant={consultant} />
				))}
			</div>

			{items.length < total && (
				<div className="mt-6 text-center">
					<button
						type="button"
						onClick={() => setLimit((current) => current + PAGE_SIZE)}
						disabled={query.isFetching}
						className="rounded-xl border border-border px-4 py-2 text-[13px] font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-60"
					>
						{query.isFetching ? "Loading…" : "Load more"}
					</button>
				</div>
			)}
		</div>
	);
}
