import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { FileText, Loader, Plus } from "lucide-react";
import { useState } from "react";
import { isBriefDraftEmpty } from "@/lib/briefDraft";
import { readBriefDraft } from "@/lib/briefDraftStorage";
import { describeDuration } from "@/lib/durations";
import {
	type PostingListEntry,
	postingsService,
} from "@/services/postings.service";

/**
 * The briefs this person has written, in every state.
 *
 * Without this there is no way back into a brief: the board only lists
 * published ones, and a draft is reachable solely by its URL. It also surfaces
 * the brief that has not been saved yet — the one living in this tab's storage
 * — because a draft nobody can see is a draft nobody finishes.
 */
export function BriefsGrid() {
	// Read once per mount. sessionStorage is per-tab, so this row appears only in
	// the tab that owns the draft — which is the only tab where the link works.
	const [unsaved] = useState(() => {
		const stored = readBriefDraft();
		return stored && !isBriefDraftEmpty(stored.draft) ? stored : null;
	});

	const briefsQuery = useQuery({
		queryKey: ["postings", "mine"] as const,
		queryFn: () => postingsService.listMine(),
		staleTime: 30 * 1000,
	});

	const briefs = briefsQuery.data ?? [];
	const isEmpty = briefs.length === 0 && !unsaved;

	return (
		<div data-briefs-section="my-briefs-section" className="app-slide-up">
			<div className="mb-6">
				<div className="mb-1 flex items-center justify-between gap-3">
					<div className="flex items-center gap-2">
						<div className="h-3 w-3 rounded-full bg-primary sm:h-[18px] sm:w-[18px]" />
						<h2 className="text-base font-semibold tracking-tight text-foreground sm:text-[20px]">
							YOUR BRIEFS
						</h2>
					</div>
					<Link
						to="/brief/new"
						search={{ need: undefined }}
						className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-2.5 py-1.5 text-[13px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 sm:px-3 sm:text-sm"
					>
						<Plus className="h-3.5 w-3.5" />
						New brief
					</Link>
				</div>
				<p className="mt-1 text-xs text-muted-foreground">
					Work you have described for vetted consultants to respond to.
				</p>
			</div>

			{briefsQuery.isPending ? (
				<div className="flex items-center justify-center py-14">
					<Loader className="h-7 w-7 animate-spin text-primary" />
				</div>
			) : isEmpty ? (
				<div className="rounded-2xl border border-dashed border-border bg-card py-12 text-center shadow-sm">
					<p className="mb-2 font-semibold text-card-foreground">
						No briefs yet
					</p>
					<p className="text-sm text-muted-foreground">
						Describe what you need and consultants come to you with scope and
						pricing.
					</p>
				</div>
			) : (
				<div className="divide-y divide-border rounded-2xl border border-border bg-card">
					{unsaved && (
						<Link
							to="/brief/new"
							search={{ need: undefined }}
							className="flex items-center gap-3 px-4 py-3.5 transition-colors first:rounded-t-2xl last:rounded-b-2xl hover:bg-muted/50"
						>
							<FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
							<span className="min-w-0 flex-1">
								<span className="block truncate text-sm font-medium text-card-foreground">
									{unsaved.draft.title.trim() || "Untitled brief"}
								</span>
								<span className="mt-0.5 block text-[12px] text-muted-foreground">
									Not saved — still only on this device
								</span>
							</span>
							<StatusPill label="Unsaved" />
						</Link>
					)}
					{briefs.map((brief) => (
						<BriefRow key={brief.id} brief={brief} />
					))}
				</div>
			)}
		</div>
	);
}

function BriefRow({ brief }: { brief: PostingListEntry }) {
	const duration = describeDuration(brief.duration, brief.duration_custom);
	const budget =
		brief.budget_min !== null || brief.budget_max !== null
			? [brief.budget_min, brief.budget_max]
					.filter((value): value is number => value !== null)
					.map((value) => value.toLocaleString())
					.join("–") + ` ${brief.currency}`
			: null;

	const meta = [
		budget,
		duration,
		brief.status === "published"
			? `${brief.proposal_count} ${brief.proposal_count === 1 ? "proposal" : "proposals"}`
			: null,
	].filter(Boolean);

	return (
		<Link
			// A draft opens where it can be finished; anything else opens as it
			// reads, which is where the author reviews who has applied.
			to={brief.status === "draft" ? "/brief/$briefId/edit" : "/brief/$briefId"}
			params={{ briefId: brief.id }}
			className={`flex items-center gap-3 px-4 py-3.5 transition-colors first:rounded-t-2xl last:rounded-b-2xl hover:bg-muted/50 ${
				brief.status === "closed" ? "opacity-60" : ""
			}`}
		>
			<FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
			<span className="min-w-0 flex-1">
				<span className="block truncate text-sm font-medium text-card-foreground">
					{brief.title}
				</span>
				{meta.length > 0 && (
					<span className="mt-0.5 block truncate text-[12px] text-muted-foreground">
						{meta.join(" · ")}
					</span>
				)}
			</span>
			<StatusPill
				label={
					brief.status === "published"
						? "Live"
						: brief.status === "closed"
							? "Closed"
							: "Draft"
				}
				tone={brief.status === "published" ? "primary" : "muted"}
			/>
		</Link>
	);
}

function StatusPill({
	label,
	tone = "muted",
}: {
	label: string;
	tone?: "primary" | "muted";
}) {
	return (
		<span
			className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
				tone === "primary"
					? "bg-primary/10 text-primary"
					: "bg-muted text-muted-foreground"
			}`}
		>
			{label}
		</span>
	);
}
