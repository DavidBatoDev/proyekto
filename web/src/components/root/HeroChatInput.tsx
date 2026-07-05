import { useNavigate } from "@tanstack/react-router";
import { Loader2, Send } from "lucide-react";
import { useId, useState } from "react";
import { deriveRoadmapNameFromPrompt } from "@/lib/roadmapCreationFlow";
import { createRoadmapIntakeDraft } from "@/lib/roadmapIntakeDraft";
import { PENDING_AI_PROMPT_KEY_PREFIX } from "@/lib/roadmapPageHandoff";

/**
 * Re-exported for existing tests and callsites. The roadmap page reads and
 * removes this handoff key on mount, then auto-sends the prompt to the AI panel.
 */
export { deriveRoadmapNameFromPrompt, PENDING_AI_PROMPT_KEY_PREFIX };

interface SubmitHeroPromptOptions {
	navigate: (args: {
		to: "/project/$projectId/roadmap/create";
		params: { projectId: string };
		search: { draftId: string };
	}) => void | Promise<void>;
}

/**
 * Persist the first idea, then open the chat-style roadmap setup page. The
 * roadmap is created only after the user confirms name/category/thumbnail.
 */
export async function submitHeroPrompt(
	message: string,
	{ navigate }: SubmitHeroPromptOptions,
): Promise<void> {
	const draftId = createRoadmapIntakeDraft({
		prompt: message,
		source: "hero",
		projectId: "n",
	});

	await navigate({
		to: "/project/$projectId/roadmap/create",
		params: { projectId: "n" },
		search: { draftId },
	});
}

/**
 * Chat-style prompt input for the homepage hero. Submitting opens a full-page
 * AI setup step before the roadmap is created.
 */
export function HeroChatInput() {
	const navigate = useNavigate();
	const inputId = useId();
	const [message, setMessage] = useState("");
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const canSubmit = Boolean(message.trim()) && !isSubmitting;

	const handleSubmit = async () => {
		if (!canSubmit) return;
		setError(null);
		setIsSubmitting(true);
		try {
			await submitHeroPrompt(message.trim(), { navigate });
			// Success navigates away; keep the spinner on until unmount.
		} catch (submitError) {
			console.error("Failed to start a roadmap from the hero:", submitError);
			setError("Something went wrong starting your roadmap. Please try again.");
			setIsSubmitting(false);
		}
	};

	const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
		if (event.key === "Enter" && !event.shiftKey) {
			event.preventDefault();
			void handleSubmit();
		}
	};

	return (
		<div className="w-full max-w-2xl">
			<div className="rounded-2xl border border-white/20 bg-white/10 p-2 backdrop-blur transition-colors focus-within:border-cyan-300/60">
				<div className="flex items-end gap-2">
					<label htmlFor={inputId} className="sr-only">
						Describe your project idea
					</label>
					<textarea
						id={inputId}
						value={message}
						onChange={(event) => setMessage(event.target.value)}
						onKeyDown={handleKeyDown}
						disabled={isSubmitting}
						rows={2}
						maxLength={2000}
						placeholder='Describe your project idea - e.g. "Build a booking app for my tutoring business"'
						className="max-h-40 min-h-13 flex-1 resize-none bg-transparent px-3 py-2.5 text-left text-sm leading-relaxed text-white placeholder:text-white/50 focus:outline-none disabled:opacity-60 sm:text-base"
					/>
					<button
						type="button"
						onClick={() => void handleSubmit()}
						disabled={!canSubmit}
						aria-label="Start my roadmap"
						className="mb-1 mr-1 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-cyan-400 text-slate-950 shadow-[0_10px_28px_rgba(34,211,238,0.35)] transition-colors hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
					>
						{isSubmitting ? (
							<Loader2 className="h-5 w-5 animate-spin" />
						) : (
							<Send className="h-5 w-5" />
						)}
					</button>
				</div>
			</div>

			{error && (
				<p role="alert" className="mt-2.5 text-sm font-medium text-red-300">
					{error}
				</p>
			)}

			<p className="mt-3 text-xs text-white/60">
				Free to start. No credit card required.
			</p>
		</div>
	);
}
