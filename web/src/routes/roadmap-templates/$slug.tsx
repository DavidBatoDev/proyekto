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
import { RoadmapPreviewCard } from "@/components/home/RoadmapPreviewCard";
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
			<main className="min-h-screen bg-slate-50 pt-32 text-center text-slate-500">
				Loading template…
			</main>
		);
	if (templateQuery.isError || !templateQuery.data)
		return (
			<main className="min-h-screen bg-slate-50 pt-32 text-center">
				<p className="text-red-600">Template not found.</p>
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
		<main className="min-h-screen bg-slate-50 pt-24 text-slate-950">
			<div className="mx-auto grid max-w-7xl gap-8 px-4 pb-20 lg:grid-cols-[1fr_360px]">
				<div>
					<Link
						to="/roadmap-templates"
						className="text-sm font-semibold text-primary"
					>
						← Template marketplace
					</Link>
					<div className="mt-6 flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-500">
						<span className="rounded-full bg-blue-50 px-3 py-1 text-blue-700">
							{template.category.name}
						</span>
						<span>{template.difficulty}</span>
						<span>·</span>
						<span>{template.schedule.estimated_duration_days} days</span>
					</div>
					<h1 className="mt-3 text-4xl font-bold tracking-tight">
						{template.title}
					</h1>
					<p className="mt-4 max-w-3xl text-lg leading-8 text-slate-600">
						{template.summary}
					</p>
					<div className="mt-5 flex flex-wrap gap-5 text-sm text-slate-600">
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
					</div>
					{template.tags.length > 0 ? (
						<div className="mt-5 flex flex-wrap gap-2">
							{template.tags.map((tag) => (
								<span
									key={tag.slug}
									className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600"
								>
									#{tag.name}
								</span>
							))}
						</div>
					) : null}

					<div className="mt-10 max-w-2xl">
						<RoadmapPreviewCard
							variant="template"
							title={template.title}
							description={`${template.hierarchy_counts.epics} epics · ${template.hierarchy_counts.features} features · ${template.hierarchy_counts.tasks} tasks`}
							epics={template.preview.epics}
							status={null}
							footerAction={null}
						/>
					</div>

					<section className="mt-10">
						<h2 className="flex items-center gap-2 text-2xl font-bold">
							<Layers3 className="h-5 w-5" />
							Roadmap outline
						</h2>
						<div className="mt-5">
							<TemplateRoadmapFlow
								templateId={template.id}
								content={template.content}
								startDate={startDate}
							/>
						</div>
					</section>
				</div>

				<aside className="lg:pt-20">
					<div className="sticky top-24 rounded-2xl border border-slate-200 bg-white p-5 shadow-lg">
						<h2 className="text-lg font-bold">Use this template</h2>
						<p className="mt-1 text-sm text-slate-500">
							Creates an independent copy pinned to version{" "}
							{template.version_number}.
						</p>
						<label className="mt-5 block text-xs font-bold uppercase tracking-wide text-slate-500">
							Start date
							<input
								type="date"
								value={startDate}
								onChange={(event) => {
									setStartDate(event.target.value);
									idempotencyKeyRef.current = crypto.randomUUID();
								}}
								className="mt-2 h-11 w-full rounded-lg border border-slate-200 px-3 text-sm font-normal text-slate-900"
							/>
						</label>
						<label className="mt-4 block text-xs font-bold uppercase tracking-wide text-slate-500">
							Attach to project (optional)
							<select
								value={projectId}
								onChange={(event) => {
									setProjectId(event.target.value);
									idempotencyKeyRef.current = crypto.randomUUID();
								}}
								disabled={!isAuthenticated || projectsQuery.isPending}
								className="mt-2 h-11 w-full rounded-lg border border-slate-200 px-3 text-sm font-normal text-slate-900"
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
							<p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">
								{error}
							</p>
						) : null}
						<button
							type="button"
							onClick={handleUse}
							disabled={instantiateMutation.isPending || !startDate}
							className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-slate-950 font-bold text-white disabled:opacity-50"
						>
							<Calendar className="h-4 w-4" />
							{instantiateMutation.isPending
								? "Creating…"
								: isAuthenticated
									? "Create roadmap"
									: "Sign in to use"}
						</button>

						{isAuthenticated ? (
							<div className="mt-6 border-t border-slate-100 pt-5">
								<p className="text-xs font-bold uppercase text-slate-500">
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
												className={`h-5 w-5 ${value <= rating ? "fill-amber-400 text-amber-400" : "text-slate-300"}`}
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
									className="mt-5 inline-flex items-center gap-1 text-xs font-semibold text-slate-500"
								>
									<Flag className="h-3 w-3" />
									Report template
								</button>
								{reportOpen ? (
									<div className="mt-3">
										<textarea
											value={reportDetails}
											onChange={(event) => setReportDetails(event.target.value)}
											placeholder="Tell moderators what is wrong"
											className="min-h-24 w-full rounded-lg border border-slate-200 p-3 text-sm"
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
											className="mt-2 rounded-lg bg-slate-100 px-3 py-2 text-xs font-bold disabled:opacity-50"
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
		</main>
	);
}
