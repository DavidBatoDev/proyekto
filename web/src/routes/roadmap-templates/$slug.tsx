import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Calendar, Copy, Flag, Layers3, Star } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
	getRoadmapTemplate,
	instantiateRoadmapTemplate,
	rateRoadmapTemplate,
	recordRoadmapTemplateView,
	reportRoadmapTemplate,
} from "@/api";
import { TemplateRoadmapFlow } from "@/components/roadmap/templates/TemplateRoadmapFlow";
import { projectService } from "@/services/project.service";
import { useAuthStore } from "@/stores/authStore";

export const Route = createFileRoute("/roadmap-templates/$slug")({
	component: RoadmapTemplateDetailPage,
});

function today() {
	const date = new Date();
	return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
		.toISOString()
		.slice(0, 10);
}

function RoadmapTemplateDetailPage() {
	const { slug } = Route.useParams();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
	const [projectId, setProjectId] = useState("");
	const [startDate, setStartDate] = useState(today());
	const [error, setError] = useState<string | null>(null);
	const [rating, setRating] = useState(5);
	const [reportOpen, setReportOpen] = useState(false);
	const [reportDetails, setReportDetails] = useState("");
	const idempotencyKeyRef = useRef(crypto.randomUUID());
	const templateQuery = useQuery({
		queryKey: ["roadmap-template", slug],
		queryFn: () => getRoadmapTemplate(slug),
	});
	const projectsQuery = useQuery({
		queryKey: ["roadmap-template-project-candidates"],
		queryFn: () => projectService.listRoadmapLinkCandidates(),
		enabled: isAuthenticated,
	});
	useEffect(() => {
		if (!templateQuery.data) return;
		void recordRoadmapTemplateView(templateQuery.data.id).catch(
			() => undefined,
		);
		try {
			const intent = JSON.parse(
				localStorage.getItem("proyekto_template_intent") ?? "null",
			) as {
				slug?: string;
				project_id?: string | null;
				start_date?: string;
			} | null;
			if (intent?.slug === slug) {
				setProjectId(intent.project_id ?? "");
				if (intent.start_date) setStartDate(intent.start_date);
			}
		} catch {
			localStorage.removeItem("proyekto_template_intent");
		}
	}, [templateQuery.data, slug]);

	const instantiateMutation = useMutation({
		mutationFn: async () => {
			if (!templateQuery.data) throw new Error("Template is not loaded");
			return instantiateRoadmapTemplate(templateQuery.data.id, {
				project_id: projectId || undefined,
				start_date: startDate,
				idempotency_key: idempotencyKeyRef.current,
				source_surface: "marketplace",
			});
		},
		onSuccess: (result) => {
			idempotencyKeyRef.current = crypto.randomUUID();
			localStorage.removeItem("proyekto_template_intent");
			void navigate({
				to: "/project/$projectId/roadmap/$roadmapId",
				params: {
					projectId: result.project_id ?? "n",
					roadmapId: result.roadmap_id,
				},
			});
		},
		onError: (cause) =>
			setError(
				cause instanceof Error ? cause.message : "Could not create roadmap",
			),
	});

	const handleUse = () => {
		if (!isAuthenticated) {
			localStorage.setItem(
				"proyekto_template_intent",
				JSON.stringify({
					slug,
					project_id: projectId || null,
					start_date: startDate,
				}),
			);
			void navigate({
				to: "/auth/login",
				search: { redirect: `/roadmap-templates/${slug}` },
			});
			return;
		}
		setError(null);
		instantiateMutation.mutate();
	};

	if (templateQuery.isPending)
		return (
			<main className="min-h-screen bg-background pt-16 text-center text-muted-foreground">
				Loading template…
			</main>
		);
	if (templateQuery.isError || !templateQuery.data)
		return (
			<main className="min-h-screen bg-background pt-16 text-center text-foreground">
				<p className="text-destructive">Template not found.</p>
				<Link
					to="/roadmap-templates"
					className="mt-4 inline-block text-primary"
				>
					Back to marketplace
				</Link>
			</main>
		);
	const template = templateQuery.data;

	return (
		<main className="min-h-screen bg-background pt-6 text-foreground sm:pt-8">
			<div className="relative mx-auto max-w-7xl px-4 pb-12 sm:px-6 lg:px-8">
				<Link
					to="/roadmap-templates"
					className="text-sm font-semibold text-primary"
				>
					← Template marketplace
				</Link>

				<div
					className={`mt-4 ${
						isAuthenticated
							? "grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-8"
							: "lg:pr-[392px]"
					}`}
				>
					<div>
						<div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-muted-foreground">
							<span className="rounded-full bg-primary/10 px-3 py-1 text-primary">
								{template.category.name}
							</span>
							<span>{template.difficulty}</span>
							<span>·</span>
							<span>{template.schedule.estimated_duration_days} days</span>
						</div>
						<h1 className="mt-2 text-4xl font-bold tracking-tight">
							{template.title}
						</h1>
						<p className="mt-3 max-w-3xl text-lg leading-7 text-muted-foreground">
							{template.summary}
						</p>
						<div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground">
							<span className="inline-flex items-center gap-1">
								<Star className="h-4 w-4 fill-amber-400 text-amber-400" />
								{template.rating_count
									? `${template.rating_average.toFixed(1)} (${template.rating_count})`
									: "No ratings yet"}
							</span>
							<span className="inline-flex items-center gap-1">
								<Copy className="h-4 w-4" />
								{template.duplicate_count} copies
							</span>
							<span>
								By{" "}
								{template.attribution.url ? (
									<a
										href={template.attribution.url}
										rel="noreferrer"
										target="_blank"
										className="text-primary underline"
									>
										{template.attribution.name}
									</a>
								) : (
									template.attribution.name
								)}
							</span>
							<span className="inline-flex items-center gap-1">
								<Layers3 className="h-4 w-4" />
								{template.hierarchy_counts.epics} epics ·{" "}
								{template.hierarchy_counts.features} features ·{" "}
								{template.hierarchy_counts.tasks} tasks
							</span>
						</div>
						{template.tags.length > 0 ? (
							<div className="mt-3 flex flex-wrap gap-2">
								{template.tags.map((tag) => (
									<span
										key={tag.slug}
										className="rounded-full bg-muted px-3 py-1 text-xs font-semibold text-muted-foreground"
									>
										#{tag.name}
									</span>
								))}
							</div>
						) : null}
					</div>

					<aside
						className={
							isAuthenticated
								? ""
								: "mt-6 lg:absolute lg:right-8 lg:top-10 lg:mt-0 lg:w-[360px]"
						}
					>
						<div className="rounded-2xl border border-border bg-card p-4 text-card-foreground shadow-(--app-shadow-lg)">
							<h2 className="text-base font-bold">Use this template</h2>
							<p className="mt-0.5 text-xs leading-5 text-muted-foreground">
								Creates an independent copy pinned to version{" "}
								{template.version_number}.
							</p>
							<label className="mt-3 block text-xs font-bold uppercase tracking-wide text-muted-foreground">
								Start date
								<input
									type="date"
									value={startDate}
									onChange={(event) => {
										setStartDate(event.target.value);
										idempotencyKeyRef.current = crypto.randomUUID();
									}}
									className="mt-1 h-9 w-full rounded-lg border border-input bg-background px-3 text-sm font-normal text-foreground"
								/>
							</label>
							<label className="mt-2.5 block text-xs font-bold uppercase tracking-wide text-muted-foreground">
								Attach to project (optional)
								<select
									value={projectId}
									onChange={(event) => {
										setProjectId(event.target.value);
										idempotencyKeyRef.current = crypto.randomUUID();
									}}
									disabled={!isAuthenticated || projectsQuery.isPending}
									className="mt-1 h-9 w-full rounded-lg border border-input bg-background px-3 text-sm font-normal text-foreground disabled:opacity-60"
								>
									<option value="">Standalone roadmap</option>
									{(projectsQuery.data ?? []).map((project) => (
										<option key={project.id} value={project.id}>
											{project.title}
										</option>
									))}
								</select>
							</label>
							{error ? (
								<p className="mt-3 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
									{error}
								</p>
							) : null}
							<button
								type="button"
								onClick={handleUse}
								disabled={instantiateMutation.isPending || !startDate}
								className="mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-foreground font-bold text-background transition-opacity hover:opacity-90 disabled:opacity-50"
							>
								<Calendar className="h-4 w-4" />
								{instantiateMutation.isPending
									? "Creating…"
									: isAuthenticated
										? "Create roadmap"
										: "Sign in to use"}
							</button>

							{isAuthenticated ? (
								<div className="mt-6 border-t border-border pt-5">
									<p className="text-xs font-bold uppercase text-muted-foreground">
										Rate after using
									</p>
									<div className="mt-2 flex gap-1">
										{[1, 2, 3, 4, 5].map((value) => (
											<button
												key={value}
												type="button"
												onClick={() => setRating(value)}
												aria-label={`Rate ${value} stars`}
											>
												<Star
													className={`h-5 w-5 ${value <= rating ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40"}`}
												/>
											</button>
										))}
									</div>
									<button
										type="button"
										onClick={() => {
											void rateRoadmapTemplate(template.id, rating)
												.then(() =>
													queryClient.invalidateQueries({
														queryKey: ["roadmap-template", slug],
													}),
												)
												.catch((cause) =>
													setError(
														cause instanceof Error
															? cause.message
															: "Could not rate",
													),
												);
										}}
										className="mt-2 text-xs font-bold text-primary"
									>
										Save rating
									</button>
								</div>
							) : null}
							{isAuthenticated ? (
								<>
									<button
										type="button"
										onClick={() => setReportOpen((open) => !open)}
										className="mt-5 inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground"
									>
										<Flag className="h-3 w-3" />
										Report template
									</button>
									{reportOpen ? (
										<div className="mt-3">
											<textarea
												value={reportDetails}
												onChange={(event) =>
													setReportDetails(event.target.value)
												}
												placeholder="Tell moderators what is wrong"
												className="min-h-24 w-full rounded-lg border border-input bg-background p-3 text-sm text-foreground placeholder:text-muted-foreground"
											/>
											<button
												type="button"
												disabled={reportDetails.trim().length < 10}
												onClick={() => {
													void reportRoadmapTemplate(
														template.id,
														"other",
														reportDetails,
													)
														.then(() => {
															setReportOpen(false);
															setReportDetails("");
														})
														.catch((cause) =>
															setError(
																cause instanceof Error
																	? cause.message
																	: "Could not report",
															),
														);
												}}
												className="mt-2 rounded-lg bg-muted px-3 py-2 text-xs font-bold text-foreground transition-colors hover:bg-accent disabled:opacity-50"
											>
												Submit report
											</button>
										</div>
									) : null}
								</>
							) : null}
						</div>
					</aside>
				</div>

				<section className="mt-8">
					<h2 className="flex items-center gap-2 text-2xl font-bold">
						<Layers3 className="h-5 w-5" />
						Roadmap outline
					</h2>
					<div className="mt-6">
						<TemplateRoadmapFlow
							templateId={template.id}
							content={template.content}
							startDate={startDate}
						/>
					</div>
				</section>
			</div>
		</main>
	);
}
