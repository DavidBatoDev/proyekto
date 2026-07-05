import { useNavigate } from "@tanstack/react-router";
import { Loader2, Send } from "lucide-react";
import { useId, useState } from "react";
import { getOrCreateGuestUser } from "@/lib/guestAuth";
import { generateRoadmapThumbnailDataUri } from "@/lib/roadmapThumbnail";
import { roadmapService } from "@/services/roadmap.service";
import { useIsAuthenticated, useIsLoading } from "@/stores/authStore";

/**
 * sessionStorage handoff key prefix shared with RoadmapViewContent: the hero
 * writes the prompt under `proyekto_pending_ai_prompt:<roadmapId>` right
 * before navigating, and the roadmap page reads-and-removes it on mount to
 * auto-open the AI panel and send the message as the first agent turn. Keep
 * the literal in sync with RoadmapViewContent's copy.
 */
export const PENDING_AI_PROMPT_KEY_PREFIX = "proyekto_pending_ai_prompt:";

export const HERO_GUEST_SESSION_ERROR =
	"Couldn't start a session. Please check your connection and try again.";

const ROADMAP_NAME_MAX_LENGTH = 60;
const FALLBACK_ROADMAP_NAME = "New Roadmap";

/**
 * Derive a roadmap name from the hero prompt: collapse whitespace and keep
 * the first ~60 characters so long prompts still make a readable card title.
 */
export function deriveRoadmapNameFromPrompt(message: string): string {
	const collapsed = message.trim().replace(/\s+/g, " ");
	if (!collapsed) return FALLBACK_ROADMAP_NAME;
	if (collapsed.length <= ROADMAP_NAME_MAX_LENGTH) return collapsed;
	return `${collapsed.slice(0, ROADMAP_NAME_MAX_LENGTH).trimEnd()}…`;
}

interface SubmitHeroPromptOptions {
	isAuthenticated: boolean;
	navigate: (args: {
		to: "/project/$projectId/roadmap/$roadmapId";
		params: { projectId: string; roadmapId: string };
	}) => void | Promise<void>;
}

/**
 * Orchestrates the hero submit (mirrors RoadmapBuilder's proven create flow):
 * lazily mint a guest identity when unauthenticated, create an unlinked draft
 * roadmap (no `project_id`), stash the prompt for the roadmap page to
 * auto-send, then navigate to the roadmap-only view (`projectId === "n"`).
 * Exported for unit tests.
 */
export async function submitHeroPrompt(
	message: string,
	{ isAuthenticated, navigate }: SubmitHeroPromptOptions,
): Promise<void> {
	if (!isAuthenticated) {
		const guestId = await getOrCreateGuestUser().catch(() => null);
		if (!guestId) throw new Error(HERO_GUEST_SESSION_ERROR);
	}

	const name = deriveRoadmapNameFromPrompt(message);
	const roadmap = await roadmapService.create({
		name,
		description: "",
		status: "draft",
		settings: {},
		preview_url: generateRoadmapThumbnailDataUri(name, name),
	});

	sessionStorage.setItem(PENDING_AI_PROMPT_KEY_PREFIX + roadmap.id, message);

	await navigate({
		to: "/project/$projectId/roadmap/$roadmapId",
		params: { projectId: "n", roadmapId: roadmap.id },
	});
}

/**
 * Chat-style prompt input for the homepage hero: type an idea, and Proyekto
 * creates a draft roadmap (guest-owned for anonymous visitors) and lets the
 * AI agent build it from the prompt. Self-contained so it can be re-mounted
 * elsewhere on the landing page without restructuring.
 */
export function HeroChatInput() {
	const navigate = useNavigate();
	const inputId = useId();
	const isAuthenticated = useIsAuthenticated();
	const isAuthLoading = useIsLoading();
	const [message, setMessage] = useState("");
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const canSubmit = Boolean(message.trim()) && !isSubmitting && !isAuthLoading;

	const handleSubmit = async () => {
		if (!canSubmit) return;
		setError(null);
		setIsSubmitting(true);
		try {
			await submitHeroPrompt(message.trim(), { isAuthenticated, navigate });
			// Success navigates away — keep the spinner on until unmount.
		} catch (submitError) {
			console.error("Failed to start a roadmap from the hero:", submitError);
			setError(
				submitError instanceof Error &&
					submitError.message === HERO_GUEST_SESSION_ERROR
					? HERO_GUEST_SESSION_ERROR
					: "Something went wrong creating your roadmap. Please try again.",
			);
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
						placeholder='Describe your project idea — e.g. "Build a booking app for my tutoring business"'
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
