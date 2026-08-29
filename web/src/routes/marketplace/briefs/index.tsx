import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Clock, DollarSign, Loader2 } from "lucide-react";
import { useMarketplaceCategoryNavigationQuery } from "@/hooks/useMarketplaceTaxonomy";
import { isActiveConsultant } from "@/lib/auth-utils";
import { ENGAGEMENT_TYPES } from "@/lib/briefSections";
import { DURATION_OPTIONS, describeDuration } from "@/lib/durations";
import {
	type PostingBoardEntry,
	type PostingEngagementType,
	postingsService,
} from "@/services/postings.service";
import { useProfile } from "@/stores/authStore";

/**
 * The brief board — the consultant's half of the marketplace.
 *
 * Consultant-only, and deliberately so: identity-and-enrollment puts the
 * postings board behind the same gate as the talent pool, because a client's
 * unfinished plans should not be public reading. The API enforces it; this only
 * decides what to render.
 */
interface BriefBoardSearch {
	category?: string;
	duration?: string;
	engagement?: PostingEngagementType;
}

export const Route = createFileRoute("/marketplace/briefs/")({
	// Annotated rather than inferred: the router widens the engagement literal
	// back to `string` once `navigate({ search })` writes to it, and the board
	// query needs the union.
	validateSearch: (search: Record<string, unknown>): BriefBoardSearch => ({
		category: typeof search.category === "string" ? search.category : undefined,
		duration: typeof search.duration === "string" ? search.duration : undefined,
		engagement:
			search.engagement === "ongoing" || search.engagement === "one_time"
				? search.engagement
				: undefined,
	}),
	component: BriefBoardPage,
});

function BriefBoardPage() {
	const search = Route.useSearch();
	const navigate = Route.useNavigate();
	const profile = useProfile();
	const categoriesQuery = useMarketplaceCategoryNavigationQuery();

	const canBrowse = isActiveConsultant(profile);

	const boardQuery = useQuery({
		queryKey: ["postings", "board", search] as const,
		queryFn: () =>
			postingsService.board({
				category_id: search.category,
				duration: search.duration,
				engagement_type: search.engagement,
			}),
		enabled: canBrowse,
	});

	if (!canBrowse) {
		return (
			<div className="mx-auto max-w-3xl px-5 pb-20 pt-app-header text-center">
				<h1 className="mt-20 text-2xl font-bold tracking-tight text-foreground">
					Briefs are for vetted consultants
				</h1>
				<p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
					Clients post work here for consultants to lead. Get verified and you
					can read every brief and send proposals.
				</p>
				<Link
					to="/marketplace/consultant/apply"
					className="mt-5 inline-block rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
				>
					Become a consultant
				</Link>
			</div>
		);
	}

	const briefs = boardQuery.data ?? [];

	return (
		<div className="mx-auto max-w-5xl px-4 pb-20 pt-app-header sm:px-6 lg:px-8">
			<h1 className="mt-8 text-[30px] font-bold leading-tight tracking-tight text-foreground">
				Project briefs
			</h1>
			<p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
				Work clients are looking to have led. Send a proposal and they will see
				it beside every other applicant.
			</p>

			<div className="mt-6 flex flex-wrap items-center gap-2">
				<select
					aria-label="Filter by category"
					value={search.category ?? ""}
					onChange={(event) =>
						void navigate({
							search: (prev) => ({
								...prev,
								category: event.target.value || undefined,
							}),
						})
					}
					className="rounded-lg border border-input bg-background px-3 py-2 text-[13px] text-foreground outline-none focus:border-primary"
				>
					<option value="">All categories</option>
					{(categoriesQuery.data ?? []).map((category) => (
						<option key={category.id} value={category.id}>
							{category.name}
						</option>
					))}
				</select>

				<select
					aria-label="Filter by timeline"
					value={search.duration ?? ""}
					onChange={(event) =>
						void navigate({
							search: (prev) => ({
								...prev,
								duration: event.target.value || undefined,
							}),
						})
					}
					className="rounded-lg border border-input bg-background px-3 py-2 text-[13px] text-foreground outline-none focus:border-primary"
				>
					<option value="">Any timeline</option>
					{DURATION_OPTIONS.map((option) => (
						<option key={option.value} value={option.value}>
							{option.label}
						</option>
					))}
				</select>

				{ENGAGEMENT_TYPES.map((option) => (
					<button
						key={option.value}
						type="button"
						onClick={() =>
							void navigate({
								search: (prev) => ({
									...prev,
									engagement:
										prev.engagement === option.value ? undefined : option.value,
								}),
							})
						}
						className={`rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors ${
							search.engagement === option.value
								? "bg-primary text-primary-foreground"
								: "bg-muted text-muted-foreground hover:text-foreground"
						}`}
					>
						{option.label}
					</button>
				))}
			</div>

			{boardQuery.isPending ? (
				<div className="flex justify-center py-20">
					<Loader2 className="h-7 w-7 animate-spin text-primary" />
				</div>
			) : briefs.length === 0 ? (
				<p className="mt-10 rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
					No briefs match those filters yet.
				</p>
			) : (
				<div className="mt-6 divide-y divide-border border-t border-border">
					{briefs.map((brief) => (
						<BriefRow key={brief.id} brief={brief} />
					))}
				</div>
			)}
		</div>
	);
}

function BriefRow({ brief }: { brief: PostingBoardEntry }) {
	const budget =
		brief.budget_min !== null && brief.budget_max !== null
			? `${brief.budget_min.toLocaleString()}–${brief.budget_max.toLocaleString()} ${brief.currency}`
			: brief.budget_min !== null
				? `From ${brief.budget_min.toLocaleString()} ${brief.currency}`
				: brief.budget_max !== null
					? `Up to ${brief.budget_max.toLocaleString()} ${brief.currency}`
					: null;
	const duration = describeDuration(brief.duration, brief.duration_custom);

	return (
		<Link
			to="/brief/$briefId"
			params={{ briefId: brief.id }}
			className="block py-5 transition-colors hover:bg-muted/40"
		>
			<h2 className="text-[16px] font-semibold text-foreground">
				{brief.title}
			</h2>
			{brief.summary && (
				<p className="mt-1 line-clamp-2 text-[13.5px] leading-relaxed text-muted-foreground">
					{brief.summary.replace(/<[^>]*>/g, " ").trim()}
				</p>
			)}
			<div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12.5px] text-muted-foreground">
				{budget && (
					<span className="inline-flex items-center gap-1.5">
						<DollarSign className="h-3.5 w-3.5" />
						{budget}
					</span>
				)}
				{duration && (
					<span className="inline-flex items-center gap-1.5">
						<Clock className="h-3.5 w-3.5" />
						{duration}
					</span>
				)}
				<span>
					{brief.proposal_count}{" "}
					{brief.proposal_count === 1 ? "proposal" : "proposals"}
				</span>
			</div>
		</Link>
	);
}
