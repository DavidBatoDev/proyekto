import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ExternalLink, Loader2, MapIcon } from "lucide-react";
import { useEffect, useState } from "react";
import {
	GoLiveCallout,
	GoLiveChoiceCard,
	GoLiveField,
	GoLiveInput,
	GoLivePanel,
	GoLiveTextarea,
} from "@/components/marketplace/talent/go-live/GoLiveForm";
import { GoLiveNav } from "@/components/marketplace/talent/go-live/GoLiveNav";
import { ProjectTeamPicker } from "@/components/project-brief/ProjectTeamPicker";
import { useToast } from "@/hooks/useToast";
import { isActiveConsultant } from "@/lib/auth-utils";
import { projectService } from "@/services/project.service";
import { roadmapService } from "@/services/roadmap.service";
import { listMyTeams } from "@/services/teams.service";
import { useProfile, useUser } from "@/stores/authStore";
import type { Roadmap } from "@/types/roadmap";

/**
 * Create a project.
 *
 * It lives under the execution subtree rather than `/marketplace`: creating a
 * project is how execution starts, and the marketplace prefix framed it as a
 * posting you take to market — which is only one of the two things this form
 * does. `_execution` is pathless by design (see `routes/marketplace/route.tsx`),
 * so the canonical path is `/project/new`, next to `/project/$projectId`.
 *
 * The page is a small wizard in the talent go-live's design language — sticky
 * copy rail on the left, animated step panel on the right, fixed bottom bar
 * carrying progress — so both "start something on Proyekto" flows read as one
 * product. The form primitives are shared with that wizard (GoLiveForm/Nav).
 */
export const Route = createFileRoute("/_execution/project/new")({
	component: NewProjectPage,
	validateSearch: (search: Record<string, unknown>) => ({
		roadmapId: (search.roadmapId as string) || undefined,
	}),
});

type ProjectCreationIntent = "client" | "consultant";

const DURATION_OPTIONS = [
	{ value: "<1_month", label: "Less than 1 month" },
	{ value: "1-3_months", label: "1–3 months" },
	{ value: "3-6_months", label: "3–6 months" },
	{ value: "6+_months", label: "6+ months" },
] as const;

const TOTAL_STEPS = 3;

const STEP_COPY: { title: string; body: string }[] = [
	{
		title: "Tell us about the work",
		body: "Give the project a name and describe the outcome. This becomes the brief every collaborator — and the roadmap assistant — reads first.",
	},
	{
		title: "Shape the project",
		body: "A rough timeline and how the project starts. Everything here only sets expectations — scope, roadmap, team and budget all evolve inside the project.",
	},
	{
		title: "Review and create",
		body: "A quick look at what you are creating before it goes up.",
	},
];

function NewProjectPage() {
	const navigate = useNavigate();
	const toast = useToast();
	const profile = useProfile();
	const user = useUser();
	const search = Route.useSearch();
	const [currentStep, setCurrentStep] = useState(1);
	const [title, setTitle] = useState("");
	const [description, setDescription] = useState("");
	const [duration, setDuration] = useState("1-3_months");
	const [creationIntent, setCreationIntent] =
		useState<ProjectCreationIntent>("client");
	const [primaryTeamId, setPrimaryTeamId] = useState<string | null>(null);
	const [referencedRoadmap, setReferencedRoadmap] = useState<Roadmap | null>(
		null,
	);
	const [isLoadingRoadmap, setIsLoadingRoadmap] = useState(false);
	const [isCreating, setIsCreating] = useState(false);
	const [errors, setErrors] = useState<{
		title?: string;
		description?: string;
	}>({});

	const isVerifiedConsultant = isActiveConsultant(profile);
	const effectiveIntent: ProjectCreationIntent =
		isVerifiedConsultant && creationIntent === "consultant"
			? "consultant"
			: "client";

	// Same cache entry ProjectTeamPicker fills — here only to put the chosen
	// team's name on the review step.
	const teamsQuery = useQuery({
		queryKey: ["teams", "mine", user?.id ?? "anonymous"] as const,
		queryFn: listMyTeams,
		enabled: Boolean(user?.id) && effectiveIntent === "consultant",
		staleTime: 30 * 1000,
	});
	const primaryTeamName = primaryTeamId
		? (teamsQuery.data?.find((team) => team.id === primaryTeamId)?.name ??
			"Selected team")
		: null;

	useEffect(() => {
		if (!isVerifiedConsultant) setCreationIntent("client");
	}, [isVerifiedConsultant]);

	useEffect(() => {
		if (!search.roadmapId) {
			setReferencedRoadmap(null);
			return;
		}

		let cancelled = false;
		setIsLoadingRoadmap(true);
		void roadmapService
			.getById(search.roadmapId)
			.then((roadmap) => {
				if (cancelled) return;
				setReferencedRoadmap(roadmap);
				setTitle((current) => current || roadmap.name || "");
				setDescription((current) => current || roadmap.description || "");
			})
			.catch(() => {
				if (!cancelled) {
					toast.error("The referenced roadmap could not be loaded.");
				}
			})
			.finally(() => {
				if (!cancelled) setIsLoadingRoadmap(false);
			});

		return () => {
			cancelled = true;
		};
	}, [search.roadmapId, toast]);

	const handleSubmit = async () => {
		if (isCreating) return;
		setIsCreating(true);
		try {
			const { project } = await projectService.create({
				creation_mode: effectiveIntent,
				title: title.trim(),
				description: description.trim(),
				duration,
				status: effectiveIntent === "consultant" ? "draft" : "bidding",
				primary_team_id:
					effectiveIntent === "consultant" && primaryTeamId
						? primaryTeamId
						: undefined,
			});

			if (referencedRoadmap) {
				try {
					await roadmapService.replaceProjectRoadmap(
						project.id,
						referencedRoadmap.id,
					);
				} catch {
					toast.warning(
						"Project created, but the roadmap could not be linked. You can link it later from the roadmap page.",
					);
				}
			}

			await navigate({
				to: "/project/$projectId/overview",
				params: { projectId: project.id },
			});
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Failed to create project.",
			);
		} finally {
			setIsCreating(false);
		}
	};

	const advance = () => {
		if (currentStep === 1) {
			const nextErrors = {
				...(title.trim() ? {} : { title: "Project title is required." }),
				...(description.trim()
					? {}
					: { description: "Project description is required." }),
			};
			setErrors(nextErrors);
			const firstError = nextErrors.title ?? nextErrors.description;
			if (firstError) {
				toast.error(firstError);
				return;
			}
		}
		if (currentStep === TOTAL_STEPS) {
			void handleSubmit();
			return;
		}
		setCurrentStep((step) => Math.min(step + 1, TOTAL_STEPS));
	};

	const copy = STEP_COPY[currentStep - 1];

	return (
		<div className="min-h-screen bg-background text-foreground">
			<header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur">
				<div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
					<Link
						to="/dashboard"
						className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
					>
						<ArrowLeft className="h-4 w-4" />
						Back to dashboard
					</Link>
					<p className="text-sm font-semibold text-foreground">New project</p>
				</div>
			</header>

			<main className="mx-auto max-w-6xl px-4 pb-32 pt-8 sm:px-6 lg:px-8 lg:pt-12">
				<div className="grid gap-8 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)] lg:gap-12">
					<div className="relative">
						<div className="lg:sticky lg:top-24">
							<AnimatePresence mode="wait">
								<motion.div
									key={currentStep}
									initial={{ opacity: 0, x: -20 }}
									animate={{ opacity: 1, x: 0 }}
									exit={{ opacity: 0, x: -20 }}
									transition={{ duration: 0.35, ease: "easeOut" }}
								>
									<h1 className="mb-3 text-2xl font-semibold leading-tight tracking-tight text-foreground sm:text-3xl lg:text-4xl">
										{copy.title}
									</h1>
									<p className="text-[15px] leading-relaxed text-muted-foreground lg:text-lg">
										{copy.body}
									</p>
								</motion.div>
							</AnimatePresence>
						</div>
					</div>

					<div className="min-h-[400px]">
						<AnimatePresence mode="wait">
							<motion.div
								key={currentStep}
								initial={{ opacity: 0, x: 24 }}
								animate={{ opacity: 1, x: 0 }}
								exit={{ opacity: 0, x: -24 }}
								transition={{ duration: 0.28, ease: "easeOut" }}
							>
								{currentStep === 1 && (
									<section className="space-y-5 rounded-2xl border border-border bg-card p-5 sm:p-6">
										{isVerifiedConsultant && (
											<GoLiveField label="Your position" required>
												<div className="grid gap-3 sm:grid-cols-2">
													<GoLiveChoiceCard
														name="creation-intent"
														value="client"
														label="As the client"
														description="You own the brief and bring in a consultant later. The project opens for bids."
														checked={creationIntent === "client"}
														onChange={() => setCreationIntent("client")}
													/>
													<GoLiveChoiceCard
														name="creation-intent"
														value="consultant"
														label="As the consultant"
														description="You lead delivery and can attach one of your teams. The project starts as a draft."
														checked={creationIntent === "consultant"}
														onChange={() => setCreationIntent("consultant")}
													/>
												</div>
											</GoLiveField>
										)}

										<GoLiveField
											label="Project title"
											required
											htmlFor="project-title"
											hint="What the work is called across the app."
										>
											<GoLiveInput
												id="project-title"
												value={title}
												onChange={(event) => {
													setTitle(event.target.value);
													setErrors((current) => ({
														...current,
														title: undefined,
													}));
												}}
												maxLength={200}
												placeholder="e.g. Customer support portal"
											/>
											{errors.title && (
												<p className="mt-1.5 text-sm text-destructive">
													{errors.title}
												</p>
											)}
										</GoLiveField>

										<GoLiveField
											label="Description"
											required
											htmlFor="project-description"
											hint="Saved as the project brief and available to the roadmap assistant."
										>
											<GoLiveTextarea
												id="project-description"
												value={description}
												onChange={(event) => {
													setDescription(event.target.value);
													setErrors((current) => ({
														...current,
														description: undefined,
													}));
												}}
												maxLength={2000}
												rows={6}
												placeholder="Describe the outcome, audience, and important constraints."
											/>
											{errors.description && (
												<p className="mt-1.5 text-sm text-destructive">
													{errors.description}
												</p>
											)}
										</GoLiveField>
									</section>
								)}

								{currentStep === 2 && (
									<section className="space-y-5 rounded-2xl border border-border bg-card p-5 sm:p-6">
										<GoLiveField
											label="Expected duration"
											hint="A rough estimate — it only sets expectations."
										>
											<div className="grid gap-3 sm:grid-cols-2">
												{DURATION_OPTIONS.map((option) => (
													<GoLiveChoiceCard
														key={option.value}
														name="duration"
														value={option.value}
														label={option.label}
														checked={duration === option.value}
														onChange={() => setDuration(option.value)}
													/>
												))}
											</div>
										</GoLiveField>

										{(isLoadingRoadmap || referencedRoadmap) && (
											<GoLiveField
												label="Linked roadmap"
												hint="Attached to the project once it is created."
											>
												{isLoadingRoadmap ? (
													<p className="flex items-center gap-2 text-sm text-muted-foreground">
														<Loader2 className="h-4 w-4 animate-spin" />
														Loading referenced roadmap…
													</p>
												) : (
													referencedRoadmap && (
														<div className="flex items-center gap-3 rounded-xl border border-border bg-background px-4 py-3">
															<MapIcon className="h-4 w-4 shrink-0 text-primary" />
															<span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
																{referencedRoadmap.name}
															</span>
															<a
																href={`/project/n/roadmap/${referencedRoadmap.id}`}
																target="_blank"
																rel="noreferrer"
																className="inline-flex shrink-0 items-center gap-1 text-[13px] font-semibold text-primary hover:text-primary/80"
															>
																View <ExternalLink className="h-3.5 w-3.5" />
															</a>
														</div>
													)
												)}
											</GoLiveField>
										)}

										{effectiveIntent === "consultant" && (
											<GoLiveField
												label="Primary team"
												hint="Whose members can be curated onto this project. Rates and billing come from the team, and you can change it later in project settings."
											>
												<ProjectTeamPicker
													value={primaryTeamId}
													onChange={setPrimaryTeamId}
												/>
											</GoLiveField>
										)}
									</section>
								)}

								{currentStep === 3 && (
									<div className="space-y-5">
										<GoLivePanel className="space-y-2 p-5">
											{isVerifiedConsultant && (
												<ReviewRow
													label="Position"
													value={
														effectiveIntent === "consultant"
															? "Consultant — starts as a draft you lead"
															: "Client — opens for consultant bids"
													}
												/>
											)}
											<ReviewRow label="Title" value={title.trim() || "—"} />
											<ReviewRow
												label="Duration"
												value={
													DURATION_OPTIONS.find(
														(option) => option.value === duration,
													)?.label ?? duration
												}
											/>
											{referencedRoadmap && (
												<ReviewRow
													label="Roadmap"
													value={referencedRoadmap.name}
												/>
											)}
											{effectiveIntent === "consultant" && (
												<ReviewRow
													label="Primary team"
													value={primaryTeamName ?? "No team — attach later"}
												/>
											)}
											{description.trim() && (
												<div className="pt-2">
													<p className="text-sm font-medium text-muted-foreground">
														Description
													</p>
													<p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-foreground">
														{description.trim()}
													</p>
												</div>
											)}
										</GoLivePanel>

										<GoLiveCallout tone="info">
											{effectiveIntent === "consultant"
												? "Creating the project sets up its chat channels and an empty roadmap, and attaches your team. It starts as a draft only you and your collaborators can see."
												: "Creating the project sets up its chat channels and an empty roadmap, and opens it for consultant bids. You stay in control of who joins."}
										</GoLiveCallout>
									</div>
								)}
							</motion.div>
						</AnimatePresence>
					</div>
				</div>
			</main>

			<GoLiveNav
				currentStep={currentStep}
				totalSteps={TOTAL_STEPS}
				isSaving={isCreating}
				onBack={() => setCurrentStep((step) => Math.max(step - 1, 1))}
				onNext={advance}
				finalLabel="Create project"
				savingLabel="Creating…"
			/>
		</div>
	);
}

function ReviewRow({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex items-baseline justify-between gap-4">
			<span className="shrink-0 text-sm font-medium text-muted-foreground">
				{label}
			</span>
			<span className="min-w-0 truncate text-right text-sm font-medium text-foreground">
				{value}
			</span>
		</div>
	);
}
