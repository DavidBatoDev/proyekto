import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Loader2, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { BriefEditor } from "@/components/brief/BriefEditor";
import { BackLink } from "@/components/common/BackLink";
import { useBriefComposer } from "@/hooks/useBriefComposer";
import { useConfirm } from "@/hooks/useConfirm";
import { useToast } from "@/hooks/useToast";
import { commitBrief } from "@/lib/briefCommit";
import {
	type BriefDraft,
	EMPTY_BRIEF_DRAFT,
	isBriefDraftEmpty,
} from "@/lib/briefDraft";
import { readBriefDraft } from "@/lib/briefDraftStorage";
import { prunePendingFiles } from "@/lib/pendingFileStore";
import { postingsService } from "@/services/postings.service";

/**
 * Where a project brief starts, and where it is written.
 *
 * Two steps in one route: the one-box description, then the editor itself.
 * Nothing here creates a database row — not the generator, not "write it
 * myself", not attaching a file. The brief is written to the server only when
 * the author saves or publishes it, which is what stops an opened-and-abandoned
 * page from leaving an "Untitled brief" behind.
 *
 * Until then the draft lives in the browser: text in sessionStorage, attachment
 * bytes in IndexedDB (see `@/lib/briefDraftStorage` and
 * `@/lib/pendingFileStore`), so a refresh costs nothing.
 *
 * The generator is an accelerator, not a gate — "write it myself" opens the same
 * editor. That matters because the generator can be dormant (unset agent
 * config) or simply refuse, and a feature whose only entry point is an AI call
 * fails completely when the AI does.
 */
export const Route = createFileRoute("/_execution/brief/new")({
	// `need` is the marketplace hero's one-line box, handed over so somebody who
	// already typed what they want does not have to type it twice.
	validateSearch: (search: Record<string, unknown>) => ({
		need:
			typeof search.need === "string" ? search.need.slice(0, 5000) : undefined,
	}),
	component: NewBriefPage,
});

const MIN_DESCRIPTION = 30;

function NewBriefPage() {
	const navigate = useNavigate();
	const toast = useToast();
	const confirm = useConfirm();
	const qc = useQueryClient();
	const { need } = Route.useSearch();

	// Read once: this decides the opening step, and re-reading on every render
	// would fight the composer that now owns the same data.
	const [stored] = useState(() => readBriefDraft());
	const hasStoredDraft = Boolean(stored && !isBriefDraftEmpty(stored.draft));

	const [step, setStep] = useState<"start" | "editor">(
		hasStoredDraft && !need ? "editor" : "start",
	);
	// Separate from `hasStoredDraft` because that one is a first-render fact:
	// discarding the draft has to take the prompt with it.
	const [showResume, setShowResume] = useState(hasStoredDraft);
	const [description, setDescription] = useState(need ?? "");
	const [busy, setBusy] = useState<"generate" | "blank" | null>(null);
	const [saving, setSaving] = useState<"draft" | "publish" | null>(null);
	// Non-null only after a save that created the row but could not finish, so a
	// retry updates that brief instead of creating a second one.
	const [briefId, setBriefId] = useState<string | null>(
		stored?.briefId ?? null,
	);

	const composer = useBriefComposer({
		persist: true,
		briefId,
		initialDraft: stored?.draft ?? EMPTY_BRIEF_DRAFT,
		initialPendingIds: stored?.pendingFileIds ?? [],
	});

	// A tab closed on an unsaved draft takes its sessionStorage with it but
	// leaves the blobs behind, origin-wide. This is the only thing that reclaims
	// them.
	useEffect(() => {
		void prunePendingFiles();
	}, []);

	const startWith = (draft: BriefDraft) => {
		composer.setDraft(draft);
		setStep("editor");
	};

	const handleGenerate = async () => {
		if (description.trim().length < MIN_DESCRIPTION) {
			toast.error(
				`Tell us a little more first — at least ${MIN_DESCRIPTION} characters.`,
			);
			return;
		}
		setBusy("generate");
		try {
			const generated = await postingsService.generate(description.trim());
			startWith({
				...EMPTY_BRIEF_DRAFT,
				title: generated.title,
				engagement_type: generated.engagement_type,
				summary: generated.summary,
				sections: generated.sections,
			});
		} catch (error) {
			// A failed draft must not cost the author what they typed, so the box
			// keeps its text and they can retry or start blank.
			toast.error(
				error instanceof Error
					? error.message
					: "The generator could not draft this one.",
			);
		} finally {
			setBusy(null);
		}
	};

	const handleBlank = () => {
		setBusy("blank");
		startWith({
			...EMPTY_BRIEF_DRAFT,
			summary: description.trim()
				? `<p>${escapeHtml(description.trim())}</p>`
				: "",
		});
		setBusy(null);
	};

	const discardStored = async () => {
		await composer.clearLocal();
		composer.setDraft(EMPTY_BRIEF_DRAFT);
		setBriefId(null);
		setShowResume(false);
	};

	/**
	 * The one place this page writes to the server.
	 *
	 * A partial failure deliberately does not navigate: the row exists, the
	 * uploads that worked are on it, the ones that did not are still in the strip,
	 * and pressing the button again retries only those.
	 */
	const commit = async (publish: boolean) => {
		setSaving(publish ? "publish" : "draft");
		try {
			const result = await commitBrief({
				briefId,
				draft: composer.draftRef.current,
				pending: composer.pendingRef.current,
				existing: composer.attachments,
				onRowCreated: (id) => {
					setBriefId(id);
					composer.persistNow(id);
				},
			});
			setBriefId(result.briefId);
			composer.setAttachments(result.attachments);
			composer.keepPending(result.remaining.map((file) => file.id));

			if (result.error) {
				toast.error(
					`Saved as a draft, but ${result.remaining.length} ${
						result.remaining.length === 1 ? "file" : "files"
					} could not be uploaded. Try again.`,
				);
				return;
			}

			if (publish) await postingsService.publish(result.briefId);
			await composer.clearLocal();
			void qc.invalidateQueries({ queryKey: ["postings", "mine"] });

			if (publish) {
				toast.success("Your brief is live. Consultants can now respond.");
				// Awaited, not fired and forgotten: the next line renders the page
				// that reads this cache, and a stale entry shows the brief as a draft.
				await qc.invalidateQueries({ queryKey: ["posting", result.briefId] });
				await navigate({
					to: "/brief/$briefId",
					params: { briefId: result.briefId },
					replace: true,
				});
				return;
			}
			toast.success("Draft saved.");
			await navigate({
				to: "/brief/$briefId/edit",
				params: { briefId: result.briefId },
				replace: true,
			});
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Failed to save the brief.",
			);
		} finally {
			setSaving(null);
		}
	};

	if (step === "editor") {
		return (
			<BriefEditor
				briefId={briefId}
				draft={composer.draft}
				onPatch={composer.patch}
				attachments={composer.attachments}
				onAttachmentsChange={composer.setAttachments}
				pending={composer.pending}
				onPickFiles={(files) => void composer.addFiles(files)}
				onRemovePending={composer.removePending}
				currency="USD"
				status={briefId ? "draft" : "unsaved"}
				busy={saving !== null}
				saving={saving === "draft"}
				publishing={saving === "publish"}
				headerLeft={<BackLink fallback={{ to: "/dashboard" }} />}
				headerExtra={
					<button
						type="button"
						onClick={async () => {
							const ok = await confirm({
								title: "Start over?",
								message:
									"This clears the brief you are writing, including any files you attached. Nothing has been posted yet.",
								confirmLabel: "Start over",
								tone: "danger",
							});
							if (!ok) return;
							await discardStored();
							setStep("start");
						}}
						className="text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground"
					>
						Start over
					</button>
				}
				onSave={() => void commit(false)}
				onPublish={() => void commit(true)}
			/>
		);
	}

	return (
		<div className="min-h-screen bg-background text-foreground">
			<header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur">
				<div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-5 py-3 md:px-8">
					<BackLink fallback={{ to: "/dashboard" }} />
					<p className="text-sm font-semibold text-foreground">New brief</p>
				</div>
			</header>

			<main className="mx-auto max-w-3xl px-5 pb-24 pt-10 md:px-8">
				<h1 className="text-[32px] font-bold leading-tight tracking-tight text-foreground">
					What do you need built?
				</h1>
				<p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
					Describe it in your own words. We will turn it into a structured brief
					you can edit, then publish it for vetted consultants to respond to.
				</p>

				{/* Somebody arriving from the hero with a fresh sentence, on top of a
				    draft they never finished. Clobbering either one silently is the
				    wrong answer, so the choice is theirs. */}
				{showResume && (
					<div className="mt-6 rounded-xl border border-border bg-muted/40 px-4 py-3.5">
						<p className="text-[13px] font-medium text-foreground">
							You have an unsaved brief on this device.
						</p>
						<p className="mt-0.5 text-[12.5px] text-muted-foreground">
							It was never posted — pick it up where you left off, or start
							something new.
						</p>
						<div className="mt-2.5 flex flex-wrap items-center gap-3">
							<button
								type="button"
								onClick={() => setStep("editor")}
								className="rounded-lg bg-primary px-3.5 py-1.5 text-[13px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
							>
								Resume it
							</button>
							<button
								type="button"
								onClick={async () => {
									const ok = await confirm({
										title: "Discard the unsaved brief?",
										message:
											"It has not been posted, and any files attached to it are cleared too.",
										confirmLabel: "Discard",
										tone: "danger",
									});
									if (ok) await discardStored();
								}}
								className="text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground"
							>
								Discard it
							</button>
						</div>
					</div>
				)}

				<label
					htmlFor="brief-description"
					className="mt-8 mb-2 block text-sm font-semibold text-foreground"
				>
					How would you briefly describe your project?
				</label>
				<textarea
					id="brief-description"
					value={description}
					onChange={(event) => setDescription(event.target.value)}
					rows={10}
					maxLength={5000}
					disabled={busy !== null}
					placeholder="I want to build a marketplace that connects event organizers with suppliers — caterers, venues, photographers — so organizers can compare and contact vendors in one place."
					className="w-full resize-y rounded-lg border border-input bg-background px-3 py-2.5 leading-relaxed text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-60"
				/>
				<p className="mt-1.5 text-[12.5px] text-muted-foreground">
					{description.trim().length < MIN_DESCRIPTION
						? `${MIN_DESCRIPTION - description.trim().length} more characters before we can draft it.`
						: "Nothing is saved yet — you will see the draft first."}
				</p>

				<div className="mt-6 flex flex-wrap items-center gap-3">
					<button
						type="button"
						onClick={() => void handleGenerate()}
						disabled={busy !== null}
						className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
					>
						{busy === "generate" ? (
							<Loader2 className="h-4 w-4 animate-spin" />
						) : (
							<Sparkles className="h-4 w-4" />
						)}
						{busy === "generate" ? "Drafting…" : "Generate brief"}
					</button>
					<button
						type="button"
						onClick={handleBlank}
						disabled={busy !== null}
						className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-60"
					>
						Write it myself
					</button>
				</div>
			</main>
		</div>
	);
}

/** The blank path stores the raw box as the overview, so it must not carry markup. */
function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}
