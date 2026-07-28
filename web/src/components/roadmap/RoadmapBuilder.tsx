import { useNavigate } from "@tanstack/react-router";
import {
	ArrowLeft,
	Check,
	CheckCircle2,
	ImagePlus,
	Loader2,
	RefreshCw,
	Send,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Header from "@/components/layout/Header";
import { featureFlags } from "@/config/featureFlags";
import { getOrCreateGuestUser } from "@/lib/guestAuth";
import {
	buildFallbackRoadmapMetadata,
	createRoadmapFromMetadata,
	DEFAULT_ROADMAP_CATEGORY,
	DEFAULT_ROADMAP_NAME,
} from "@/lib/roadmapCreationFlow";
import {
	clearRoadmapIntakeDraft,
	readRoadmapIntakeDraft,
} from "@/lib/roadmapIntakeDraft";
import { generateRoadmapThumbnailDataUri } from "@/lib/roadmapThumbnail";
import {
	pickStockPhotoUrl,
	resolveStockTheme,
	stockPhotoPoolSize,
} from "@/lib/stockPhoto";
import {
	type RoadmapIntakeCaptured,
	type RoadmapIntakeTurn,
	roadmapService,
	type SuggestedRoadmapIntakeOption,
	type SuggestedRoadmapIntakeQuestion,
	type SuggestedRoadmapIntakeStep,
} from "@/services/roadmap.service";
import type { AgentClarifierAnswerEntry } from "@/services/roadmap-agent.service";
import { uploadService } from "@/services/upload.service";
import { useIsLoading, useUser } from "@/stores/authStore";
import { RoadmapAiClarifierCard } from "./ai/RoadmapAiClarifierCard";
import { buildClarifierDisplayLabel } from "./ai/RoadmapAiClarifierCard.logic";
import {
	buildTurnFromAnswers,
	INTAKE_SLOT_CHIPS,
	isSlotFilled,
} from "./roadmapIntakeTurns";

type RoadmapBuilderProps = {
	projectId?: string;
	embedded?: boolean;
	draftId?: string;
};

type IntakeStep =
	| "prompt"
	| "clarification"
	| "title"
	| "description"
	| "thumbnail"
	| "canceled";

type ChatMessage = {
	id: string;
	role: "user" | "assistant";
	content: string;
	createdAt: number;
};

const MAX_PROMPT_LENGTH = 2000;
const TITLE_LIMIT = 200;
const DESCRIPTION_LIMIT = 1200;
const CATEGORY_LIMIT = 80;
const MAX_SELECTED_CATEGORIES = 6;

const DEFAULT_TITLE_MESSAGE =
	"Before we start, what should we call this roadmap? I sketched a few directions, or you can name it yourself.";
const DEFAULT_DESCRIPTION_MESSAGE =
	"What is the goal of this roadmap? Pick one direction below or write your own.";
const THUMBNAIL_MESSAGE =
	"Last step: I picked a cover image that fits your roadmap. Keep it, shuffle for another, or upload your own.";
/**
 * Used when curated photos are off or the theme pool is empty, so the degraded
 * flow reads exactly as it did before cover images existed.
 */
const THUMBNAIL_MESSAGE_FALLBACK =
	"Last step: upload a thumbnail or skip this part. If you skip, I will use the generated thumbnail below.";

const FALLBACK_CATEGORIES = [
	"Web Development",
	"Mobile App",
	"SaaS",
	"AI / ML",
	"E-commerce",
	"Marketing",
	"Health & Fitness",
];

function createMessageId(): string {
	return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function wait(ms: number): Promise<void> {
	return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function formatMessageTime(timestamp: number): string {
	return new Intl.DateTimeFormat(undefined, {
		hour: "numeric",
		minute: "2-digit",
	}).format(new Date(timestamp));
}

function normalizeOptions(
	options: SuggestedRoadmapIntakeOption[] | undefined,
	fallbackValues: string[],
): SuggestedRoadmapIntakeOption[] {
	const keys = ["A", "B", "C"] as const;
	return keys.map((key, index) => ({
		key,
		value:
			options?.find((option) => option.key === key)?.value ||
			fallbackValues[index] ||
			fallbackValues[0] ||
			DEFAULT_ROADMAP_NAME,
	}));
}

function buildFallbackIntakeStep(
	step: "title" | "description",
	prompt: string,
	title?: string,
): SuggestedRoadmapIntakeStep {
	const fallback = buildFallbackRoadmapMetadata(prompt);
	if (step === "title") {
		return {
			assistant_message: DEFAULT_TITLE_MESSAGE,
			options: buildFallbackTitleOptions(prompt, fallback.category),
		};
	}

	const resolvedTitle = title?.trim() || fallback.name;
	return {
		assistant_message: DEFAULT_DESCRIPTION_MESSAGE,
		options: normalizeOptions(undefined, [
			`Plan the core product, launch steps, and delivery milestones for ${resolvedTitle}.`,
			`Turn ${resolvedTitle} into clear epics, features, and early priorities.`,
			`Define the build strategy, user experience, and execution phases needed to ship ${resolvedTitle}.`,
		]),
		category_suggestions: [fallback.category, ...FALLBACK_CATEGORIES].filter(
			(category, index, all) =>
				category && all.findIndex((item) => item === category) === index,
		),
	};
}

/**
 * Client-side degradation when the intake request itself throws (offline, 5xx).
 * Deliberately NOT a mirror of the backend heuristics - a duplicate of that
 * regex here silently diverged from the server's copy, and this path cannot
 * synthesize idea-specific options anyway. A static clickable card plus the
 * build-anyway escape is the honest fallback; the backend stays the single
 * source of truth for the real decision.
 */
function buildOfflineObjectiveStep(
	prompt: string,
	round: number,
): SuggestedRoadmapIntakeStep {
	const normalizedPrompt = prompt.trim().replace(/\s+/g, " ");
	// Two failed rounds: stop asking and let the user proceed with what we have.
	if (round >= 2 && normalizedPrompt.length >= 12) {
		return {
			assistant_message:
				"I could not reach the assistant, so I will set the roadmap up with what you have given me.",
			options: [],
			objective_decision: "ready",
			refined_prompt: normalizedPrompt,
		};
	}

	return {
		assistant_message:
			"I could not reach the assistant just now. Pick whatever fits and we will carry on.",
		options: [],
		objective_decision: "clarify",
		refined_prompt: "",
		can_build_anyway: normalizedPrompt.length >= 12,
		questions: [
			{
				id: "audience",
				header: "Who for",
				question: "Who are the primary users?",
				multi_select: false,
				allow_custom: true,
				options: [
					{ label: "Everyday consumers", description: "The general public" },
					{ label: "Businesses and teams", description: "Sold to companies" },
					{
						label: "Internal staff",
						description: "Used inside your own organisation",
					},
				],
			},
			{
				id: "features",
				header: "First version",
				question: "Which capabilities must the first version include?",
				multi_select: true,
				allow_custom: true,
				options: [
					{ label: "Accounts and sign-in" },
					{ label: "Core dashboard and reporting" },
					{ label: "Payments or billing" },
					{ label: "Notifications and reminders" },
					{ label: "Search and discovery" },
				],
			},
		],
	};
}

function buildFallbackTitleOptions(
	prompt: string,
	category: string,
): SuggestedRoadmapIntakeOption[] {
	const keys = ["A", "B", "C"] as const;
	const cleanedIdea = toTitleCase(extractIdeaPhrase(prompt));
	const templates = fallbackTitleTemplates(category, cleanedIdea);
	return keys.map((key, index) => ({
		key,
		value: (templates[index] || cleanedIdea || DEFAULT_ROADMAP_NAME).slice(
			0,
			80,
		),
	}));
}

function fallbackTitleTemplates(
	category: string,
	cleanedIdea: string,
): string[] {
	if (category === "Health & Fitness") {
		return ["FitFlow Studio", "PulseCoach Platform", "Momentum Fitness Hub"];
	}
	if (category === "AI / ML") {
		return [
			"SmartFlow Assistant",
			"AI Launch Blueprint",
			"Automation Command Center",
		];
	}
	if (category === "Mobile App") {
		return [
			"Mobile Product Launch",
			"App Experience Blueprint",
			"Pocket Product Plan",
		];
	}
	if (category === "E-commerce") {
		return [
			"Commerce Growth Engine",
			"Storefront Launch System",
			"Checkout Experience Plan",
		];
	}
	if (category === "Marketing") {
		return [
			"Campaign Growth Plan",
			"Brand Momentum System",
			"Content Launch Blueprint",
		];
	}
	if (category === "SaaS") {
		return [
			"SaaS Launch System",
			"Customer Workflow Hub",
			"Subscription Growth Plan",
		];
	}

	const base = cleanedIdea || "Product";
	return [
		`${base} Blueprint`,
		`${base} Launch System`,
		`${base} Execution Plan`,
	];
}

function extractIdeaPhrase(prompt: string): string {
	return prompt
		.trim()
		.replace(/\s+/g, " ")
		.replace(/^(can you|could you|please)\s+/i, "")
		.replace(/^i\s+(want|need|would like)\s+to\s+/i, "")
		.replace(/^(build|create|make|develop|design)\s+/i, "")
		.replace(/^(a|an|the)\s+/i, "")
		.replace(/\b(roadmap|project plan)\b/gi, "")
		.trim();
}

function toTitleCase(value: string): string {
	return value
		.trim()
		.replace(/\s+/g, " ")
		.split(" ")
		.filter(Boolean)
		.map((word) =>
			word.length <= 3 && word === word.toUpperCase()
				? word
				: `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`,
		)
		.join(" ");
}

function normalizeCategoryValue(value: string): string {
	return value.trim().replace(/\s+/g, " ").slice(0, CATEGORY_LIMIT);
}

function uniqueCategories(values: string[]): string[] {
	const seen = new Set<string>();
	const categories: string[] = [];
	for (const value of values) {
		const category = normalizeCategoryValue(value);
		const key = category.toLowerCase();
		if (!category || seen.has(key)) continue;
		seen.add(key);
		categories.push(category);
	}
	return categories;
}

function categoriesToString(values: string[]): string {
	return uniqueCategories(values).join(", ");
}

function RoadmapBuilderMotionStyles() {
	return (
		<style>
			{`
				@keyframes roadmap-chat-in {
					from { opacity: 0; transform: translateY(14px) scale(0.985); filter: blur(2px); }
					to { opacity: 1; transform: translateY(0) scale(1); filter: blur(0); }
				}

				@keyframes roadmap-option-in {
					from { opacity: 0; transform: translateY(18px); }
					to { opacity: 1; transform: translateY(0); }
				}

				@keyframes roadmap-dot-bounce {
					0%, 80%, 100% { transform: translateY(0); opacity: 0.45; }
					40% { transform: translateY(-5px); opacity: 1; }
				}

				.roadmap-chat-message {
					animation: roadmap-chat-in 320ms cubic-bezier(.2,.8,.2,1) both;
				}

				.roadmap-chat-option {
					animation: roadmap-option-in 360ms cubic-bezier(.2,.8,.2,1) both;
				}

				.roadmap-typing-dot {
					animation: roadmap-dot-bounce 1.05s ease-in-out infinite;
				}

				@media (prefers-reduced-motion: reduce) {
					.roadmap-chat-message,
					.roadmap-chat-option,
					.roadmap-typing-dot {
						animation: none !important;
					}
				}
			`}
		</style>
	);
}

function TypingIndicator() {
	const nowLabel = formatMessageTime(Date.now());

	return (
		<div className="roadmap-chat-message space-y-3">
			<div className="flex items-center justify-between text-sm text-muted-foreground">
				<span>Assistant</span>
				<span>{nowLabel}</span>
			</div>
			<div className="inline-flex items-center gap-3 text-lg font-medium text-foreground">
				<span>Thinking</span>
				<span className="flex items-center gap-1.5">
					<span className="roadmap-typing-dot h-2 w-2 rounded-full bg-primary" />
					<span className="roadmap-typing-dot h-2 w-2 rounded-full bg-primary [animation-delay:120ms]" />
					<span className="roadmap-typing-dot h-2 w-2 rounded-full bg-primary [animation-delay:240ms]" />
				</span>
			</div>
		</div>
	);
}

export function RoadmapBuilder({
	projectId = "n",
	embedded = false,
	draftId,
}: RoadmapBuilderProps) {
	const navigate = useNavigate();
	const authenticatedUser = useUser();
	const isAuthLoading = useIsLoading();
	const fileInputRef = useRef<HTMLInputElement | null>(null);
	const loadedDraftIdRef = useRef<string | null>(null);
	const chatEndRef = useRef<HTMLDivElement | null>(null);

	const [step, setStep] = useState<IntakeStep>("prompt");
	const [prompt, setPrompt] = useState("");
	const [refinedPrompt, setRefinedPrompt] = useState("");
	const [clarificationAnswer, setClarificationAnswer] = useState("");

	/**
	 * Guided-intake conversation state.
	 *
	 * Held in a ref, NOT state, on purpose: `requestIntakeStep` is a useCallback
	 * whose identity feeds the draft-loading useEffect below. If turns/captured/
	 * round entered its dependency array, that effect would re-run on every turn
	 * and re-fire the intake. `loadedDraftIdRef` would mask it today, but that
	 * guard is one refactor away from being load-bearing and forgotten.
	 * Render-visible copies live in the state below.
	 */
	const intakeRef = useRef<{
		turns: RoadmapIntakeTurn[];
		captured: RoadmapIntakeCaptured;
		round: number;
	}>({ turns: [], captured: {}, round: 0 });
	/**
	 * `applyObjectiveResponse` has to kick off the title step, but is defined
	 * before `requestIntakeStep`. A ref breaks that cycle without putting either
	 * callback into the other's dependency array.
	 */
	const requestIntakeStepRef = useRef<
		| ((
				requestStep: "objective" | "title" | "description",
				overrides?: {
					prompt?: string;
					title?: string;
					description?: string;
					category?: string;
					forceReady?: boolean;
				},
		  ) => Promise<void>)
		| null
	>(null);
	const [capturedView, setCapturedView] = useState<RoadmapIntakeCaptured>({});
	const [intakeQuestions, setIntakeQuestions] = useState<
		SuggestedRoadmapIntakeQuestion[]
	>([]);
	const [canBuildAnyway, setCanBuildAnyway] = useState(false);
	const [showFreeText, setShowFreeText] = useState(false);
	const [title, setTitle] = useState("");
	const [description, setDescription] = useState("");
	const [categories, setCategories] = useState<string[]>([]);
	const [categoryInput, setCategoryInput] = useState("");
	const [titleOptions, setTitleOptions] = useState<
		SuggestedRoadmapIntakeOption[]
	>([]);
	const [descriptionOptions, setDescriptionOptions] = useState<
		SuggestedRoadmapIntakeOption[]
	>([]);
	const [categorySuggestions, setCategorySuggestions] =
		useState<string[]>(FALLBACK_CATEGORIES);
	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [customTitle, setCustomTitle] = useState("");
	const [customDescription, setCustomDescription] = useState("");
	const [selectedDescriptionKey, setSelectedDescriptionKey] = useState<
		string | null
	>(null);
	const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
	const [isSuggesting, setIsSuggesting] = useState(false);
	const [isLocalThinking, setIsLocalThinking] = useState(false);
	const [isUploadingThumbnail, setIsUploadingThumbnail] = useState(false);
	const [isCreating, setIsCreating] = useState(false);
	const [error, setError] = useState<string | null>(null);
	/** Incremented by Shuffle to step through the theme's photo pool. */
	const [stockOffset, setStockOffset] = useState(0);

	const timestampLabel = useMemo(() => {
		return `Today at ${new Intl.DateTimeFormat(undefined, {
			hour: "numeric",
			minute: "2-digit",
		}).format(new Date())}`;
	}, []);

	const generatedPreviewUrl = useMemo(() => {
		const resolvedTitle = title.trim() || DEFAULT_ROADMAP_NAME;
		const resolvedCategory =
			categoriesToString(categories) || DEFAULT_ROADMAP_CATEGORY;
		return generateRoadmapThumbnailDataUri(
			`${resolvedCategory}:${resolvedTitle}`,
			resolvedTitle,
		);
	}, [categories, title]);

	const selectedCategoryLabel = useMemo(
		() => categoriesToString(categories),
		[categories],
	);

	/**
	 * The curated cover photo. Purely local — the manifest is committed and the
	 * objects live on our CDN — so this is a synchronous memo with no loading
	 * state and no failure mode. An unseeded pool yields null, which falls back
	 * to the generated gradient.
	 */
	const stockTheme = useMemo(
		() =>
			resolveStockTheme(
				selectedCategoryLabel || DEFAULT_ROADMAP_CATEGORY,
				title,
			),
		[selectedCategoryLabel, title],
	);
	const stockPhotoUrl = useMemo(() => {
		if (!featureFlags.stockPhotos) return null;
		return pickStockPhotoUrl(
			stockTheme,
			title || DEFAULT_ROADMAP_NAME,
			stockOffset,
		);
	}, [stockOffset, stockTheme, title]);
	const canShuffleStockPhoto =
		Boolean(stockPhotoUrl) && stockPhotoPoolSize(stockTheme) > 1;

	// An explicit upload always wins, then the curated photo, then the generated
	// gradient. `stockPhotoUrl` is null whenever the flag is off, so disabling
	// the feature restores the original behaviour with no other path dangling.
	const previewUrl = thumbnailUrl || stockPhotoUrl || generatedPreviewUrl;
	const effectivePrompt = refinedPrompt.trim() || prompt.trim();
	const hasCapturedSlots = INTAKE_SLOT_CHIPS.some((chip) =>
		isSlotFilled(capturedView, chip.key),
	);
	/**
	 * The backend always returns at least one clickable question when it asks to
	 * clarify, so this is normally true. Kept as a guard so a malformed or
	 * question-less response degrades to the free-text box instead of a dead end.
	 */
	const showGuidedClarifier = intakeQuestions.length > 0;

	const appendMessage = useCallback(
		(role: ChatMessage["role"], content: string) => {
			setMessages((current) => [
				...current,
				{ id: createMessageId(), role, content, createdAt: Date.now() },
			]);
		},
		[],
	);

	const cancelIntake = useCallback(
		async (message?: string) => {
			if (message) appendMessage("assistant", message);
			setStep("canceled");
			setError(null);
			clearRoadmapIntakeDraft(draftId);
			await wait(900);
			await navigate({ to: "/" });
		},
		[appendMessage, draftId, navigate],
	);

	/**
	 * Applies an objective-step response. Shared by the network and offline
	 * paths so both agree on how a decision moves the flow.
	 */
	const applyObjectiveResponse = useCallback(
		async (response: SuggestedRoadmapIntakeStep, trimmedPrompt: string) => {
			const decision = response.objective_decision || "clarify";
			const assistantMessage = response.assistant_message;

			if (response.captured) {
				intakeRef.current.captured = response.captured;
				setCapturedView(response.captured);
			}
			setCanBuildAnyway(response.can_build_anyway === true);

			if (decision === "cancel") {
				await cancelIntake(assistantMessage);
				return;
			}

			if (assistantMessage) {
				appendMessage("assistant", assistantMessage);
				intakeRef.current.turns.push({
					role: "assistant",
					content: assistantMessage,
				});
			}

			if (decision === "clarify") {
				intakeRef.current.round = response.round ?? intakeRef.current.round + 1;
				setIntakeQuestions(response.questions ?? []);
				setShowFreeText(false);
				setStep("clarification");
				return;
			}

			const nextRefinedPrompt =
				response.refined_prompt?.trim() || trimmedPrompt;
			setRefinedPrompt(nextRefinedPrompt);
			setIntakeQuestions([]);
			window.setTimeout(() => {
				void requestIntakeStepRef.current?.("title", {
					prompt: nextRefinedPrompt,
				});
			}, 0);
		},
		[appendMessage, cancelIntake],
	);

	const requestIntakeStep = useCallback(
		async (
			requestStep: "objective" | "title" | "description",
			overrides: {
				prompt?: string;
				title?: string;
				description?: string;
				category?: string;
				forceReady?: boolean;
			} = {},
		) => {
			const resolvedPrompt = overrides.prompt ?? prompt;
			const resolvedTitle = overrides.title ?? title;
			const resolvedDescription = overrides.description ?? description;
			const resolvedCategory = overrides.category ?? selectedCategoryLabel;
			const trimmedPrompt = resolvedPrompt.trim();
			if (!trimmedPrompt) return;

			const { turns, captured, round } = intakeRef.current;

			setError(null);
			if (requestStep !== "objective") {
				setStep(requestStep);
			}
			setIsSuggesting(true);
			try {
				const response = await roadmapService.suggestIntakeStep({
					step: requestStep,
					prompt: trimmedPrompt,
					title: resolvedTitle,
					description: resolvedDescription,
					category: resolvedCategory,
					project_id: projectId !== "n" ? projectId : null,
					...(requestStep === "objective"
						? {
								turns,
								captured,
								round,
								...(overrides.forceReady ? { force_ready: true } : {}),
							}
						: {}),
				});

				if (requestStep === "objective") {
					await applyObjectiveResponse(response, trimmedPrompt);
					return;
				}

				if (requestStep === "title") {
					const fallback = buildFallbackIntakeStep("title", trimmedPrompt);
					setTitleOptions(
						normalizeOptions(
							response.options,
							fallback.options.map((o) => o.value),
						),
					);
					appendMessage(
						"assistant",
						response.assistant_message || fallback.assistant_message,
					);
					setStep("title");
					return;
				}

				const fallback = buildFallbackIntakeStep(
					"description",
					trimmedPrompt,
					resolvedTitle,
				);
				setDescriptionOptions(
					normalizeOptions(
						response.options,
						fallback.options.map((o) => o.value),
					),
				);
				const nextCategories = response.category_suggestions?.length
					? response.category_suggestions
					: fallback.category_suggestions || FALLBACK_CATEGORIES;
				const normalizedNextCategories = uniqueCategories(nextCategories);
				setCategorySuggestions(normalizedNextCategories);
				setCategories((current) =>
					current.length
						? current
						: normalizedNextCategories.slice(
								0,
								Math.min(3, normalizedNextCategories.length),
							),
				);
				appendMessage(
					"assistant",
					response.assistant_message || fallback.assistant_message,
				);
				setStep("description");
			} catch (suggestError) {
				console.error("Failed to suggest roadmap intake step:", suggestError);
				if (requestStep === "objective") {
					await applyObjectiveResponse(
						buildOfflineObjectiveStep(trimmedPrompt, round),
						trimmedPrompt,
					);
					return;
				}
				const fallback = buildFallbackIntakeStep(
					requestStep,
					trimmedPrompt,
					resolvedTitle,
				);
				if (requestStep === "title") {
					setTitleOptions(fallback.options);
					appendMessage("assistant", fallback.assistant_message);
					setStep("title");
				} else {
					setDescriptionOptions(fallback.options);
					const nextCategories =
						fallback.category_suggestions || FALLBACK_CATEGORIES;
					const normalizedNextCategories = uniqueCategories(nextCategories);
					setCategorySuggestions(normalizedNextCategories);
					setCategories((current) =>
						current.length
							? current
							: normalizedNextCategories.slice(
									0,
									Math.min(3, normalizedNextCategories.length),
								),
					);
					appendMessage("assistant", fallback.assistant_message);
					setStep("description");
				}
			} finally {
				setIsSuggesting(false);
			}
		},
		[
			appendMessage,
			applyObjectiveResponse,
			description,
			projectId,
			prompt,
			selectedCategoryLabel,
			title,
		],
	);

	requestIntakeStepRef.current = requestIntakeStep;

	useEffect(() => {
		if (!draftId || loadedDraftIdRef.current === draftId) return;
		loadedDraftIdRef.current = draftId;

		const draft = readRoadmapIntakeDraft(draftId);
		if (!draft?.prompt.trim()) return;

		const nextPrompt = draft.prompt.trim();
		setPrompt(nextPrompt);
		appendMessage("user", nextPrompt);
		void requestIntakeStep("objective", { prompt: nextPrompt });
	}, [appendMessage, draftId, requestIntakeStep]);

	useEffect(() => {
		chatEndRef.current?.scrollIntoView({
			behavior: "smooth",
			block: "end",
		});
	}, [isCreating, isLocalThinking, isSuggesting, messages.length, step]);

	const handlePromptSubmit = () => {
		const trimmedPrompt = prompt.trim();
		if (!trimmedPrompt || isSuggesting) return;
		appendMessage("user", trimmedPrompt);
		void requestIntakeStep("objective", { prompt: trimmedPrompt });
	};

	const handleClarificationSubmit = () => {
		const trimmedAnswer = clarificationAnswer.trim();
		if (!trimmedAnswer || isSuggesting || isLocalThinking) return;
		setClarificationAnswer("");
		appendMessage("user", trimmedAnswer);
		// Keep the original prompt intact and carry the answer as its own turn,
		// so the model can tell a question from its answer. The old path mashed
		// both into one "prompt\nAdditional detail:" string and lost that.
		intakeRef.current.turns.push({ role: "user", content: trimmedAnswer });
		setShowFreeText(false);
		void requestIntakeStep("objective");
	};

	const handleIntakeAnswers = (answers: AgentClarifierAnswerEntry[]) => {
		if (isSuggesting || isLocalThinking) return;
		appendMessage("user", buildClarifierDisplayLabel(answers));
		intakeRef.current.turns.push({
			role: "user",
			content: buildTurnFromAnswers(answers),
		});
		setIntakeQuestions([]);
		void requestIntakeStep("objective");
	};

	const handleBuildAnyway = () => {
		if (isSuggesting || isLocalThinking) return;
		appendMessage("user", "Build it with what you have.");
		setIntakeQuestions([]);
		void requestIntakeStep("objective", { forceReady: true });
	};

	const handleTitleAnswer = (value: string, label?: string) => {
		const trimmedTitle = value.trim();
		if (!trimmedTitle || isSuggesting) return;
		setTitle(trimmedTitle);
		setCustomTitle("");
		appendMessage("user", label ? `${label}: ${trimmedTitle}` : trimmedTitle);
		void requestIntakeStep("description", {
			prompt: effectivePrompt,
			title: trimmedTitle,
		});
	};

	const handleDescriptionCardSelect = (
		option: SuggestedRoadmapIntakeOption,
	) => {
		setSelectedDescriptionKey(option.key);
		setCustomDescription(option.value);
	};

	const toggleCategory = (value: string) => {
		const category = normalizeCategoryValue(value);
		if (!category) return;
		setCategories((current) => {
			const exists = current.some(
				(item) => item.toLowerCase() === category.toLowerCase(),
			);
			if (exists) {
				const next = current.filter(
					(item) => item.toLowerCase() !== category.toLowerCase(),
				);
				return next.length ? next : current;
			}
			if (current.length >= MAX_SELECTED_CATEGORIES) return current;
			return uniqueCategories([...current, category]);
		});
	};

	const addCustomCategory = () => {
		const category = normalizeCategoryValue(categoryInput);
		if (!category) return;
		setCategories((current) =>
			uniqueCategories([...current, category]).slice(
				0,
				MAX_SELECTED_CATEGORIES,
			),
		);
		setCategorySuggestions((current) =>
			uniqueCategories([category, ...current]),
		);
		setCategoryInput("");
	};

	const removeCategory = (value: string) => {
		setCategories((current) =>
			current.filter((item) => item.toLowerCase() !== value.toLowerCase()),
		);
	};

	const handleDescriptionContinue = async () => {
		const trimmedDescription = customDescription.trim();
		if (!trimmedDescription || isLocalThinking) return;
		setDescription(trimmedDescription);
		const label = selectedDescriptionKey
			? `${selectedDescriptionKey}: ${trimmedDescription}`
			: trimmedDescription;
		const categoryLabel = selectedCategoryLabel || DEFAULT_ROADMAP_CATEGORY;
		appendMessage("user", `${label}\nCategories: ${categoryLabel}`);
		setIsLocalThinking(true);
		await wait(650);
		appendMessage(
			"assistant",
			stockPhotoUrl ? THUMBNAIL_MESSAGE : THUMBNAIL_MESSAGE_FALLBACK,
		);
		setStep("thumbnail");
		setIsLocalThinking(false);
	};

	const handleThumbnailUpload = async (file: File) => {
		setError(null);
		setIsUploadingThumbnail(true);
		try {
			if (!authenticatedUser) {
				const guestId = await getOrCreateGuestUser();
				if (!guestId) throw new Error("Failed to initialize guest session");
			}
			const url = await uploadService.upload("roadmap_previews", file);
			setThumbnailUrl(url);
			appendMessage("user", "Uploaded a custom thumbnail.");
			setIsLocalThinking(true);
			await wait(550);
			appendMessage(
				"assistant",
				"Nice, I will use that thumbnail. When you are ready, I can create the roadmap.",
			);
		} catch (uploadError) {
			console.error("Failed to upload roadmap thumbnail:", uploadError);
			setError("Could not upload that thumbnail. You can try again or skip.");
		} finally {
			setIsLocalThinking(false);
			setIsUploadingThumbnail(false);
		}
	};

	const handleCreate = async (mode: "generated" | "uploaded" | "stock") => {
		if (isCreating || isAuthLoading || !effectivePrompt || !title.trim())
			return;

		setError(null);
		setIsCreating(true);
		appendMessage(
			"user",
			mode === "uploaded"
				? "Use my uploaded thumbnail."
				: mode === "stock"
					? "Use the suggested cover image."
					: "Skip thumbnail upload and use the generated thumbnail.",
		);
		setIsLocalThinking(true);

		try {
			const roadmap = await createRoadmapFromMetadata({
				metadata: {
					name: title,
					description,
					category: selectedCategoryLabel || DEFAULT_ROADMAP_CATEGORY,
				},
				prompt: effectivePrompt,
				projectId,
				isAuthenticated: Boolean(authenticatedUser),
				// Already a cdn.proyekto.tech URL (curated photo) or a data URI
				// (generated gradient) — nothing to upload or re-host.
				previewUrl,
				openMetadataModal: false,
				// Carries audience/platform/v1 scope through to the agent turn that
				// actually generates the epics - otherwise intake learns it and
				// throws it away.
				intake: intakeRef.current.captured,
			});

			clearRoadmapIntakeDraft(draftId);

			await navigate({
				to: "/project/$projectId/roadmap/$roadmapId",
				params: { projectId, roadmapId: roadmap.id },
			});
		} catch (createError) {
			console.error("Failed to create roadmap:", createError);
			setError("We could not create the roadmap. Please try again.");
			setIsLocalThinking(false);
			setIsCreating(false);
		}
	};

	const shellClass = embedded
		? "h-full min-h-0 overflow-y-auto bg-background text-foreground"
		: "min-h-screen overflow-y-auto bg-background text-foreground";

	const isThinking = isSuggesting || isLocalThinking || isCreating;
	const shouldShowPromptInput =
		step === "prompt" && !isThinking && messages.length === 0;
	const canSubmitPrompt = Boolean(prompt.trim()) && !isThinking;
	const canSubmitClarification =
		Boolean(clarificationAnswer.trim()) && !isThinking;
	const canSubmitTitle = Boolean(customTitle.trim()) && !isThinking;
	const canContinueDescription =
		Boolean(customDescription.trim()) &&
		Boolean(selectedCategoryLabel) &&
		!isThinking;
	const canCreate =
		step === "thumbnail" &&
		Boolean(title.trim()) &&
		Boolean(effectivePrompt) &&
		!isAuthLoading &&
		!isCreating &&
		!isUploadingThumbnail &&
		!isLocalThinking;

	const content = (
		<div className={shellClass}>
			<RoadmapBuilderMotionStyles />
			<div className="mx-auto flex min-h-full w-full max-w-5xl flex-col px-5 py-8 pb-24 sm:px-8 lg:px-10">
				<button
					type="button"
					onClick={() => history.back()}
					className="mb-6 inline-flex w-fit items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm font-semibold text-muted-foreground shadow-sm transition-colors hover:border-primary/40 hover:bg-muted hover:text-foreground"
				>
					<ArrowLeft className="h-4 w-4" />
					Back
				</button>

				<div className="mx-auto w-full max-w-4xl space-y-6">
					<p className="text-center text-sm font-medium text-muted-foreground">
						{timestampLabel}
					</p>

					{messages.map((message, index) => (
						<div
							key={message.id}
							className={
								message.role === "user"
									? "roadmap-chat-message flex justify-end"
									: "roadmap-chat-message"
							}
							style={{ animationDelay: `${Math.min(index, 4) * 45}ms` }}
						>
							{message.role === "user" ? (
								<div className="max-w-[min(720px,88%)] whitespace-pre-line rounded-[1.75rem] bg-primary px-5 py-4 text-primary-foreground shadow-lg">
									<div className="mb-2 flex items-center justify-between gap-4 text-sm">
										<span className="font-semibold text-primary-foreground/95">
											You
										</span>
										<span className="text-primary-foreground/75">
											{formatMessageTime(message.createdAt)}
										</span>
									</div>
									<p className="text-base font-medium leading-7 sm:text-lg">
										{message.content}
									</p>
								</div>
							) : (
								<div className="space-y-3">
									<div className="flex items-center justify-between text-sm text-muted-foreground">
										<span>Assistant</span>
										<span>{formatMessageTime(message.createdAt)}</span>
									</div>
									<p className="max-w-4xl whitespace-pre-line text-lg font-medium leading-8 text-foreground">
										{message.content}
									</p>
								</div>
							)}
						</div>
					))}

					{isThinking && <TypingIndicator />}

					{/*
					 * Slot progress. Unlike the old "Objective locked" banner this
					 * stays visible DURING clarification - which is exactly when the
					 * user needs to see what has landed and what is still missing.
					 */}
					{hasCapturedSlots && step !== "prompt" && step !== "canceled" && (
						<div
							data-testid="intake-slot-strip"
							className="roadmap-chat-message flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card px-4 py-3"
						>
							<span className="text-xs font-semibold text-muted-foreground">
								So far
							</span>
							{INTAKE_SLOT_CHIPS.map((chip) => {
								const filled = isSlotFilled(capturedView, chip.key);
								const value = capturedView[chip.key];
								const detail = Array.isArray(value)
									? value.join(", ")
									: (value ?? "");
								return (
									<span
										key={chip.key}
										data-testid="intake-slot-chip"
										data-slot={chip.key}
										data-filled={filled}
										title={detail || undefined}
										className={
											filled
												? "inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1.5 text-xs font-bold text-primary"
												: "inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1.5 text-xs font-semibold text-muted-foreground"
										}
									>
										{filled ? <Check className="h-3 w-3" /> : null}
										{chip.label}
									</span>
								);
							})}
						</div>
					)}

					{shouldShowPromptInput && (
						<section className="roadmap-chat-message rounded-[1.75rem] border border-border bg-card p-5 text-card-foreground shadow-sm">
							<label
								htmlFor="roadmap-initial-prompt"
								className="block text-sm font-bold text-foreground"
							>
								What should this roadmap help you build?
							</label>
							<textarea
								id="roadmap-initial-prompt"
								value={prompt}
								maxLength={MAX_PROMPT_LENGTH}
								rows={4}
								onChange={(event) => setPrompt(event.target.value)}
								placeholder='Example: "Create a 3D heavy website for farmers"'
								className="mt-3 min-h-28 w-full resize-y rounded-2xl border border-border bg-muted/40 px-4 py-3 text-sm leading-6 text-foreground outline-none transition placeholder:text-muted-foreground focus:border-primary focus:bg-background focus:ring-4 focus:ring-primary/15"
							/>
							<div className="mt-4 flex justify-end">
								<button
									type="button"
									onClick={handlePromptSubmit}
									disabled={!canSubmitPrompt}
									className="inline-flex items-center justify-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
								>
									<Send className="h-4 w-4" />
									Send to AI
								</button>
							</div>
						</section>
					)}

					{/* Guided path: clickable questions instead of a blank textarea. */}
					{step === "clarification" &&
						!isThinking &&
						showGuidedClarifier &&
						!showFreeText && (
							<section className="roadmap-chat-message">
								<RoadmapAiClarifierCard
									card={{
										question_id: `intake-r${intakeRef.current.round}`,
										questions: intakeQuestions,
									}}
									badgeLabel="Project intake"
									onSubmit={handleIntakeAnswers}
									disabled={isThinking}
								/>
								<div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
									<div className="flex flex-wrap gap-2">
										<button
											type="button"
											onClick={() =>
												void cancelIntake(
													"No problem, I will cancel this roadmap setup for now.",
												)
											}
											className="inline-flex items-center justify-center rounded-full border border-border bg-card px-4 py-2 text-xs font-bold text-muted-foreground transition hover:border-primary/40 hover:bg-muted hover:text-foreground"
										>
											Cancel and go home
										</button>
										<button
											type="button"
											data-testid="intake-free-text-toggle"
											onClick={() => setShowFreeText(true)}
											className="inline-flex items-center justify-center rounded-full border border-border bg-card px-4 py-2 text-xs font-bold text-muted-foreground transition hover:border-primary/40 hover:bg-muted hover:text-foreground"
										>
											Type an answer instead
										</button>
									</div>
									{canBuildAnyway && (
										<button
											type="button"
											data-testid="intake-build-anyway"
											onClick={handleBuildAnyway}
											className="inline-flex items-center justify-center rounded-full border border-primary/40 px-4 py-2 text-xs font-bold text-primary transition hover:bg-primary/10"
										>
											Build it anyway
										</button>
									)}
								</div>
							</section>
						)}

					{step === "clarification" &&
						!isThinking &&
						(!showGuidedClarifier || showFreeText) && (
							<section className="roadmap-chat-message rounded-[1.75rem] border border-border bg-card p-5 text-card-foreground shadow-sm">
								<label
									htmlFor="roadmap-objective-clarification"
									className="block text-sm font-bold text-foreground"
								>
									Add the missing project details
								</label>
								<p className="mt-1 text-sm leading-6 text-muted-foreground">
									Tell me what you are building, who it is for, and what the
									first version should include.
								</p>
								<textarea
									id="roadmap-objective-clarification"
									value={clarificationAnswer}
									maxLength={MAX_PROMPT_LENGTH}
									rows={4}
									onChange={(event) =>
										setClarificationAnswer(event.target.value)
									}
									onKeyDown={(event) => {
										if (
											event.key === "Enter" &&
											!event.shiftKey &&
											!event.nativeEvent.isComposing
										) {
											event.preventDefault();
											handleClarificationSubmit();
										}
									}}
									placeholder='Example: "A fitness web app for older adults with onboarding, workout plans, progress tracking, and reminders."'
									className="mt-3 min-h-28 w-full resize-y rounded-2xl border border-border bg-muted/40 px-4 py-3 text-sm leading-6 text-foreground outline-none transition placeholder:text-muted-foreground focus:border-primary focus:bg-background focus:ring-4 focus:ring-primary/15"
								/>
								<div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
									<button
										type="button"
										onClick={() =>
											void cancelIntake(
												"No problem, I will cancel this roadmap setup for now.",
											)
										}
										className="inline-flex items-center justify-center rounded-full border border-border bg-card px-5 py-2.5 text-sm font-bold text-muted-foreground transition hover:border-primary/40 hover:bg-muted hover:text-foreground"
									>
										Cancel and go home
									</button>
									<div className="flex flex-wrap items-center gap-2">
										{showFreeText && intakeQuestions.length > 0 && (
											<button
												type="button"
												onClick={() => setShowFreeText(false)}
												className="inline-flex items-center justify-center rounded-full border border-border bg-card px-4 py-2 text-xs font-bold text-muted-foreground transition hover:border-primary/40 hover:bg-muted hover:text-foreground"
											>
												Back to options
											</button>
										)}
										<button
											type="button"
											onClick={handleClarificationSubmit}
											disabled={!canSubmitClarification}
											className="inline-flex items-center justify-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
										>
											<Send className="h-4 w-4" />
											Continue
										</button>
									</div>
								</div>
							</section>
						)}

					{step === "canceled" && (
						<section className="roadmap-chat-message rounded-[1.75rem] border border-border bg-card p-5 text-sm leading-6 text-muted-foreground shadow-sm">
							Taking you back to the landing page.
						</section>
					)}

					{step === "title" && !isThinking && (
						<section className="space-y-4">
							<div className="grid gap-3">
								{titleOptions.map((option, index) => (
									<button
										key={option.key}
										type="button"
										onClick={() => handleTitleAnswer(option.value, option.key)}
										className="roadmap-chat-option group flex items-start gap-4 rounded-2xl border border-border bg-card p-4 text-left text-card-foreground shadow-sm transition hover:-translate-y-0.5 hover:border-primary/50 hover:bg-muted/40 hover:shadow-md"
										style={{ animationDelay: `${index * 80}ms` }}
									>
										<span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-black text-primary group-hover:bg-primary/15">
											{option.key}
										</span>
										<span className="text-base font-bold text-foreground">
											{option.value}
										</span>
									</button>
								))}
							</div>
							<div
								className="roadmap-chat-option rounded-2xl border border-border bg-card p-4 text-card-foreground shadow-sm"
								style={{ animationDelay: `${titleOptions.length * 80}ms` }}
							>
								<label
									htmlFor="custom-roadmap-title"
									className="block text-sm font-bold text-foreground"
								>
									Or name it yourself
								</label>
								<div className="mt-2 flex flex-col gap-3 sm:flex-row">
									<input
										id="custom-roadmap-title"
										type="text"
										value={customTitle}
										maxLength={TITLE_LIMIT}
										onChange={(event) => setCustomTitle(event.target.value)}
										placeholder="Type a custom roadmap name"
										className="min-w-0 flex-1 rounded-2xl border border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-primary focus:ring-4 focus:ring-primary/15"
									/>
									<button
										type="button"
										onClick={() => handleTitleAnswer(customTitle)}
										disabled={!canSubmitTitle}
										className="inline-flex items-center justify-center rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
									>
										Use this name
									</button>
								</div>
							</div>
						</section>
					)}

					{step === "description" && !isThinking && (
						<section className="space-y-4">
							<div className="grid gap-3">
								{descriptionOptions.map((option, index) => (
									<button
										key={option.key}
										type="button"
										onClick={() => handleDescriptionCardSelect(option)}
										className={`roadmap-chat-option group flex items-start gap-4 rounded-2xl border bg-card p-4 text-left text-card-foreground shadow-sm transition hover:-translate-y-0.5 hover:border-primary/50 hover:bg-muted/40 hover:shadow-md ${
											selectedDescriptionKey === option.key
												? "border-primary ring-4 ring-primary/15"
												: "border-border"
										}`}
										style={{ animationDelay: `${index * 80}ms` }}
									>
										<span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-black text-primary group-hover:bg-primary/15">
											{option.key}
										</span>
										<span className="text-base font-medium leading-7 text-foreground">
											{option.value}
										</span>
									</button>
								))}
							</div>

							<div
								className="roadmap-chat-option rounded-2xl border border-border bg-card p-4 text-card-foreground shadow-sm"
								style={{
									animationDelay: `${descriptionOptions.length * 80}ms`,
								}}
							>
								<label
									htmlFor="custom-roadmap-description"
									className="block text-sm font-bold text-foreground"
								>
									Goal / description
								</label>
								<textarea
									id="custom-roadmap-description"
									value={customDescription}
									maxLength={DESCRIPTION_LIMIT}
									rows={4}
									onChange={(event) => {
										setSelectedDescriptionKey(null);
										setCustomDescription(event.target.value);
									}}
									placeholder="Type a custom roadmap goal"
									className="mt-2 min-h-28 w-full resize-y rounded-2xl border border-border bg-background px-4 py-3 text-sm leading-6 text-foreground outline-none transition placeholder:text-muted-foreground focus:border-primary focus:ring-4 focus:ring-primary/15"
								/>

								<label
									htmlFor="roadmap-category"
									className="mt-4 block text-sm font-bold text-foreground"
								>
									Categories
								</label>
								<div className="mt-2 flex flex-wrap gap-2 rounded-2xl border border-border bg-background px-3 py-3">
									{categories.map((selectedCategory) => (
										<span
											key={selectedCategory}
											className="inline-flex items-center gap-2 rounded-full bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground"
										>
											{selectedCategory}
											<button
												type="button"
												onClick={() => removeCategory(selectedCategory)}
												className="rounded-full text-primary-foreground/70 transition hover:text-primary-foreground"
												aria-label={`Remove ${selectedCategory}`}
											>
												x
											</button>
										</span>
									))}
									<input
										id="roadmap-category"
										type="text"
										value={categoryInput}
										maxLength={CATEGORY_LIMIT}
										onChange={(event) => setCategoryInput(event.target.value)}
										onKeyDown={(event) => {
											if (event.key === "Enter" || event.key === ",") {
												event.preventDefault();
												addCustomCategory();
											}
										}}
										placeholder={
											categories.length
												? "Add another category"
												: "e.g. Web Development"
										}
										className="min-w-44 flex-1 border-0 bg-transparent px-1 py-1 text-sm text-foreground outline-none placeholder:text-muted-foreground"
									/>
									<button
										type="button"
										onClick={addCustomCategory}
										disabled={!categoryInput.trim()}
										className="rounded-full bg-muted px-3 py-1.5 text-xs font-bold text-foreground transition hover:bg-muted/70 disabled:cursor-not-allowed disabled:opacity-40"
									>
										Add
									</button>
								</div>
								<p className="mt-2 text-xs font-medium text-muted-foreground">
									Choose up to {MAX_SELECTED_CATEGORIES} tags so the roadmap has
									more context than a single category.
								</p>
								<div className="mt-3 flex flex-wrap gap-2">
									{categorySuggestions.map((suggestion) => (
										<button
											key={suggestion}
											type="button"
											onClick={() => toggleCategory(suggestion)}
											className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
												categories.some(
													(category) =>
														category.toLowerCase() === suggestion.toLowerCase(),
												)
													? "border-primary bg-primary text-primary-foreground"
													: "border-primary/30 bg-primary/10 text-primary hover:bg-primary/15"
											}`}
										>
											{suggestion}
										</button>
									))}
								</div>

								<div className="mt-4 flex justify-end">
									<button
										type="button"
										onClick={() => void handleDescriptionContinue()}
										disabled={!canContinueDescription}
										className="inline-flex items-center justify-center rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
									>
										Continue
									</button>
								</div>
							</div>
						</section>
					)}

					{step === "thumbnail" && !isSuggesting && (
						<section className="roadmap-chat-message grid gap-5 rounded-[2rem] border border-border bg-card p-5 text-card-foreground shadow-xl sm:p-6 lg:grid-cols-[minmax(0,1fr)_320px]">
							<div>
								<p className="text-sm font-bold uppercase tracking-[0.18em] text-muted-foreground">
									Final metadata
								</p>
								<h1 className="mt-3 text-3xl font-black tracking-tight text-foreground">
									{title}
								</h1>
								<p className="mt-3 text-base leading-7 text-muted-foreground">
									{description}
								</p>
								<p className="mt-4 inline-flex rounded-full border border-primary/30 bg-primary/10 px-3 py-1.5 text-sm font-bold text-primary">
									{selectedCategoryLabel || DEFAULT_ROADMAP_CATEGORY}
								</p>

								<div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
									<button
										type="button"
										onClick={() => fileInputRef.current?.click()}
										disabled={isUploadingThumbnail || isCreating}
										className="inline-flex items-center justify-center gap-2 rounded-full border border-border bg-card px-5 py-2.5 text-sm font-bold text-foreground transition hover:border-primary/50 hover:bg-muted hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
									>
										{isUploadingThumbnail ? (
											<Loader2 className="h-4 w-4 animate-spin" />
										) : (
											<ImagePlus className="h-4 w-4" />
										)}
										{isUploadingThumbnail ? "Uploading..." : "Upload thumbnail"}
									</button>
									{/* Only useful while the curated photo is what will be used. */}
									{canShuffleStockPhoto && !thumbnailUrl && (
										<button
											type="button"
											onClick={() => setStockOffset((current) => current + 1)}
											disabled={isUploadingThumbnail || isCreating}
											className="inline-flex items-center justify-center gap-2 rounded-full border border-border bg-card px-5 py-2.5 text-sm font-bold text-foreground transition hover:border-primary/50 hover:bg-muted hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
										>
											<RefreshCw className="h-4 w-4" />
											Shuffle image
										</button>
									)}
									<button
										type="button"
										onClick={() =>
											void handleCreate(
												thumbnailUrl
													? "uploaded"
													: stockPhotoUrl
														? "stock"
														: "generated",
											)
										}
										disabled={!canCreate}
										className="inline-flex items-center justify-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-black text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
									>
										{isCreating && <Loader2 className="h-4 w-4 animate-spin" />}
										{thumbnailUrl
											? "Use uploaded thumbnail"
											: stockPhotoUrl
												? "Use this image and create"
												: "Skip and create roadmap"}
									</button>
								</div>

								<input
									ref={fileInputRef}
									type="file"
									accept="image/jpeg,image/png,image/webp"
									className="hidden"
									onChange={(event) => {
										const file = event.target.files?.[0];
										if (file) void handleThumbnailUpload(file);
									}}
								/>

								{error && (
									<p
										role="alert"
										className="mt-4 text-sm font-bold text-red-600 dark:text-red-400"
									>
										{error}
									</p>
								)}
							</div>

							<aside>
								<p className="mb-3 text-xs font-black uppercase tracking-[0.18em] text-muted-foreground">
									Thumbnail preview
								</p>
								<div className="overflow-hidden rounded-3xl border border-border bg-background shadow-sm">
									<img
										src={previewUrl}
										alt="Roadmap thumbnail preview"
										className="h-44 w-full object-cover"
									/>
									<div className="p-4">
										<div className="flex items-center gap-2 text-sm font-bold text-emerald-700 dark:text-emerald-300">
											<CheckCircle2 className="h-4 w-4" />
											{thumbnailUrl
												? "Uploaded thumbnail"
												: stockPhotoUrl
													? "Cover image"
													: "Generated thumbnail"}
										</div>
									</div>
								</div>
							</aside>
						</section>
					)}
					<div ref={chatEndRef} />
				</div>
			</div>
		</div>
	);

	return (
		<div className={embedded ? "h-full min-h-0" : "min-h-screen pt-16"}>
			{!embedded && <Header />}
			{content}
		</div>
	);
}
