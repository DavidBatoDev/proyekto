import { useNavigate } from "@tanstack/react-router";
import { Loader2, Send, Sparkles } from "lucide-react";
import { useId, useState } from "react";
import { createRoadmapIntakeDraft } from "@/lib/roadmapIntakeDraft";

interface SubmitMarketplacePromptOptions {
	navigate: (args: {
		to: "/project/$projectId/roadmap/create";
		params: { projectId: string };
		search: { draftId: string };
	}) => void | Promise<void>;
}

export async function submitMarketplaceRoadmapPrompt(
	prompt: string,
	{ navigate }: SubmitMarketplacePromptOptions,
): Promise<void> {
	const normalizedPrompt = prompt.trim();
	if (!normalizedPrompt) return;

	const draftId = createRoadmapIntakeDraft({
		prompt: normalizedPrompt,
		source: "marketplace",
		projectId: "n",
	});

	await navigate({
		to: "/project/$projectId/roadmap/create",
		params: { projectId: "n" },
		search: { draftId },
	});
}

export function MarketplaceRoadmapPrompt() {
	const navigate = useNavigate();
	const promptId = useId();
	const [prompt, setPrompt] = useState("");
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const canSubmit = Boolean(prompt.trim()) && !isSubmitting;

	const handleSubmit = async () => {
		if (!canSubmit) return;
		setError(null);
		setIsSubmitting(true);

		try {
			await submitMarketplaceRoadmapPrompt(prompt, { navigate });
		} catch (submitError) {
			console.error(
				"Failed to start a roadmap from the marketplace:",
				submitError,
			);
			setError("We could not start your AI roadmap. Please try again.");
			setIsSubmitting(false);
		}
	};

	const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
		if (event.key === "Enter" && !event.shiftKey) {
			event.preventDefault();
			void handleSubmit();
		}
	};

	const handleChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
		setPrompt(event.target.value);
		event.currentTarget.style.height = "auto";
		event.currentTarget.style.height = `${Math.min(event.currentTarget.scrollHeight, 160)}px`;
	};

	return (
		<div className="mx-auto mt-7 max-w-4xl">
			<div className="relative rounded-2xl border-2 border-primary/30 bg-background/95 shadow-(--app-shadow-lg) backdrop-blur transition-colors focus-within:border-primary">
				<label htmlFor={promptId} className="sr-only">
					Describe what you want to build
				</label>
				<Sparkles className="pointer-events-none absolute left-5 top-5 h-5 w-5 text-primary" />
				<textarea
					id={promptId}
					value={prompt}
					onChange={handleChange}
					onKeyDown={handleKeyDown}
					disabled={isSubmitting}
					rows={1}
					maxLength={2000}
					placeholder="Describe what you want to build..."
					className="block min-h-16 max-h-40 w-full resize-none overflow-y-auto rounded-2xl bg-transparent py-4 pl-14 pr-16 text-base leading-8 text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-60 sm:pr-44"
				/>
				<button
					type="button"
					onClick={() => void handleSubmit()}
					disabled={!canSubmit}
					aria-label="Build roadmap with AI"
					className="absolute right-2 top-2 inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-primary px-3 text-sm font-bold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50 sm:px-5"
				>
					{isSubmitting ? (
						<Loader2 className="h-4 w-4 animate-spin" />
					) : (
						<Send className="h-4 w-4" />
					)}
					<span className="hidden sm:inline">Build with AI</span>
				</button>
			</div>

			{error ? (
				<p role="alert" className="mt-2 text-sm font-medium text-destructive">
					{error}
				</p>
			) : null}
			<p className="mt-2 text-center text-xs text-muted-foreground">
				Press Enter to start or Shift+Enter for a new line.
			</p>
		</div>
	);
}
