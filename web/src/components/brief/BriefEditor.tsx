import { Check, Flag, Loader2, Repeat } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";
import { BriefAttachments } from "@/components/brief/BriefAttachments";
import { BriefSectionsEditor } from "@/components/brief/BriefSectionsEditor";
import { InlineRichText } from "@/components/brief/InlineRichText";
import { RoadmapAttachPicker } from "@/components/brief/RoadmapAttachPicker";
import {
	GoLiveChoiceCard,
	GoLiveField,
	GoLiveInput,
} from "@/components/marketplace/wizard/GoLiveForm";
import type { ComposerFile } from "@/hooks/useBriefComposer";
import { useMarketplaceCategoryNavigationQuery } from "@/hooks/useMarketplaceTaxonomy";
import { type BriefDraft, toNumberOrNull } from "@/lib/briefDraft";
import { ENGAGEMENT_TYPES, missingPublishFields } from "@/lib/briefSections";
import {
	CUSTOM_DURATION,
	CUSTOM_DURATION_OPTION,
	DURATION_OPTIONS,
} from "@/lib/durations";
import type {
	PostingAttachment,
	PostingStatus,
} from "@/services/postings.service";

/** The same select surface the go-live wizard uses, so both flows read as one product. */
const SELECT_SURFACE =
	"w-full cursor-pointer rounded-xl border border-input bg-card px-4 py-3 text-sm text-card-foreground shadow-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/25";

/**
 * The brief editor, and nothing else — it owns no state and calls no service.
 *
 * That is what lets `/brief/new` run it with `briefId === null`: an unsaved
 * brief has no server row to read `currency`, `status`, the roadmap or the
 * attachments off, so all four arrive as props. The route with a row passes the
 * row values; the route without one passes local values.
 */
export function BriefEditor({
	briefId,
	draft,
	onPatch,
	attachments,
	onAttachmentsChange,
	pending,
	onPickFiles,
	onRemovePending,
	currency,
	status,
	busy,
	saving,
	publishing,
	headerLeft,
	headerExtra,
	onSave,
	onPublish,
}: {
	briefId: string | null;
	draft: BriefDraft;
	onPatch: (next: Partial<BriefDraft>) => void;
	attachments: PostingAttachment[];
	onAttachmentsChange: (next: PostingAttachment[]) => void;
	pending: ComposerFile[];
	onPickFiles: (files: File[]) => void;
	onRemovePending: (id: string) => void;
	currency: string;
	status: PostingStatus | "unsaved";
	busy: boolean;
	saving: boolean;
	publishing: boolean;
	headerLeft: ReactNode;
	headerExtra?: ReactNode;
	onSave: () => void;
	onPublish: () => void;
}) {
	const categoriesQuery = useMarketplaceCategoryNavigationQuery();
	// The overview behaves like a section: prose until it is clicked. Its own
	// state rather than the sections editor's, because the two are siblings —
	// opening one closes the other by way of the click-away, not a shared flag.
	const [editingOverview, setEditingOverview] = useState(false);
	const overviewRef = useRef<HTMLElement>(null);

	const missing = missingPublishFields({
		summary: draft.summary,
		budget_min: toNumberOrNull(draft.budget_min),
		budget_max: toNumberOrNull(draft.budget_max),
		duration: draft.duration,
		duration_custom: draft.duration_custom,
		category_id: draft.category_id,
	});

	return (
		<div className="min-h-screen bg-background text-foreground">
			<header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur">
				<div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
					{headerLeft}
					<div className="flex items-center gap-3">
						{saving && (
							<span className="text-[12.5px] text-muted-foreground">
								Saving…
							</span>
						)}
						{headerExtra}
						<button
							type="button"
							onClick={onSave}
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
											onChange={() =>
												onPatch({ engagement_type: option.value })
											}
										/>
									))}
								</div>
							</GoLiveField>

							<GoLiveField label="Category" required htmlFor="brief-category">
								<select
									id="brief-category"
									value={draft.category_id ?? ""}
									onChange={(event) =>
										onPatch({ category_id: event.target.value || null })
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
								label={`Budget (${currency})`}
								required
								hint="A range is fine. Consultants filter on it, so a brief without one is largely invisible."
							>
								<div className="flex items-center gap-2">
									<GoLiveInput
										aria-label="Minimum budget"
										inputMode="decimal"
										value={draft.budget_min}
										onChange={(event) =>
											onPatch({ budget_min: event.target.value })
										}
										placeholder="Min"
									/>
									<span className="text-muted-foreground">–</span>
									<GoLiveInput
										aria-label="Maximum budget"
										inputMode="decimal"
										value={draft.budget_max}
										onChange={(event) =>
											onPatch({ budget_max: event.target.value })
										}
										placeholder="Max"
									/>
								</div>
							</GoLiveField>

							<GoLiveField label="Timeline" required htmlFor="brief-duration">
								<select
									id="brief-duration"
									value={draft.duration ?? ""}
									onChange={(event) => {
										const duration = event.target.value || null;
										// Dropping the sentence with the option that asked for
										// it: the server clears it anyway, and leaving it in the
										// box invites the author to think it is still saved.
										onPatch({
											duration,
											duration_custom:
												duration === CUSTOM_DURATION
													? draft.duration_custom
													: null,
										});
									}}
									className={SELECT_SURFACE}
								>
									<option value="">Choose a timeline…</option>
									{DURATION_OPTIONS.map((option) => (
										<option key={option.value} value={option.value}>
											{option.label}
										</option>
									))}
									<option value={CUSTOM_DURATION_OPTION.value}>
										{CUSTOM_DURATION_OPTION.label}
									</option>
								</select>
								{draft.duration === CUSTOM_DURATION && (
									<GoLiveInput
										value={draft.duration_custom ?? ""}
										onChange={(event) =>
											onPatch({ duration_custom: event.target.value })
										}
										maxLength={80}
										aria-label="Timeline in your own words"
										placeholder="e.g. about ten weeks, or before our May launch"
										className="mt-2"
									/>
								)}
							</GoLiveField>
						</section>

						<section className="space-y-6">
							<GoLiveField
								label="Roadmap"
								hint="Attach one so consultants respond to the plan, not just the prose."
							>
								<RoadmapAttachPicker
									roadmap={draft.roadmap}
									disabled={busy}
									onChange={(roadmap) =>
										onPatch({ roadmap, roadmap_id: roadmap?.id ?? null })
									}
								/>
							</GoLiveField>

							<GoLiveField label="Attachments">
								<BriefAttachments
									postingId={briefId}
									attachments={attachments}
									pending={pending}
									canEdit
									onChange={onAttachmentsChange}
									onPickFiles={onPickFiles}
									onRemovePending={onRemovePending}
								/>
							</GoLiveField>
						</section>
					</aside>

					{/* Right: the brief itself. */}
					<div className="min-w-0 space-y-8">
						<input
							aria-label="Brief title"
							value={draft.title}
							onChange={(event) => onPatch({ title: event.target.value })}
							maxLength={200}
							placeholder="Name this project"
							className="w-full border-0 bg-transparent p-0 text-[30px] font-bold leading-tight tracking-tight text-foreground outline-none placeholder:text-muted-foreground/60"
						/>

						<section
							ref={overviewRef}
							className={`-mx-3 rounded-xl px-3 py-3 transition-colors ${
								editingOverview ? "bg-muted/30" : "hover:bg-muted/20"
							}`}
						>
							<div className="mb-2 flex items-center gap-2">
								<h2 className="flex-1 text-[15px] font-semibold text-foreground">
									Overview
								</h2>
								{editingOverview && (
									<button
										type="button"
										onClick={() => setEditingOverview(false)}
										className="shrink-0 text-[12.5px] font-semibold text-primary hover:underline"
									>
										Done
									</button>
								)}
							</div>
							<InlineRichText
								value={draft.summary}
								onChange={(summary) => onPatch({ summary })}
								editing={editingOverview}
								onEdit={() => setEditingOverview(true)}
								onDone={() => setEditingOverview(false)}
								disabled={busy}
								containerRef={overviewRef}
								minHeight="160px"
								emptyHint="What is being built, for whom, and why?"
								placeholder="What is being built, for whom, and why?"
								editLabel="Edit the overview"
							/>
						</section>

						<BriefSectionsEditor
							sections={draft.sections}
							disabled={busy}
							onChange={(sections) => onPatch({ sections })}
						/>
					</div>
				</div>
			</main>

			{/* Publish bar. Mirrors the wizard nav — same surface, same top-edge
			    fill (here: readiness, not steps), same primary action. */}
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
						onClick={onPublish}
						disabled={busy || missing.length > 0}
						className="flex cursor-pointer items-center gap-2 rounded-lg bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40 sm:px-8"
					>
						{publishing && <Loader2 className="h-4 w-4 animate-spin" />}
						{status === "published" ? "Save changes" : "Post your brief"}
					</button>
				</div>
			</div>
		</div>
	);
}
