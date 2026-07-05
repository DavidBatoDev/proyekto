import { useNavigate } from "@tanstack/react-router";
import {
	ArrowLeft,
	CheckCircle2,
	ImagePlus,
	Loader2,
	Send,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Header from "@/components/layout/Header";
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
	roadmapService,
	type SuggestedRoadmapIntakeOption,
	type SuggestedRoadmapIntakeStep,
} from "@/services/roadmap.service";
import { uploadService } from "@/services/upload.service";
import { useIsLoading, useUser } from "@/stores/authStore";

type RoadmapBuilderProps = {
	projectId?: string;
	embedded?: boolean;
	draftId?: string;
};

type IntakeStep = "prompt" | "title" | "description" | "thumbnail";

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

function fallbackTitleTemplates(category: string, cleanedIdea: string): string[] {
	if (category === "Health & Fitness") {
		return ["FitFlow Studio", "PulseCoach Platform", "Momentum Fitness Hub"];
	}
	if (category === "AI / ML") {
		return ["SmartFlow Assistant", "AI Launch Blueprint", "Automation Command Center"];
	}
	if (category === "Mobile App") {
		return ["Mobile Product Launch", "App Experience Blueprint", "Pocket Product Plan"];
	}
	if (category === "E-commerce") {
		return ["Commerce Growth Engine", "Storefront Launch System", "Checkout Experience Plan"];
	}
	if (category === "Marketing") {
		return ["Campaign Growth Plan", "Brand Momentum System", "Content Launch Blueprint"];
	}
	if (category === "SaaS") {
		return ["SaaS Launch System", "Customer Workflow Hub", "Subscription Growth Plan"];
	}

	const base = cleanedIdea || "Product";
	return [`${base} Blueprint`, `${base} Launch System`, `${base} Execution Plan`];
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
			<div className="flex items-center justify-between text-sm text-slate-500">
				<span>Assistant</span>
				<span>{nowLabel}</span>
			</div>
			<div className="inline-flex items-center gap-3 text-lg font-medium text-slate-800">
				<span>Thinking</span>
				<span className="flex items-center gap-1.5">
					<span className="roadmap-typing-dot h-2 w-2 rounded-full bg-blue-500" />
					<span className="roadmap-typing-dot h-2 w-2 rounded-full bg-blue-500 [animation-delay:120ms]" />
					<span className="roadmap-typing-dot h-2 w-2 rounded-full bg-blue-500 [animation-delay:240ms]" />
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
	const [title, setTitle] = useState("");
	const [description, setDescription] = useState("");
	const [categories, setCategories] = useState<string[]>([]);
	const [categoryInput, setCategoryInput] = useState("");
	const [titleOptions, setTitleOptions] = useState<SuggestedRoadmapIntakeOption[]>(
		[],
	);
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

	const previewUrl = thumbnailUrl || generatedPreviewUrl;
	const selectedCategoryLabel = useMemo(
		() => categoriesToString(categories),
		[categories],
	);

	const appendMessage = useCallback((role: ChatMessage["role"], content: string) => {
		setMessages((current) => [
			...current,
			{ id: createMessageId(), role, content, createdAt: Date.now() },
		]);
	}, []);

	const requestIntakeStep = useCallback(
		async (
			requestStep: "title" | "description",
			overrides: {
				prompt?: string;
				title?: string;
				description?: string;
				category?: string;
			} = {},
		) => {
			const resolvedPrompt = overrides.prompt ?? prompt;
			const resolvedTitle = overrides.title ?? title;
			const resolvedDescription = overrides.description ?? description;
			const resolvedCategory = overrides.category ?? selectedCategoryLabel;
			const trimmedPrompt = resolvedPrompt.trim();
			if (!trimmedPrompt) return;

			setError(null);
			setStep(requestStep);
			setIsSuggesting(true);
			try {
				const response = await roadmapService.suggestIntakeStep({
					step: requestStep,
					prompt: trimmedPrompt,
					title: resolvedTitle,
					description: resolvedDescription,
					category: resolvedCategory,
					project_id: projectId !== "n" ? projectId : null,
				});

				if (requestStep === "title") {
					const fallback = buildFallbackIntakeStep("title", trimmedPrompt);
					setTitleOptions(
						normalizeOptions(response.options, fallback.options.map((o) => o.value)),
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
					normalizeOptions(response.options, fallback.options.map((o) => o.value)),
				);
				const nextCategories =
					response.category_suggestions?.length
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
		[appendMessage, description, projectId, prompt, selectedCategoryLabel, title],
	);

	useEffect(() => {
		if (!draftId || loadedDraftIdRef.current === draftId) return;
		loadedDraftIdRef.current = draftId;

		const draft = readRoadmapIntakeDraft(draftId);
		if (!draft?.prompt.trim()) return;

		const nextPrompt = draft.prompt.trim();
		setPrompt(nextPrompt);
		appendMessage("user", nextPrompt);
		void requestIntakeStep("title", { prompt: nextPrompt });
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
		void requestIntakeStep("title", { prompt: trimmedPrompt });
	};

	const handleTitleAnswer = (value: string, label?: string) => {
		const trimmedTitle = value.trim();
		if (!trimmedTitle || isSuggesting) return;
		setTitle(trimmedTitle);
		setCustomTitle("");
		appendMessage("user", label ? `${label}: ${trimmedTitle}` : trimmedTitle);
		void requestIntakeStep("description", {
			prompt,
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
			uniqueCategories([...current, category]).slice(0, MAX_SELECTED_CATEGORIES),
		);
		setCategorySuggestions((current) => uniqueCategories([category, ...current]));
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
		appendMessage(
			"user",
			`${label}\nCategories: ${categoryLabel}`,
		);
		setIsLocalThinking(true);
		await wait(650);
		appendMessage("assistant", THUMBNAIL_MESSAGE);
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

	const handleCreate = async (mode: "generated" | "uploaded") => {
		if (isCreating || isAuthLoading || !prompt.trim() || !title.trim()) return;

		setError(null);
		setIsCreating(true);
		appendMessage(
			"user",
			mode === "uploaded"
				? "Use my uploaded thumbnail."
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
				prompt,
				projectId,
				isAuthenticated: Boolean(authenticatedUser),
				previewUrl,
				openMetadataModal: false,
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
		? "h-full min-h-0 overflow-y-auto bg-[#f7f7f8]"
		: "min-h-screen overflow-y-auto bg-[#f7f7f8]";

	const isThinking = isSuggesting || isLocalThinking || isCreating;
	const canSubmitPrompt = Boolean(prompt.trim()) && !isThinking;
	const canSubmitTitle = Boolean(customTitle.trim()) && !isThinking;
	const canContinueDescription =
		Boolean(customDescription.trim()) &&
		Boolean(selectedCategoryLabel) &&
		!isThinking;
	const canCreate =
		step === "thumbnail" &&
		Boolean(title.trim()) &&
		Boolean(prompt.trim()) &&
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
					className="mb-6 inline-flex w-fit items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 shadow-sm transition-colors hover:text-slate-950"
				>
					<ArrowLeft className="h-4 w-4" />
					Back
				</button>

				<div className="mx-auto w-full max-w-4xl space-y-6">
					<p className="text-center text-sm font-medium text-slate-500">
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
								<div className="w-full max-w-4xl whitespace-pre-line rounded-[1.45rem] bg-gradient-to-br from-blue-600 to-indigo-700 px-6 py-5 text-white shadow-[0_18px_40px_rgba(37,99,235,0.22)]">
									<div className="mb-3 flex items-center justify-between gap-4 text-sm">
										<span className="font-semibold text-white/95">You</span>
										<span className="text-white/70">
											{formatMessageTime(message.createdAt)}
										</span>
									</div>
									<p className="text-lg font-medium leading-8">
										{message.content}
									</p>
								</div>
							) : (
								<div className="space-y-3">
									<div className="flex items-center justify-between text-sm text-slate-500">
										<span>Assistant</span>
										<span>{formatMessageTime(message.createdAt)}</span>
									</div>
									<p className="max-w-4xl whitespace-pre-line text-lg font-medium leading-8 text-slate-900">
										{message.content}
									</p>
								</div>
							)}
						</div>
					))}

					{isThinking && <TypingIndicator />}

					{step === "prompt" && (
						<section className="roadmap-chat-message rounded-[1.75rem] border border-slate-200 bg-white p-5 shadow-sm">
							<label
								htmlFor="roadmap-initial-prompt"
								className="block text-sm font-bold text-slate-900"
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
								className="mt-3 min-h-28 w-full resize-y rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-900 outline-none transition focus:border-cyan-400 focus:bg-white focus:ring-4 focus:ring-cyan-100"
							/>
							<div className="mt-4 flex justify-end">
								<button
									type="button"
									onClick={handlePromptSubmit}
									disabled={!canSubmitPrompt}
									className="inline-flex items-center justify-center gap-2 rounded-full bg-slate-950 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
								>
									<Send className="h-4 w-4" />
									Send to AI
								</button>
							</div>
						</section>
					)}

					{step === "title" && !isThinking && (
						<section className="space-y-4">
							<div className="grid gap-3">
								{titleOptions.map((option, index) => (
									<button
										key={option.key}
										type="button"
										onClick={() =>
											handleTitleAnswer(option.value, option.key)
										}
										className="roadmap-chat-option group flex items-start gap-4 rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-cyan-300 hover:shadow-md"
										style={{ animationDelay: `${index * 80}ms` }}
									>
										<span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-cyan-50 text-sm font-black text-cyan-700 group-hover:bg-cyan-100">
											{option.key}
										</span>
										<span className="text-base font-bold text-slate-900">
											{option.value}
										</span>
									</button>
								))}
							</div>
							<div
								className="roadmap-chat-option rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
								style={{ animationDelay: `${titleOptions.length * 80}ms` }}
							>
								<label
									htmlFor="custom-roadmap-title"
									className="block text-sm font-bold text-slate-900"
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
										className="min-w-0 flex-1 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-cyan-400 focus:ring-4 focus:ring-cyan-100"
									/>
									<button
										type="button"
										onClick={() => handleTitleAnswer(customTitle)}
										disabled={!canSubmitTitle}
										className="inline-flex items-center justify-center rounded-full bg-slate-950 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
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
										className={`roadmap-chat-option group flex items-start gap-4 rounded-2xl border bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-cyan-300 hover:shadow-md ${
											selectedDescriptionKey === option.key
												? "border-cyan-300 ring-4 ring-cyan-100"
												: "border-slate-200"
										}`}
										style={{ animationDelay: `${index * 80}ms` }}
									>
										<span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-cyan-50 text-sm font-black text-cyan-700 group-hover:bg-cyan-100">
											{option.key}
										</span>
										<span className="text-base font-medium leading-7 text-slate-900">
											{option.value}
										</span>
									</button>
								))}
							</div>

							<div
								className="roadmap-chat-option rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
								style={{
									animationDelay: `${descriptionOptions.length * 80}ms`,
								}}
							>
								<label
									htmlFor="custom-roadmap-description"
									className="block text-sm font-bold text-slate-900"
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
									className="mt-2 min-h-28 w-full resize-y rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm leading-6 text-slate-900 outline-none transition focus:border-cyan-400 focus:ring-4 focus:ring-cyan-100"
								/>

								<label
									htmlFor="roadmap-category"
									className="mt-4 block text-sm font-bold text-slate-900"
								>
									Categories
								</label>
								<div className="mt-2 flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-3">
									{categories.map((selectedCategory) => (
										<span
											key={selectedCategory}
											className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-3 py-1.5 text-xs font-bold text-white"
										>
											{selectedCategory}
											<button
												type="button"
												onClick={() => removeCategory(selectedCategory)}
												className="rounded-full text-white/70 transition hover:text-white"
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
										className="min-w-44 flex-1 border-0 bg-transparent px-1 py-1 text-sm text-slate-900 outline-none placeholder:text-slate-400"
									/>
									<button
										type="button"
										onClick={addCustomCategory}
										disabled={!categoryInput.trim()}
										className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-700 transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-40"
									>
										Add
									</button>
								</div>
								<p className="mt-2 text-xs font-medium text-slate-500">
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
														category.toLowerCase() ===
														suggestion.toLowerCase(),
												)
													? "border-orange-400 bg-orange-500 text-white"
													: "border-orange-200 bg-orange-50 text-orange-700 hover:bg-orange-100"
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
										className="inline-flex items-center justify-center rounded-full bg-slate-950 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
									>
										Continue
									</button>
								</div>
							</div>
						</section>
					)}

					{step === "thumbnail" && !isSuggesting && (
						<section className="roadmap-chat-message grid gap-5 rounded-[2rem] border border-slate-200 bg-white p-5 shadow-[0_24px_70px_rgba(15,23,42,0.08)] sm:p-6 lg:grid-cols-[minmax(0,1fr)_320px]">
							<div>
								<p className="text-sm font-bold uppercase tracking-[0.18em] text-slate-500">
									Final metadata
								</p>
								<h1 className="mt-3 text-3xl font-black tracking-tight text-slate-950">
									{title}
								</h1>
								<p className="mt-3 text-base leading-7 text-slate-600">
									{description}
								</p>
								<p className="mt-4 inline-flex rounded-full border border-orange-200 bg-orange-50 px-3 py-1.5 text-sm font-bold text-orange-700">
									{selectedCategoryLabel || DEFAULT_ROADMAP_CATEGORY}
								</p>

								<div className="mt-6 flex flex-col gap-3 sm:flex-row">
									<button
										type="button"
										onClick={() => fileInputRef.current?.click()}
										disabled={isUploadingThumbnail || isCreating}
										className="inline-flex items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-5 py-2.5 text-sm font-bold text-slate-700 transition hover:border-cyan-300 hover:text-cyan-700 disabled:cursor-not-allowed disabled:opacity-50"
									>
										{isUploadingThumbnail ? (
											<Loader2 className="h-4 w-4 animate-spin" />
										) : (
											<ImagePlus className="h-4 w-4" />
										)}
										{isUploadingThumbnail ? "Uploading..." : "Upload thumbnail"}
									</button>
									<button
										type="button"
										onClick={() =>
											void handleCreate(
												thumbnailUrl ? "uploaded" : "generated",
											)
										}
										disabled={!canCreate}
										className="inline-flex items-center justify-center gap-2 rounded-full bg-slate-950 px-5 py-2.5 text-sm font-black text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
									>
										{isCreating && <Loader2 className="h-4 w-4 animate-spin" />}
										{thumbnailUrl
											? "Use uploaded thumbnail"
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
									<p role="alert" className="mt-4 text-sm font-bold text-red-600">
										{error}
									</p>
								)}
							</div>

							<aside>
								<p className="mb-3 text-xs font-black uppercase tracking-[0.18em] text-slate-500">
									Thumbnail preview
								</p>
								<div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
									<img
										src={previewUrl}
										alt="Generated roadmap thumbnail preview"
										className="h-44 w-full object-cover"
									/>
									<div className="p-4">
										<div className="flex items-center gap-2 text-sm font-bold text-emerald-700">
											<CheckCircle2 className="h-4 w-4" />
											{thumbnailUrl ? "Uploaded thumbnail" : "Generated thumbnail"}
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
