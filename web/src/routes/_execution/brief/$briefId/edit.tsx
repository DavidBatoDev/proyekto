import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Check, Flag, Loader2, Repeat } from "lucide-react";
import { useEffect, useState } from "react";
import { BriefAttachments } from "@/components/brief/BriefAttachments";
import { BriefSectionsEditor } from "@/components/brief/BriefSectionsEditor";
import { RoadmapAttachPicker } from "@/components/brief/RoadmapAttachPicker";
import { BackLink } from "@/components/common/BackLink";
import { RichTextEditor } from "@/components/common/RichTextEditor";
import {
	GoLiveChoiceCard,
	GoLiveField,
	GoLiveInput,
} from "@/components/marketplace/wizard/GoLiveForm";
import { useMarketplaceCategoryNavigationQuery } from "@/hooks/useMarketplaceTaxonomy";
import { useToast } from "@/hooks/useToast";
import {
	BRIEF_DURATIONS,
	type BriefSection,
	ENGAGEMENT_TYPES,
	missingPublishFields,
} from "@/lib/briefSections";
import {
	type PostingAttachment,
	type PostingEngagementType,
	type ProjectPostingDetail,
	postingsService,
} from "@/services/postings.service";

export const Route = createFileRoute("/_execution/brief/$briefId/edit")({
	component: BriefEditorPage,
});

interface Draft {
	title: string;
	engagement_type: PostingEngagementType;
	summary: string;
	sections: BriefSection[];
	category_id: string | null;
	budget_min: string;
	budget_max: string;
	duration: string | null;
}

function toDraft(brief: ProjectPostingDetail): Draft {
	return {
		title: brief.title,
		engagement_type: brief.engagement_type,
		summary: brief.summary ?? "",
		sections: brief.sections,
		category_id: brief.category_id,
		budget_min: brief.budget_min === null ? "" : String(brief.budget_min),
		budget_max: brief.budget_max === null ? "" : String(brief.budget_max),
		duration: brief.duration,
	};
}

function toNumberOrNull(value: string): number | null {
	const trimmed = value.trim();
	if (trimmed === "") return null;
	const parsed = Number(trimmed);
	return Number.isFinite(parsed) ? parsed : null;
}

/** Same select surface the wizard's StepProfile uses, so both flows read as one product. */
const SELECT_SURFACE =
	"w-full cursor-pointer rounded-xl border border-input bg-card px-4 py-3 text-sm text-card-foreground shadow-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/25";

function BriefEditorPage() {
	const { briefId } = Route.useParams();
	const navigate = useNavigate();
	const toast = useToast();
	const qc = useQueryClient();

	const briefQuery = useQuery({
		queryKey: ["posting", briefId] as const,
		queryFn: () => postingsService.get(briefId),
	});
	const categoriesQuery = useMarketplaceCategoryNavigationQuery();

	const [draft, setDraft] = useState<Draft | null>(null);
	const [attachments, setAttachments] = useState<PostingAttachment[]>([]);

	// Seed once per loaded brief. Re-seeding on every refetch would throw away
	// whatever the author has typed since.
	useEffect(() => {
		if (!briefQuery.data) return;
		setDraft((current) => current ?? toDraft(briefQuery.data));
		setAttachments(briefQuery.data.attachments);
	}, [briefQuery.data]);

	const save = useMutation({
		mutationFn: (patch: Partial<Draft>) => {
			const next = { ...(draft as Draft), ...patch };
			return postingsService.update(briefId, {
				title: next.title.trim() || "Untitled brief",
				engagement_type: next.engagement_type,
				summary: next.summary,
				sections: next.sections,
				category_id: next.category_id,
				budget_min: toNumberOrNull(next.budget_min),
				budget_max: toNumberOrNull(next.budget_max),
				duration: next.duration,
			});
		},
		onSuccess: () => {
			void qc.invalidateQueries({ queryKey: ["posting", briefId] });
			void qc.invalidateQueries({ queryKey: ["postings", "mine"] });
		},
		onError: (error: Error) => toast.error(error.message),
	});

	const publish = useMutation({
		mutationFn: async () => {
			await save.mutateAsync({});
			return postingsService.publish(briefId);
		},
		onSuccess: async () => {
			toast.success("Your brief is live. Consultants can now respond.");
			// The detail cache has to be awaited, not fired and forgotten: the very
			// next line navigates to the page that reads it, and a stale entry
			// renders the brief we just published as a draft.
			await qc.invalidateQueries({ queryKey: ["posting", briefId] });
			void qc.invalidateQueries({ queryKey: ["postings", "mine"] });
			await navigate({ to: "/brief/$briefId", params: { briefId } });
		},
		onError: (error: Error) => toast.error(error.message),
	});

	if (briefQuery.isPending || !draft) {
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
						It may have been deleted, or it belongs to somebody else.
					</p>
				</div>
			</div>
		);
	}

	const brief = briefQuery.data;
	const missing = missingPublishFields({
		summary: draft.summary,
		budget_min: toNumberOrNull(draft.budget_min),
		budget_max: toNumberOrNull(draft.budget_max),
		duration: draft.duration,
		category_id: draft.category_id,
	});
	const busy = save.isPending || publish.isPending;

	const patch = (next: Partial<Draft>) =>
		setDraft((current) => (current ? { ...current, ...next } : current));

	return (
		<div className="min-h-screen bg-background text-foreground">
			<header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur">
				<div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
					<BackLink fallback={{ to: "/dashboard" }} />
					<div className="flex items-center gap-3">
						{save.isPending && (
							<span className="text-[12.5px] text-muted-foreground">
								Saving…
							</span>
						)}
						<button
							type="button"
							onClick={() => save.mutate({})}
							disabled={busy}
							className="rounded-full border border-border px-4 py-1.5 text-[13px] font-semibold text-foreground transition-colors hover:bg-muted disabled:opacity-60"
						>
							Save draft
						</button>
					</div>
				</div>
			</header>

			<main className="mx-auto max-w-6xl px-4 pb-32 pt-8 sm:px-6 lg:px-8">
				<div className="grid gap-8 lg:grid-cols-[minmax(0,300px)_minmax(0,1fr)]">
					{/* Left rail: the structured facts the board filters on, plus what
					    travels with the brief. */}
					<aside className="space-y-7 lg:sticky lg:top-24 lg:self-start">
						<section className="space-y-6">
							<GoLiveField label="What best describes your needs?" required>
								<div className="grid gap-3">
									{ENGAGEMENT_TYPES.map((option) => (
										<GoLiveChoiceCard
											key={option.value}
											name="brief-engagement"
											value={option.value}
											label={option.label}
											description={option.description}
											icon={
												option.value === "one_time" ? (
													<Flag className="h-4.5 w-4.5" />
												) : (
													<Repeat className="h-4.5 w-4.5" />
												)
											}
											checked={draft.engagement_type === option.value}
											onChange={() => patch({ engagement_type: option.value })}
										/>
									))}
								</div>
							</GoLiveField>

							<GoLiveField label="Category" required htmlFor="brief-category">
								<select
									id="brief-category"
									value={draft.category_id ?? ""}
									onChange={(event) =>
										patch({ category_id: event.target.value || null })
									}
									className={SELECT_SURFACE}
								>
									<option value="">Choose a category…</option>
									{(categoriesQuery.data ?? []).map((category) => (
										<option key={category.id} value={category.id}>
											{category.name}
										</option>
									))}
								</select>
							</GoLiveField>

							<GoLiveField
								label={`Budget (${brief.currency})`}
								required
								hint="A range is fine. Consultants filter on it, so a brief without one is largely invisible."
							>
								<div className="flex items-center gap-2">
									<GoLiveInput
										aria-label="Minimum budget"
										inputMode="decimal"
										value={draft.budget_min}
										onChange={(event) =>
											patch({ budget_min: event.target.value })
										}
										placeholder="Min"
									/>
									<span className="text-muted-foreground">–</span>
									<GoLiveInput
										aria-label="Maximum budget"
										inputMode="decimal"
										value={draft.budget_max}
										onChange={(event) =>
											patch({ budget_max: event.target.value })
										}
										placeholder="Max"
									/>
								</div>
							</GoLiveField>

							<GoLiveField label="Timeline" required htmlFor="brief-duration">
								<select
									id="brief-duration"
									value={draft.duration ?? ""}
									onChange={(event) =>
										patch({ duration: event.target.value || null })
									}
									className={SELECT_SURFACE}
								>
									<option value="">Choose a timeline…</option>
									{BRIEF_DURATIONS.map((option) => (
										<option key={option.value} value={option.value}>
											{option.label}
										</option>
									))}
								</select>
							</GoLiveField>
						</section>

						<section className="space-y-6">
							<GoLiveField
								label="Roadmap"
								hint="Attach one so consultants respond to the plan, not just the prose."
							>
								<RoadmapAttachPicker
									roadmapId={brief.roadmap_id}
									roadmap={brief.roadmap}
									disabled={busy}
									onChange={(roadmapId) => {
										void postingsService
											.update(briefId, { roadmap_id: roadmapId })
											.then(() =>
												qc.invalidateQueries({
													queryKey: ["posting", briefId],
												}),
											)
											.catch((error: Error) => toast.error(error.message));
									}}
								/>
							</GoLiveField>

							<GoLiveField label="Attachments">
								<BriefAttachments
									postingId={briefId}
									attachments={attachments}
									canEdit
									onChange={setAttachments}
								/>
							</GoLiveField>
						</section>
					</aside>

					{/* Right: the brief itself. */}
					<div className="min-w-0 space-y-8">
						<input
							aria-label="Brief title"
							value={draft.title}
							onChange={(event) => patch({ title: event.target.value })}
							maxLength={200}
							placeholder="Name this project"
							className="w-full border-0 bg-transparent p-0 text-[30px] font-bold leading-tight tracking-tight text-foreground outline-none placeholder:text-muted-foreground/60"
						/>

						<section>
							<h2 className="text-[15px] font-semibold text-foreground">
								Overview
							</h2>
							<p className="mt-1 mb-3 text-sm text-muted-foreground">
								What is being built, for whom, and why. This is the first thing
								a consultant reads.
							</p>
							<RichTextEditor
								value={draft.summary}
								onChange={(value) => patch({ summary: value })}
								tools={[
									"textFormat",
									"bold",
									"italic",
									"separator",
									"bulletList",
									"numberedList",
									"separator",
									"link",
								]}
								minHeight="160px"
								maxHeight="420px"
								placeholder="What is being built, for whom, and why?"
							/>
						</section>

						<BriefSectionsEditor
							sections={draft.sections}
							disabled={busy}
							onChange={(sections) => patch({ sections })}
						/>
					</div>
				</div>
			</main>

			{/* Publish bar. Mirrors the wizard's GoLiveNav — same surface, same
			    top-edge fill (here: readiness, not steps), same primary action. */}
			<div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card pb-[env(safe-area-inset-bottom)]">
				<div
					className="absolute inset-x-0 top-0 h-[3px] bg-muted"
					role="progressbar"
					aria-valuenow={missing.length === 0 ? 1 : 0}
					aria-valuemin={0}
					aria-valuemax={1}
					aria-label="Ready to publish"
				>
					<div
						className="h-full bg-primary transition-[width] duration-500 ease-out"
						style={{ width: missing.length === 0 ? "100%" : "0%" }}
					/>
				</div>
				<div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3.5 sm:px-6 lg:px-8">
					<p className="text-[13px] text-muted-foreground">
						{missing.length === 0 ? (
							<span className="inline-flex items-center gap-1.5 text-foreground">
								<Check className="h-4 w-4 text-primary" />
								Ready to publish
							</span>
						) : (
							`${missing.length} missing ${missing.length === 1 ? "field" : "fields"}: ${missing.join(", ")}`
						)}
					</p>
					<button
						type="button"
						onClick={() => publish.mutate()}
						disabled={busy || missing.length > 0}
						className="flex cursor-pointer items-center gap-2 rounded-lg bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40 sm:px-8"
					>
						{publish.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
						{brief.status === "published" ? "Save changes" : "Post your brief"}
					</button>
				</div>
			</div>
		</div>
	);
}
