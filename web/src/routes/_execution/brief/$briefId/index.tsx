import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
	Clock,
	DollarSign,
	FileText,
	Loader2,
	Map as MapIcon,
	Pencil,
} from "lucide-react";
import { useState } from "react";
import { BackLink } from "@/components/common/BackLink";
import { useToast } from "@/hooks/useToast";
import { isActiveConsultant } from "@/lib/auth-utils";
import { ENGAGEMENT_TYPES } from "@/lib/briefSections";
import { describeDuration } from "@/lib/durations";
import {
	type PostingProposalWithConsultant,
	type ProjectPostingDetail,
	postingsService,
} from "@/services/postings.service";
import { useProfile, useUser } from "@/stores/authStore";

export const Route = createFileRoute("/_execution/brief/$briefId/")({
	component: BriefDetailPage,
});

function BriefDetailPage() {
	const { briefId } = Route.useParams();
	const user = useUser();
	const profile = useProfile();

	const briefQuery = useQuery({
		queryKey: ["posting", briefId] as const,
		queryFn: () => postingsService.get(briefId),
	});

	if (briefQuery.isPending) {
		return (
			<div className="flex min-h-screen items-center justify-center bg-background">
				<Loader2 className="h-8 w-8 animate-spin text-primary" />
			</div>
		);
	}

	if (briefQuery.isError || !briefQuery.data) {
		return (
			<div className="flex min-h-screen items-center justify-center bg-background px-6 text-center">
				<div>
					<p className="text-base font-semibold text-foreground">
						Brief not found
					</p>
					<p className="mt-1 text-sm text-muted-foreground">
						It may have been closed, or it is not published yet.
					</p>
				</div>
			</div>
		);
	}

	const brief = briefQuery.data;
	const isAuthor = brief.author_id === user?.id;

	return (
		<div className="min-h-screen bg-background text-foreground">
			<header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur">
				<div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
					<BackLink
						fallback={{ to: isAuthor ? "/dashboard" : "/marketplace/briefs" }}
					/>
					{isAuthor && (
						<Link
							to="/brief/$briefId/edit"
							params={{ briefId }}
							className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-1.5 text-[13px] font-semibold text-foreground transition-colors hover:bg-muted"
						>
							<Pencil className="h-3.5 w-3.5" />
							Edit brief
						</Link>
					)}
				</div>
			</header>

			<main className="mx-auto max-w-5xl px-4 pb-24 pt-8 sm:px-6 lg:px-8">
				<div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_300px]">
					<article className="min-w-0">
						<BriefStatusLine brief={brief} />
						<h1 className="mt-2 text-[30px] font-bold leading-tight tracking-tight text-foreground">
							{brief.title}
						</h1>

						<MetaStrip brief={brief} />

						{brief.summary && (
							<section className="mt-8">
								<h2 className="text-[15px] font-semibold text-foreground">
									Overview
								</h2>
								<div
									// Authored in this app's rich-text editor and stored as its
									// sanitized output.
									dangerouslySetInnerHTML={{ __html: brief.summary }}
									className="mt-1.5 text-[14px] leading-relaxed text-muted-foreground"
								/>
							</section>
						)}

						{brief.sections.map((section) => (
							<section
								key={`${section.key}-${section.position}`}
								className="mt-7"
							>
								<h2 className="text-[15px] font-semibold text-foreground">
									{section.key}
								</h2>
								<div
									dangerouslySetInnerHTML={{ __html: section.value }}
									className="mt-1.5 text-[14px] leading-relaxed text-muted-foreground"
								/>
							</section>
						))}

						{isAuthor && <ApplicantList briefId={briefId} />}
					</article>

					<aside className="space-y-7 lg:sticky lg:top-24 lg:self-start">
						{brief.roadmap && (
							<section>
								<h2 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
									Attached roadmap
								</h2>
								<div className="flex items-start gap-2.5 rounded-lg border border-border px-3 py-2.5">
									<MapIcon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
									<div className="min-w-0">
										<p className="truncate text-[13px] font-medium text-foreground">
											{brief.roadmap.name}
										</p>
										<p className="mt-0.5 text-[11.5px] text-muted-foreground">
											{brief.roadmap.epic_count} epics ·{" "}
											{brief.roadmap.feature_count} features ·{" "}
											{brief.roadmap.task_count} tasks
										</p>
									</div>
								</div>
							</section>
						)}

						{brief.attachments.length > 0 && (
							<section>
								<h2 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
									Attachments
								</h2>
								<ul className="space-y-1.5">
									{brief.attachments.map((attachment) => (
										<li key={attachment.id}>
											<a
												href={attachment.url}
												target="_blank"
												rel="noreferrer"
												className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-2 text-[13px] text-foreground transition-colors hover:bg-muted"
											>
												<FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
												<span className="truncate">{attachment.name}</span>
											</a>
										</li>
									))}
								</ul>
							</section>
						)}

						{!isAuthor && (
							<ApplyPanel
								brief={brief}
								canApply={isActiveConsultant(profile)}
							/>
						)}
					</aside>
				</div>
			</main>
		</div>
	);
}

function BriefStatusLine({ brief }: { brief: ProjectPostingDetail }) {
	const label =
		brief.status === "published"
			? "Open for proposals"
			: brief.status === "draft"
				? "Draft — not visible to consultants"
				: "Closed";
	return (
		<span
			className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11.5px] font-semibold ${
				brief.status === "published"
					? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
					: "bg-muted text-muted-foreground"
			}`}
		>
			{label}
		</span>
	);
}

function MetaStrip({ brief }: { brief: ProjectPostingDetail }) {
	const budget =
		brief.budget_min !== null && brief.budget_max !== null
			? `${brief.budget_min.toLocaleString()}–${brief.budget_max.toLocaleString()} ${brief.currency}`
			: brief.budget_min !== null
				? `From ${brief.budget_min.toLocaleString()} ${brief.currency}`
				: brief.budget_max !== null
					? `Up to ${brief.budget_max.toLocaleString()} ${brief.currency}`
					: null;
	const duration = describeDuration(brief.duration, brief.duration_custom);
	const engagement = ENGAGEMENT_TYPES.find(
		(option) => option.value === brief.engagement_type,
	)?.label;

	return (
		<div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12.5px] text-muted-foreground">
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
			{engagement && <span>{engagement}</span>}
			{brief.proposal_count > 0 && (
				<span>
					{brief.proposal_count}{" "}
					{brief.proposal_count === 1 ? "proposal" : "proposals"}
				</span>
			)}
		</div>
	);
}

/** The consultant's lightweight apply: a pitch and a ballpark. */
function ApplyPanel({
	brief,
	canApply,
}: {
	brief: ProjectPostingDetail;
	canApply: boolean;
}) {
	const toast = useToast();
	const qc = useQueryClient();
	const [pitch, setPitch] = useState(brief.my_proposal?.pitch ?? "");
	const [rate, setRate] = useState(
		brief.my_proposal?.indicative_rate === null ||
			brief.my_proposal?.indicative_rate === undefined
			? ""
			: String(brief.my_proposal.indicative_rate),
	);
	const [unit, setUnit] = useState(brief.my_proposal?.rate_unit ?? "project");

	const submit = useMutation({
		mutationFn: () =>
			postingsService.submitProposal(brief.id, {
				pitch: pitch.trim(),
				indicative_rate: rate.trim() === "" ? null : Number(rate),
				rate_unit: unit,
			}),
		onSuccess: () => {
			toast.success("Your proposal is with the client.");
			void qc.invalidateQueries({ queryKey: ["posting", brief.id] });
		},
		onError: (error: Error) => toast.error(error.message),
	});

	if (!canApply) {
		return (
			<section className="rounded-xl border border-border p-4">
				<p className="text-[13px] text-muted-foreground">
					Proposals come from vetted consultants. Apply to become one and you
					can respond to briefs like this.
				</p>
				<Link
					to="/marketplace/consultant/apply"
					className="mt-2 inline-block text-[13px] font-semibold text-primary hover:underline"
				>
					Become a consultant
				</Link>
			</section>
		);
	}

	if (brief.status !== "published") {
		return (
			<section className="rounded-xl border border-border p-4 text-[13px] text-muted-foreground">
				This brief is not open for proposals.
			</section>
		);
	}

	const existing = brief.my_proposal;
	const alreadySent = existing && existing.status !== "withdrawn";

	return (
		<section className="rounded-xl border border-border p-4">
			<h2 className="text-[14px] font-semibold text-foreground">
				{alreadySent ? "Your proposal" : "Send a proposal"}
			</h2>
			{alreadySent && (
				<p className="mt-1 text-[12px] text-muted-foreground">
					Status: {existing.status}. Editing replaces what the client sees.
				</p>
			)}

			<label
				htmlFor="proposal-pitch"
				className="mt-3 mb-1.5 block text-[12.5px] font-medium text-muted-foreground"
			>
				Why you, for this
			</label>
			<textarea
				id="proposal-pitch"
				value={pitch}
				onChange={(event) => setPitch(event.target.value)}
				rows={5}
				maxLength={2000}
				placeholder="What you have shipped that makes this straightforward for you."
				className="w-full resize-y rounded-lg border border-input bg-background px-3 py-2.5 text-[13px] text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20"
			/>

			<label
				htmlFor="proposal-rate"
				className="mt-3 mb-1.5 block text-[12.5px] font-medium text-muted-foreground"
			>
				Indicative rate ({brief.currency})
			</label>
			<div className="flex items-center gap-2">
				<input
					id="proposal-rate"
					inputMode="decimal"
					value={rate}
					onChange={(event) => setRate(event.target.value)}
					placeholder="Optional"
					className="min-w-0 flex-1 rounded-lg border border-input bg-background px-3 py-2 text-[13px] text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
				/>
				<select
					aria-label="Rate unit"
					value={unit}
					onChange={(event) => setUnit(event.target.value as typeof unit)}
					className="rounded-lg border border-input bg-background px-2 py-2 text-[13px] text-foreground outline-none focus:border-primary"
				>
					<option value="project">per project</option>
					<option value="hour">per hour</option>
					<option value="month">per month</option>
				</select>
			</div>
			<p className="mt-1.5 text-[11.5px] text-muted-foreground">
				A ballpark for triage — nothing here is binding.
			</p>

			<button
				type="button"
				onClick={() => submit.mutate()}
				disabled={submit.isPending || pitch.trim().length < 20}
				className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-[13px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
			>
				{submit.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
				{alreadySent ? "Update proposal" : "Send proposal"}
			</button>
			{pitch.trim().length < 20 && (
				<p className="mt-1.5 text-[11.5px] text-muted-foreground">
					A pitch needs at least 20 characters.
				</p>
			)}
		</section>
	);
}

/** The author's applicant list: a divided list, shortlist or decline inline. */
function ApplicantList({ briefId }: { briefId: string }) {
	const toast = useToast();
	const qc = useQueryClient();
	const proposalsQuery = useQuery({
		queryKey: ["posting", briefId, "proposals"] as const,
		queryFn: () => postingsService.listProposals(briefId),
	});

	const triage = useMutation({
		mutationFn: ({
			proposalId,
			status,
		}: {
			proposalId: string;
			status: "shortlisted" | "declined";
		}) => postingsService.triageProposal(proposalId, status),
		onSuccess: () =>
			qc.invalidateQueries({ queryKey: ["posting", briefId, "proposals"] }),
		onError: (error: Error) => toast.error(error.message),
	});

	const proposals = proposalsQuery.data ?? [];

	return (
		<section className="mt-10 border-t border-border pt-6">
			<h2 className="text-[15px] font-semibold text-foreground">
				Proposals
				{proposals.length > 0 && (
					<span className="ml-1.5 text-[13px] font-normal text-muted-foreground">
						{proposals.length}
					</span>
				)}
			</h2>

			{proposalsQuery.isPending ? (
				<p className="mt-3 text-[13px] text-muted-foreground">Loading…</p>
			) : proposals.length === 0 ? (
				<p className="mt-3 rounded-xl border border-dashed border-border px-4 py-6 text-center text-[13px] text-muted-foreground">
					No proposals yet. Consultants see this brief on the board as soon as
					it is published.
				</p>
			) : (
				<div className="mt-2 divide-y divide-border">
					{proposals.map((proposal) => (
						<ApplicantRow
							key={proposal.id}
							proposal={proposal}
							busy={triage.isPending}
							onTriage={(status) =>
								triage.mutate({ proposalId: proposal.id, status })
							}
						/>
					))}
				</div>
			)}
		</section>
	);
}

function ApplicantRow({
	proposal,
	busy,
	onTriage,
}: {
	proposal: PostingProposalWithConsultant;
	busy: boolean;
	onTriage: (status: "shortlisted" | "declined") => void;
}) {
	const name =
		[proposal.consultant?.first_name, proposal.consultant?.last_name]
			.filter(Boolean)
			.join(" ") || "A consultant";
	const withdrawn = proposal.status === "withdrawn";

	return (
		<div className="py-4">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<div className="flex items-center gap-2.5">
					{proposal.consultant?.avatar_url ? (
						<img
							src={proposal.consultant.avatar_url}
							alt={name}
							className="h-8 w-8 rounded-full object-cover"
						/>
					) : (
						<span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-[13px] font-semibold text-primary-foreground">
							{name.charAt(0).toUpperCase()}
						</span>
					)}
					<div>
						<Link
							to="/profile/$profileId"
							params={{ profileId: proposal.consultant_id }}
							className="text-[14px] font-semibold text-foreground hover:underline"
						>
							{name}
						</Link>
						{proposal.indicative_rate !== null && (
							<p className="text-[12px] text-muted-foreground">
								{proposal.indicative_rate.toLocaleString()}{" "}
								{proposal.rate_currency} per {proposal.rate_unit}
							</p>
						)}
					</div>
				</div>

				{withdrawn ? (
					<span className="text-[12px] text-muted-foreground">Withdrawn</span>
				) : (
					<div className="flex items-center gap-2">
						{proposal.status === "shortlisted" && (
							<span className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-[11.5px] font-semibold text-emerald-600 dark:text-emerald-400">
								Shortlisted
							</span>
						)}
						{proposal.status === "declined" && (
							<span className="rounded-full bg-muted px-2.5 py-1 text-[11.5px] font-semibold text-muted-foreground">
								Declined
							</span>
						)}
						{proposal.status === "submitted" && (
							<>
								<button
									type="button"
									disabled={busy}
									onClick={() => onTriage("shortlisted")}
									className="rounded-full border border-border px-3 py-1.5 text-[12.5px] font-semibold text-foreground transition-colors hover:bg-muted disabled:opacity-60"
								>
									Shortlist
								</button>
								<button
									type="button"
									disabled={busy}
									onClick={() => onTriage("declined")}
									className="rounded-full border border-border px-3 py-1.5 text-[12.5px] font-medium text-muted-foreground transition-colors hover:bg-muted disabled:opacity-60"
								>
									Decline
								</button>
							</>
						)}
					</div>
				)}
			</div>

			<p className="mt-2 whitespace-pre-line text-[13.5px] leading-relaxed text-muted-foreground">
				{proposal.pitch}
			</p>
		</div>
	);
}
