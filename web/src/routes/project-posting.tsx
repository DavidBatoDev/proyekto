import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import {
	ArrowLeft,
	Briefcase,
	Check,
	ExternalLink,
	Loader2,
	MapIcon,
	Upload,
	UserCheck,
	X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { ModalPortal } from "@/components/common/ModalPortal";
import {
	type FormData as BaseFormData,
	Step1 as SharedStep1,
	Step2 as SharedStep2,
	StepIndicator,
} from "@/components/project-brief";
import { ProjectTeamPicker } from "@/components/project-brief/ProjectTeamPicker";
import { useToast } from "@/hooks/useToast";
import { projectService } from "@/services/project.service";
import { roadmapService } from "@/services/roadmap.service";
import { useProfile } from "@/stores/authStore";
import type { Roadmap } from "@/types/roadmap";

export const Route = createFileRoute("/project-posting")({
	component: ProjectPostingPage,
	validateSearch: (search: Record<string, unknown>) => {
		return {
			roadmapId: (search.roadmapId as string) || undefined,
		};
	},
});

// Extended FormData with Step 3 fields
interface FormData extends BaseFormData {
	// Step 3 additional fields
	roadmapFile: File | null;
	budgetRange: string;
	customBudgetRange: string;
	fundingStatus: string;
	startDate: string;
	customStartDate: string;
}

type ProjectCreationIntent = "client" | "consultant";
type Step3Errors = Partial<
	Record<
		"budgetRange" | "customBudgetRange" | "startDate" | "customStartDate",
		string
	>
>;

function ProjectPostingPage() {
	const navigate = useNavigate();
	const toast = useToast();
	const profile = useProfile();
	const searchParams = Route.useSearch();
	const [currentStep, setCurrentStep] = useState(1);
	const [isCreatingProject, setIsCreatingProject] = useState(false);
	const [step3Errors, setStep3Errors] = useState<Step3Errors>({});
	const [submitError, setSubmitError] = useState<string | null>(null);
	const [referencedRoadmap, setReferencedRoadmap] = useState<Roadmap | null>(
		null,
	);
	const [isLoadingRoadmap, setIsLoadingRoadmap] = useState(false);
	const [creationIntent, setCreationIntent] =
		useState<ProjectCreationIntent>("client");
	const [pendingIntent, setPendingIntent] =
		useState<ProjectCreationIntent>("client");
	const [showIntentModal, setShowIntentModal] = useState(false);
	const [hasAutoOpenedIntentModal, setHasAutoOpenedIntentModal] =
		useState(false);
	// Consultant-mode primary team selection. null means either "not yet
	// chosen" (the picker will default-select on load) or the explicit
	// "No team" opt-out — we treat both the same at submit time.
	const [primaryTeamId, setPrimaryTeamId] = useState<string | null>(null);
	const fromRoadmap = Boolean(searchParams.roadmapId);
	const [formData, setFormData] = useState<FormData>({
		title: "",
		category: "",
		description: "",
		problemSolving: "",
		projectState: "idea",
		skills: [],
		customSkills: [],
		duration: "1-3_months",
		roadmapFile: null,
		budgetRange: "< $1,000",
		customBudgetRange: "",
		fundingStatus: "",
		startDate: "immediately",
		customStartDate: "",
	});

	const updateFormData = (updates: Partial<FormData>) => {
		setFormData((prev) => ({ ...prev, ...updates }));
		if (submitError) setSubmitError(null);
		setStep3Errors((prev) => {
			let next = prev;
			const clear = (field: keyof Step3Errors) => {
				if (!(field in next)) return;
				if (next === prev) next = { ...prev };
				delete next[field];
			};

			if ("budgetRange" in updates) {
				clear("budgetRange");
				if (updates.budgetRange !== "custom") clear("customBudgetRange");
			}
			if ("customBudgetRange" in updates && updates.customBudgetRange?.trim()) {
				clear("customBudgetRange");
			}
			if ("startDate" in updates) {
				clear("startDate");
				if (updates.startDate !== "custom") clear("customStartDate");
			}
			if ("customStartDate" in updates && updates.customStartDate) {
				clear("customStartDate");
			}

			return next;
		});
	};

	const isVerifiedConsultant = profile?.is_consultant_verified === true;
	const effectiveIntent: ProjectCreationIntent =
		isVerifiedConsultant && creationIntent === "consultant"
			? "consultant"
			: "client";

	useEffect(() => {
		if (!isVerifiedConsultant && creationIntent !== "client") {
			setCreationIntent("client");
		}
	}, [isVerifiedConsultant, creationIntent]);

	useEffect(() => {
		if (showIntentModal) {
			setPendingIntent(effectiveIntent);
		}
	}, [showIntentModal, effectiveIntent]);

	useEffect(() => {
		if (isVerifiedConsultant && !hasAutoOpenedIntentModal) {
			setShowIntentModal(true);
			setHasAutoOpenedIntentModal(true);
		}
	}, [isVerifiedConsultant, hasAutoOpenedIntentModal]);

	// Fetch roadmap data if roadmapId is provided
	useEffect(() => {
		const fetchRoadmapData = async () => {
			if (searchParams.roadmapId) {
				setIsLoadingRoadmap(true);
				try {
					const roadmap = await roadmapService.getById(searchParams.roadmapId);
					setReferencedRoadmap(roadmap);

					setFormData((prev) => ({
						...prev,
						title: roadmap.name || prev.title,
						description: roadmap.description || prev.description,
					}));
					setCurrentStep(1);
				} catch (error) {
					console.error("Failed to fetch roadmap:", error);
				} finally {
					setIsLoadingRoadmap(false);
				}
			}
		};

		fetchRoadmapData();
	}, [searchParams.roadmapId]);

	const nextStep = () => {
		if (currentStep < 3) setCurrentStep(currentStep + 1);
	};

	const prevStep = () => {
		if (currentStep > 1) setCurrentStep(currentStep - 1);
	};

	const validateStep3 = (): Step3Errors => {
		const errors: Step3Errors = {};

		if (!formData.budgetRange?.trim()) {
			errors.budgetRange = "Please select an estimated budget range.";
		}
		if (
			formData.budgetRange === "custom" &&
			!formData.customBudgetRange.trim()
		) {
			errors.customBudgetRange = "Please enter a custom budget amount.";
		}
		if (!formData.startDate?.trim()) {
			errors.startDate = "Please select when you want to start.";
		}
		if (formData.startDate === "custom") {
			if (!formData.customStartDate) {
				errors.customStartDate = "Please pick a custom start date.";
			} else if (!/^\d{4}-\d{2}-\d{2}$/.test(formData.customStartDate)) {
				errors.customStartDate = "Please enter a valid custom start date.";
			}
		}

		return errors;
	};

	const handleSubmit = async () => {
		if (isCreatingProject) return;
		setSubmitError(null);

		const validationErrors = validateStep3();
		if (Object.keys(validationErrors).length > 0) {
			setStep3Errors(validationErrors);
			setSubmitError(
				"Please correct the highlighted fields before submitting your project.",
			);
			return;
		}
		setStep3Errors({});

		const projectStatus =
			effectiveIntent === "consultant" ? "draft" : "bidding";
		const budgetToPersist =
			formData.budgetRange === "custom"
				? formData.customBudgetRange.trim()
				: formData.budgetRange;

		setIsCreatingProject(true);
		try {
			const { project } = await projectService.create({
				creation_mode: effectiveIntent,
				title: formData.title || "Untitled Project",
				description: formData.description,
				category: formData.category,
				project_state: formData.projectState,
				skills: [...formData.skills, ...formData.customSkills],
				duration: formData.duration,
				budget_range: budgetToPersist,
				funding_status: formData.fundingStatus,
				start_date: formData.startDate,
				custom_start_date:
					formData.startDate === "custom"
						? formData.customStartDate || undefined
						: undefined,
				status: projectStatus,
				primary_team_id:
					effectiveIntent === "consultant" && primaryTeamId
						? primaryTeamId
						: undefined,
			});

			if (fromRoadmap && referencedRoadmap) {
				try {
					await roadmapService.replaceProjectRoadmap(
						project.id,
						referencedRoadmap.id,
					);
				} catch (error) {
					console.error("Failed to replace project roadmap:", error);
					toast.warning(
						"Project created, but linking the referenced roadmap failed. You can re-link it from the roadmap page.",
					);
				}
			}

			navigate({
				to: "/project/$projectId/overview",
				params: { projectId: project.id },
			});
		} catch (error) {
			const message =
				error instanceof Error
					? error.message
					: "Failed to create project. Please review your details and try again.";
			setSubmitError(message);
			toast.error(message);
		} finally {
			setIsCreatingProject(false);
		}
	};

	return (
		<div className="app-shell-bg min-h-screen text-foreground">
			{/* Minimal top bar — back-out + intent toggle, no global header */}
			<div className="sticky top-0 z-30 border-b border-border bg-card/85 text-card-foreground backdrop-blur">
				<div className="mx-auto flex max-w-[1240px] items-center justify-between px-5 py-3 md:px-10">
					<Link
						to="/dashboard"
						className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
					>
						<ArrowLeft className="h-4 w-4" />
						Back to dashboard
					</Link>
					<p className="hidden text-sm font-semibold text-foreground sm:block">
						New project
					</p>
					{isVerifiedConsultant ? (
						<button
							type="button"
							onClick={() => setShowIntentModal(true)}
							className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-card-foreground shadow-sm transition hover:border-primary/40 hover:bg-muted"
						>
							<Briefcase className="h-3.5 w-3.5 text-muted-foreground" />
							{effectiveIntent === "client"
								? "Creating as client"
								: "Creating as consultant"}
						</button>
					) : (
						<span className="w-[88px]" aria-hidden="true" />
					)}
				</div>
			</div>

			<div className="mx-auto w-full max-w-[1240px] px-5 py-10 pb-40 md:px-10">
				{/* Progress Stepper */}
				<div className="mb-12 flex items-center justify-center">
					<StepIndicator
						step={1}
						currentStep={currentStep}
						label="Vision & Scope"
						totalSteps={3}
					/>
					<StepperBar filled={currentStep > 1} />
					<StepIndicator
						step={2}
						currentStep={currentStep}
						label="Skills & Duration"
						totalSteps={3}
					/>
					<StepperBar filled={currentStep > 2} />
					<StepIndicator
						step={3}
						currentStep={currentStep}
						label="Budget & Timeline"
						totalSteps={3}
					/>
				</div>

				{/* Step Content — single column on mobile, two columns from lg up. */}
				<div className="grid grid-cols-1 gap-8 lg:grid-cols-[360px_1fr] lg:gap-12">
					{/* Left Side - Step Info */}
					<div className="relative">
						<div className="lg:sticky lg:top-[120px]">
							<AnimatePresence mode="wait">
								{currentStep === 1 && (
									<motion.div
										key="step1-info"
										initial={{ opacity: 0, x: -20 }}
										animate={{ opacity: 1, x: 0 }}
										exit={{ opacity: 0, x: -20 }}
										transition={{ duration: 0.4, ease: "easeOut" }}
									>
										<h1 className="mb-4 text-4xl font-bold tracking-tight text-foreground">
											Step 1: Vision &<br />
											Scope
										</h1>
										<p className="text-base text-muted-foreground">
											Tell us what you want to build. You can either answer a
											few questions or upload an existing RFP/Brief.
										</p>
									</motion.div>
								)}
								{currentStep === 2 && (
									<motion.div
										key="step2-info"
										initial={{ opacity: 0, x: -20 }}
										animate={{ opacity: 1, x: 0 }}
										exit={{ opacity: 0, x: -20 }}
										transition={{ duration: 0.4, ease: "easeOut" }}
									>
										<h1 className="mb-4 text-4xl font-bold tracking-tight text-foreground">
											Step 2: Skills &<br />
											Deliverables
										</h1>
										<p className="text-base text-muted-foreground">
											Define the expertise you need and the results you expect.
										</p>
									</motion.div>
								)}
								{currentStep === 3 && (
									<motion.div
										key="step3-info"
										initial={{ opacity: 0, x: -20 }}
										animate={{ opacity: 1, x: 0 }}
										exit={{ opacity: 0, x: -20 }}
										transition={{ duration: 0.4, ease: "easeOut" }}
									>
										<h1 className="mb-4 text-4xl font-bold tracking-tight text-foreground">
											Step 3: Budget &<br />
											Timeline
										</h1>
										<p className="text-base text-muted-foreground">
											{effectiveIntent === "consultant"
												? "Set budget and timing for the project you're leading. You can adjust these later when you transfer it to a client."
												: "Help us match you with consultants who fit your financial and schedule goals."}
										</p>
									</motion.div>
								)}
							</AnimatePresence>
						</div>
					</div>

					{/* Right Side - Form */}
					<div className="min-h-[500px] min-w-0">
						<AnimatePresence mode="wait">
							{currentStep === 1 && (
								<motion.div
									key="step1-form"
									initial={{ opacity: 0, x: 20 }}
									animate={{ opacity: 1, x: 0 }}
									exit={{ opacity: 0, x: 20 }}
									transition={{ duration: 0.4, ease: "easeOut" }}
								>
									<SharedStep1
										formData={formData}
										updateFormData={updateFormData}
									/>
								</motion.div>
							)}
							{currentStep === 2 && (
								<motion.div
									key="step2-form"
									initial={{ opacity: 0, x: 20 }}
									animate={{ opacity: 1, x: 0 }}
									exit={{ opacity: 0, x: 20 }}
									transition={{ duration: 0.4, ease: "easeOut" }}
								>
									<SharedStep2
										formData={formData}
										updateFormData={updateFormData}
									/>
								</motion.div>
							)}
							{currentStep === 3 && (
								<motion.div
									key="step3-form"
									initial={{ opacity: 0, x: 20 }}
									animate={{ opacity: 1, x: 0 }}
									exit={{ opacity: 0, x: 20 }}
									transition={{ duration: 0.4, ease: "easeOut" }}
								>
									<Step3
										formData={formData}
										updateFormData={updateFormData}
										referencedRoadmap={referencedRoadmap}
										errors={step3Errors}
										formError={submitError}
									/>
									{effectiveIntent === "consultant" && (
										<div className="mt-8 rounded-2xl border border-border bg-card p-6 text-card-foreground shadow-sm">
											<ProjectTeamPicker
												value={primaryTeamId}
												onChange={setPrimaryTeamId}
											/>
										</div>
									)}
								</motion.div>
							)}
						</AnimatePresence>
					</div>
				</div>

				{/* Navigation Buttons */}
				<div className="pointer-events-none fixed bottom-0 left-0 right-0 z-40 bg-linear-to-t from-background via-background/85 to-transparent pb-8 pt-6">
					<div className="mx-auto flex max-w-[1240px] justify-between px-5 md:px-10">
						<button
							type="button"
							onClick={prevStep}
							disabled={currentStep === 1}
							className="pointer-events-auto cursor-pointer rounded-lg border border-border bg-card px-6 py-2.5 text-sm font-semibold text-card-foreground shadow-sm transition hover:border-primary/40 hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
						>
							Back
						</button>
						{currentStep < 3 ? (
							<button
								type="button"
								onClick={nextStep}
								className="pointer-events-auto cursor-pointer rounded-lg bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition hover:bg-primary/90"
							>
								Next
							</button>
						) : (
							<button
								type="button"
								onClick={handleSubmit}
								disabled={isCreatingProject}
								className="pointer-events-auto inline-flex cursor-pointer items-center gap-2 rounded-lg bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
							>
								{isCreatingProject ? (
									<>
										<Loader2 className="h-4 w-4 animate-spin" />
										Creating…
									</>
								) : (
									<>
										<Check className="h-4 w-4" />
										Submit project
									</>
								)}
							</button>
						)}
					</div>
				</div>
			</div>

			{/* Intent Modal */}
			<ModalPortal>
				<AnimatePresence>
					{isVerifiedConsultant && showIntentModal && (
						<motion.div
							className="fixed inset-0 z-9998 flex items-center justify-center p-4"
							initial={{ opacity: 0 }}
							animate={{ opacity: 1 }}
							exit={{ opacity: 0 }}
						>
							<motion.div
								className="absolute inset-0 bg-black/65 backdrop-blur-md"
								initial={{ opacity: 0 }}
								animate={{ opacity: 1 }}
								exit={{ opacity: 0 }}
								onClick={() => window.history.back()}
							/>
							<motion.div
								className="relative w-full max-w-3xl overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-2xl"
								initial={{ opacity: 0, y: 24, scale: 0.96 }}
								animate={{ opacity: 1, y: 0, scale: 1 }}
								exit={{ opacity: 0, y: 16, scale: 0.96 }}
								transition={{ duration: 0.25, ease: "easeOut" }}
							>
								<div className="relative p-6 md:p-8">
									<div className="mb-6 flex items-start justify-between gap-4">
										<div>
											<h2 className="text-2xl font-semibold tracking-tight text-foreground md:text-3xl">
												How are you creating this project?
											</h2>
											<p className="mt-2 max-w-2xl text-sm text-muted-foreground md:text-base">
												Pick whether you're creating it as the client (you want
												to hire a consultant to deliver) or as a consultant
												(you'll lead the work yourself, optionally for a client
												later). This controls visibility, ownership, and who
												gets matched.
											</p>
										</div>
										<button
											type="button"
											onClick={() => window.history.back()}
											className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
											aria-label="Close intent modal"
										>
											<X className="h-5 w-5" />
										</button>
									</div>

									<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
										<IntentOptionCard
											icon={Briefcase}
											title="Creating as a client"
											description="You want to hire a verified consultant to lead delivery."
											bullets={[
												"Posted publicly so consultants can apply",
												"We match you with vetted professionals",
												"You stay the project owner; the consultant runs execution",
											]}
											selected={pendingIntent === "client"}
											onSelect={() => setPendingIntent("client")}
										/>
										<IntentOptionCard
											icon={UserCheck}
											title="Creating as a consultant"
											description="You'll lead the work yourself — alone or with your team — and optionally hand it off to a client later."
											bullets={[
												"Starts as a private draft owned by you",
												"You can attach your team as the primary delivery team",
												"Transfer ownership to a client whenever you're ready",
											]}
											selected={pendingIntent === "consultant"}
											onSelect={() => setPendingIntent("consultant")}
										/>
									</div>

									<div className="mt-6 flex items-center justify-between gap-3">
										<p className="text-xs text-muted-foreground">
											You can reopen this anytime from the "Creating as…" button
											at the top of the page.
										</p>
										<button
											type="button"
											onClick={() => {
												setCreationIntent(pendingIntent);
												setShowIntentModal(false);
											}}
											className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition hover:bg-primary/90"
										>
											Continue
										</button>
									</div>
								</div>
							</motion.div>
						</motion.div>
					)}
				</AnimatePresence>
			</ModalPortal>

			{/* Loading Modal for Pre-populating */}
			<ModalPortal>
				<AnimatePresence>
					{isLoadingRoadmap && (
						<motion.div
							className="fixed inset-0 z-9999 flex items-center justify-center p-4"
							initial={{ opacity: 0 }}
							animate={{ opacity: 1 }}
							exit={{ opacity: 0 }}
						>
							<motion.div
								className="absolute inset-0 bg-black/50 backdrop-blur-sm"
								initial={{ opacity: 0 }}
								animate={{ opacity: 1 }}
								exit={{ opacity: 0 }}
							/>
							<motion.div
								className="relative w-full max-w-md rounded-2xl border border-border bg-card p-8 text-card-foreground shadow-2xl"
								initial={{ opacity: 0, scale: 0.9, y: 20 }}
								animate={{ opacity: 1, scale: 1, y: 0 }}
								exit={{ opacity: 0, scale: 0.9, y: 20 }}
								transition={{ duration: 0.3, ease: "easeOut" }}
							>
								<div className="text-center">
									<div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
										<Loader2 className="h-8 w-8 animate-spin text-primary" />
									</div>
									<h2 className="mb-3 text-2xl font-bold text-foreground">
										Loading Roadmap Data
									</h2>
									<p className="text-muted-foreground">
										Pre-populating Steps 1 and 2 from your roadmap...
									</p>
								</div>
							</motion.div>
						</motion.div>
					)}
				</AnimatePresence>
			</ModalPortal>
		</div>
	);
}

function IntentOptionCard({
	icon: Icon,
	title,
	description,
	bullets,
	selected,
	onSelect,
}: {
	icon: React.ElementType;
	title: string;
	description: string;
	bullets: string[];
	selected: boolean;
	onSelect: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onSelect}
			className={`rounded-xl border p-5 text-left transition-all ${
				selected
					? "border-primary bg-primary/10 shadow-sm"
					: "border-border bg-card hover:border-primary/40 hover:bg-muted/60"
			}`}
		>
			<div className="mb-3 flex items-center gap-3">
				<div
					className={`flex h-10 w-10 items-center justify-center rounded-lg ${
						selected
							? "bg-primary text-primary-foreground"
							: "bg-muted text-muted-foreground"
					}`}
				>
					<Icon className="h-5 w-5" />
				</div>
				<h3 className="text-base font-semibold text-foreground">{title}</h3>
				{selected && (
					<span className="ml-auto rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary-foreground">
						Selected
					</span>
				)}
			</div>
			<p className="mb-3 text-sm text-muted-foreground">{description}</p>
			<ul className="space-y-1 text-xs text-muted-foreground">
				{bullets.map((b) => (
					<li key={b}>• {b}</li>
				))}
			</ul>
		</button>
	);
}

/**
 * Slate stepper bar between StepIndicator dots. Filled = previous step
 * complete, otherwise muted slate-200.
 */
function StepperBar({ filled }: { filled: boolean }) {
	return (
		<div className="-mt-6 mx-1 h-1 w-10 overflow-hidden rounded-full bg-muted sm:mx-2 sm:w-20 lg:w-32">
			<motion.div
				className="h-full bg-primary"
				initial={{ width: "0%" }}
				animate={{ width: filled ? "100%" : "0%" }}
				transition={{ duration: 0.5, ease: "easeInOut" }}
			/>
		</div>
	);
}

function Step3({
	formData,
	updateFormData,
	referencedRoadmap,
	errors,
	formError,
}: {
	formData: FormData;
	updateFormData: (updates: Partial<FormData>) => void;
	referencedRoadmap: Roadmap | null;
	errors: Step3Errors;
	formError: string | null;
}) {
	return (
		<div className="space-y-6">
			{formError && (
				<div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
					{formError}
				</div>
			)}
			{/* Budget Range (repeated from Step 2) */}
			<div>
				<p className="mb-4 block text-sm font-semibold text-foreground">
					Estimated Budget Range*
				</p>
				<div className="grid grid-cols-2 gap-4">
					<TileOption
						name="budgetRange"
						value="< $1,000"
						label="< $1,000"
						checked={formData.budgetRange === "< $1,000"}
						onChange={() => updateFormData({ budgetRange: "< $1,000" })}
					/>
					<TileOption
						name="budgetRange"
						value="$1k - $5k"
						label="$1k - $5k"
						checked={formData.budgetRange === "$1k - $5k"}
						onChange={() => updateFormData({ budgetRange: "$1k - $5k" })}
					/>
					<TileOption
						name="budgetRange"
						value="$10k - $50k"
						label="$10k - $50k"
						checked={formData.budgetRange === "$10k - $50k"}
						onChange={() => updateFormData({ budgetRange: "$10k - $50k" })}
					/>
					<TileOption
						name="budgetRange"
						value="$50k+"
						label="$50k+"
						checked={formData.budgetRange === "$50k+"}
						onChange={() => updateFormData({ budgetRange: "$50k+" })}
					/>
					<div className="col-span-2 flex items-center rounded-xl border border-border bg-card px-4 py-3 text-card-foreground shadow-sm transition-colors hover:border-primary/50">
						<input
							type="radio"
							name="budgetRange"
							checked={formData.budgetRange === "custom"}
							onChange={() => updateFormData({ budgetRange: "custom" })}
							className="h-5 w-5 accent-primary focus:ring-primary"
						/>
						<input
							type="text"
							placeholder="Enter Custom Amount"
							value={formData.customBudgetRange}
							onChange={(e) =>
								updateFormData({
									budgetRange: "custom",
									customBudgetRange: e.target.value,
								})
							}
							className="ml-3 flex-1 border-b border-border bg-transparent px-3 py-2 text-foreground outline-none placeholder:text-muted-foreground focus:border-primary"
						/>
					</div>
				</div>
				{errors.budgetRange && (
					<p className="mt-2 text-sm text-destructive">{errors.budgetRange}</p>
				)}
				{errors.customBudgetRange && (
					<p className="mt-1 text-sm text-destructive">
						{errors.customBudgetRange}
					</p>
				)}
			</div>
			{/* Funding Status */}
			<div>
				<p className="mb-2 block text-sm font-semibold text-foreground">
					Funding Status
				</p>
				<select
					value={formData.fundingStatus}
					onChange={(e) => updateFormData({ fundingStatus: e.target.value })}
					className="w-full rounded-lg border border-input bg-card px-3 py-2 text-card-foreground shadow-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/25"
				>
					<option value="">Select...</option>
					<option value="self-funded">Self-funded</option>
					<option value="seed">Seed Round</option>
					<option value="series-a">Series A</option>
					<option value="series-b">Series B+</option>
					<option value="bootstrapped">Bootstrapped</option>
				</select>
			</div>
			{/* Start Date */}
			<div>
				<p className="mb-4 block text-sm font-semibold text-foreground">
					When do you want to start?*
				</p>
				<div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
					<TileOption
						name="startDate"
						value="immediately"
						label="Immediately"
						checked={formData.startDate === "immediately"}
						onChange={() => updateFormData({ startDate: "immediately" })}
					/>
					<TileOption
						name="startDate"
						value="within-month"
						label="Within a month"
						checked={formData.startDate === "within-month"}
						onChange={() => updateFormData({ startDate: "within-month" })}
					/>
					<div className="flex items-center rounded-xl border border-border bg-card px-4 py-2 text-card-foreground shadow-sm transition-colors hover:border-primary/50">
						<input
							type="radio"
							name="startDate"
							checked={formData.startDate === "custom"}
							onChange={() => updateFormData({ startDate: "custom" })}
							className="h-5 w-5 accent-primary focus:ring-primary"
						/>
						<input
							type="date"
							value={formData.customStartDate}
							onChange={(e) => {
								updateFormData({
									startDate: "custom",
									customStartDate: e.target.value,
								});
							}}
							className="ml-3 flex-1 border-b border-border bg-transparent px-2 py-1 text-sm text-foreground outline-none focus:border-primary [color-scheme:light] dark:[color-scheme:dark]"
							placeholder="DD/MM/YY"
						/>
					</div>
				</div>
				{errors.startDate && (
					<p className="mt-2 text-sm text-destructive">{errors.startDate}</p>
				)}
				{errors.customStartDate && (
					<p className="mt-1 text-sm text-destructive">
						{errors.customStartDate}
					</p>
				)}
			</div>
			{/* Roadmap Upload or Reference */}
			<div>
				<p className="mb-2 block text-sm font-semibold text-foreground">
					Do you have an existing Roadmap or Timeline? (Optional)
				</p>
				{referencedRoadmap ? (
					// Show roadmap reference when coming from roadmap
					<div className="rounded-lg border-2 border-primary/30 bg-primary/10 p-6">
						<div className="flex items-start gap-4">
							<div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary">
								<MapIcon className="h-6 w-6 text-primary-foreground" />
							</div>
							<div className="flex-1">
								<h4 className="mb-1 font-semibold text-foreground">
									Linked Roadmap
								</h4>
								<p className="mb-3 text-sm text-muted-foreground">
									This project is based on your roadmap:{" "}
									<span className="font-semibold">
										"{referencedRoadmap.name}"
									</span>
								</p>
								<a
									href={`/project/n/roadmap/${referencedRoadmap.id}`}
									target="_blank"
									rel="noopener noreferrer"
									className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:text-primary/80"
								>
									View Roadmap
									<ExternalLink className="w-4 h-4" />
								</a>
							</div>
						</div>
					</div>
				) : (
					// Show file upload when not coming from roadmap
					<div className="rounded-lg border-2 border-dashed border-border bg-card/60 p-8 text-center">
						<Upload className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
						<p className="mb-1 text-muted-foreground">
							<span className="cursor-pointer font-semibold text-primary hover:underline">
								Link
							</span>{" "}
							or drag and drop
						</p>
						<p className="text-xs text-muted-foreground">
							SVG, PNG, JPG or GIF (max. 3MB)
						</p>
						<p className="mt-2 text-xs italic text-muted-foreground">
							Attach Project Schedule or Gantt Chart (PDF, Excel)
						</p>
					</div>
				)}
			</div>
		</div>
	);
}

function TileOption({
	name,
	value,
	label,
	description,
	checked,
	onChange,
}: {
	name: string;
	value: string;
	label: string;
	description?: string;
	checked: boolean;
	onChange: () => void;
}) {
	return (
		<label
			className={`relative flex items-start p-4 rounded-xl border-2 transition-all cursor-pointer ${
				checked
					? "border-primary bg-primary/10 shadow-md"
					: "border-border bg-card shadow-sm hover:border-primary/50 hover:bg-muted/60"
			}`}
		>
			<div className="flex items-center h-5">
				<input
					type="radio"
					name={name}
					value={value}
					checked={checked}
					onChange={onChange}
					className="h-5 w-5 accent-primary focus:ring-primary"
				/>
			</div>
			<div className="ml-3 text-sm">
				<span
					className={`block font-semibold ${checked ? "text-foreground" : "text-muted-foreground"}`}
				>
					{label}
				</span>
				{description && (
					<span className="mt-1 block text-xs text-muted-foreground">
						{description}
					</span>
				)}
			</div>
		</label>
	);
}
