import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
	ArrowLeft,
	Briefcase,
	ExternalLink,
	Loader2,
	MapIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { ProjectTeamPicker } from "@/components/project-brief/ProjectTeamPicker";
import { useToast } from "@/hooks/useToast";
import { isActiveConsultant } from "@/lib/auth-utils";
import { projectService } from "@/services/project.service";
import { roadmapService } from "@/services/roadmap.service";
import { useProfile } from "@/stores/authStore";
import type { Roadmap } from "@/types/roadmap";

export const Route = createFileRoute("/_marketplace/project-posting")({
	component: ProjectPostingPage,
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

function ProjectPostingPage() {
	const navigate = useNavigate();
	const toast = useToast();
	const profile = useProfile();
	const search = Route.useSearch();
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
		const nextErrors = {
			...(title.trim() ? {} : { title: "Project title is required." }),
			...(description.trim()
				? {}
				: { description: "Project description is required." }),
		};
		setErrors(nextErrors);
		if (Object.keys(nextErrors).length > 0) return;

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

	return (
		<div className="app-shell-bg min-h-screen text-foreground">
			<header className="sticky top-0 z-30 border-b border-border bg-card/85 backdrop-blur">
				<div className="mx-auto flex max-w-4xl items-center justify-between px-5 py-3 md:px-8">
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

			<main className="mx-auto max-w-4xl px-5 py-10 md:px-8">
				<div className="mb-8">
					<p className="mb-2 text-sm font-semibold text-primary">
						Create project
					</p>
					<h1 className="text-3xl font-bold tracking-tight text-foreground">
						Set up the work
					</h1>
					<p className="mt-2 text-sm text-muted-foreground">
						Capture the core brief now. Everything else can evolve inside the
						project.
					</p>
				</div>

				<div className="space-y-6 rounded-2xl border border-border bg-card p-6 shadow-sm md:p-8">
					{isVerifiedConsultant && (
						<section>
							<p className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
								<Briefcase className="h-4 w-4 text-muted-foreground" />
								How are you creating this project?
							</p>
							<div className="grid gap-2 sm:grid-cols-2">
								<IntentButton
									selected={creationIntent === "client"}
									title="As the client"
									description="You own the brief and will bring in a consultant later."
									onClick={() => setCreationIntent("client")}
								/>
								<IntentButton
									selected={creationIntent === "consultant"}
									title="As the consultant"
									description="You lead delivery and may attach one of your teams."
									onClick={() => setCreationIntent("consultant")}
								/>
							</div>
						</section>
					)}

					<div>
						<label
							htmlFor="project-title"
							className="mb-2 block text-sm font-semibold text-foreground"
						>
							Project title
						</label>
						<input
							id="project-title"
							value={title}
							onChange={(event) => {
								setTitle(event.target.value);
								setErrors((current) => ({ ...current, title: undefined }));
							}}
							maxLength={200}
							placeholder="e.g. Customer support portal"
							className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/25"
						/>
						{errors.title && (
							<p className="mt-1 text-sm text-destructive">{errors.title}</p>
						)}
					</div>

					<div>
						<label
							htmlFor="project-description"
							className="mb-2 block text-sm font-semibold text-foreground"
						>
							Project description
						</label>
						<textarea
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
							className="w-full resize-y rounded-lg border border-input bg-background px-3 py-2.5 text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/25"
						/>
						<p className="mt-1 text-xs text-muted-foreground">
							Saved as the project brief and available to the roadmap assistant.
						</p>
						{errors.description && (
							<p className="mt-1 text-sm text-destructive">
								{errors.description}
							</p>
						)}
					</div>

					<fieldset>
						<legend className="mb-2 text-sm font-semibold text-foreground">
							Expected duration
						</legend>
						<div className="grid gap-2 sm:grid-cols-2">
							{DURATION_OPTIONS.map((option) => (
								<label
									key={option.value}
									className={`flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 text-sm transition ${
										duration === option.value
											? "border-primary bg-primary/10 text-foreground"
											: "border-border text-muted-foreground hover:border-primary/50 hover:bg-muted/60"
									}`}
								>
									<input
										type="radio"
										name="duration"
										value={option.value}
										checked={duration === option.value}
										onChange={() => setDuration(option.value)}
										className="accent-primary"
									/>
									{option.label}
								</label>
							))}
						</div>
					</fieldset>

					{isLoadingRoadmap ? (
						<div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
							<Loader2 className="h-4 w-4 animate-spin" /> Loading referenced
							roadmap…
						</div>
					) : referencedRoadmap ? (
						<div className="flex items-start gap-4 rounded-lg border border-primary/30 bg-primary/10 p-4">
							<div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
								<MapIcon className="h-5 w-5" />
							</div>
							<div className="min-w-0 flex-1">
								<p className="text-sm font-semibold text-foreground">
									Linked roadmap
								</p>
								<p className="truncate text-sm text-muted-foreground">
									{referencedRoadmap.name}
								</p>
								<a
									href={`/project/n/roadmap/${referencedRoadmap.id}`}
									target="_blank"
									rel="noreferrer"
									className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:text-primary/80"
								>
									View roadmap <ExternalLink className="h-3.5 w-3.5" />
								</a>
							</div>
						</div>
					) : null}

					{effectiveIntent === "consultant" && (
						<ProjectTeamPicker
							value={primaryTeamId}
							onChange={setPrimaryTeamId}
						/>
					)}

					<div className="flex justify-end border-t border-border pt-6">
						<button
							type="button"
							onClick={() => void handleSubmit()}
							disabled={isCreating}
							className="app-cta inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60"
						>
							{isCreating && <Loader2 className="h-4 w-4 animate-spin" />}
							{isCreating ? "Creating…" : "Create project"}
						</button>
					</div>
				</div>
			</main>
		</div>
	);
}

function IntentButton({
	selected,
	title,
	description,
	onClick,
}: {
	selected: boolean;
	title: string;
	description: string;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			aria-pressed={selected}
			className={`rounded-lg border px-4 py-3 text-left transition ${
				selected
					? "border-primary bg-primary/10"
					: "border-border hover:border-primary/50 hover:bg-muted/60"
			}`}
		>
			<span className="block text-sm font-semibold text-foreground">
				{title}
			</span>
			<span className="mt-1 block text-xs text-muted-foreground">
				{description}
			</span>
		</button>
	);
}
