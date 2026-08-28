import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Loader2, Sparkles } from "lucide-react";
import { useState } from "react";
import { BackLink } from "@/components/common/BackLink";
import { useToast } from "@/hooks/useToast";
import { postingsService } from "@/services/postings.service";

/**
 * Where a project brief starts: one box.
 *
 * The generator is an accelerator, not a gate — "write it myself" creates the
 * same empty draft and lands in the same editor. That matters because the
 * generator can be dormant (unset agent config) or simply refuse, and a feature
 * whose only entry point is an AI call fails completely when the AI does.
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
	const { need } = Route.useSearch();
	const [description, setDescription] = useState(need ?? "");
	const [busy, setBusy] = useState<"generate" | "blank" | null>(null);

	const openEditor = async (briefId: string) => {
		await navigate({
			to: "/brief/$briefId/edit",
			params: { briefId },
		});
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
			const draft = await postingsService.generate(description.trim());
			const created = await postingsService.create({
				title: draft.title || "Untitled brief",
				engagement_type: draft.engagement_type,
				summary: draft.summary,
				sections: draft.sections,
			});
			await openEditor(created.id);
		} catch (error) {
			// A failed draft must not cost the author what they typed, so the box
			// keeps its text and they can retry or start blank.
			toast.error(
				error instanceof Error
					? error.message
					: "The generator could not draft this one.",
			);
			setBusy(null);
		}
	};

	const handleBlank = async () => {
		setBusy("blank");
		try {
			const created = await postingsService.create({
				title: "Untitled brief",
				summary: description.trim()
					? `<p>${escapeHtml(description.trim())}</p>`
					: null,
			});
			await openEditor(created.id);
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Failed to create the brief.",
			);
			setBusy(null);
		}
	};

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
						: "Nothing here is published yet — you will see the draft first."}
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
						onClick={() => void handleBlank()}
						disabled={busy !== null}
						className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-60"
					>
						{busy === "blank" ? "Creating…" : "Write it myself"}
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
