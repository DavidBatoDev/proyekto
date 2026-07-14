import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { getRoadmapTemplates } from "@/api";
import { RoadmapPreviewCard } from "@/components/home/RoadmapPreviewCard";
import { RoadmapBuilder } from "@/components/roadmap/RoadmapBuilder";

export const Route = createFileRoute("/project/$projectId/roadmap/create")({
	validateSearch: (search: Record<string, unknown>): { draftId?: string } => ({
		draftId: typeof search.draftId === "string" ? search.draftId : undefined,
	}),
	component: ProjectRoadmapCreatePage,
});

function ProjectRoadmapCreatePage() {
	const { projectId } = Route.useParams();
	const { draftId } = Route.useSearch();
	const [mode, setMode] = useState<"builder" | "template">("builder");
	const templatesQuery = useQuery({
		queryKey: ["roadmap-templates", "create-picker"],
		queryFn: () => getRoadmapTemplates({ sort: "featured", limit: 6 }),
		enabled: mode === "template",
	});

	return (
		<div className="min-h-screen bg-background pt-20">
			<div className="mx-auto flex max-w-6xl gap-2 px-4 pt-4">
				<button
					type="button"
					onClick={() => setMode("builder")}
					className={`rounded-full px-4 py-2 text-sm font-semibold ${mode === "builder" ? "bg-slate-950 text-white" : "border border-slate-200 bg-white text-slate-600"}`}
				>
					Blank or AI-assisted
				</button>
				<button
					type="button"
					onClick={() => setMode("template")}
					className={`rounded-full px-4 py-2 text-sm font-semibold ${mode === "template" ? "bg-slate-950 text-white" : "border border-slate-200 bg-white text-slate-600"}`}
				>
					Start from a template
				</button>
			</div>
			{mode === "builder" ? (
				<RoadmapBuilder projectId={projectId} draftId={draftId} embedded />
			) : (
				<div className="mx-auto max-w-6xl px-4 py-8">
					<h1 className="text-3xl font-bold">Choose a roadmap template</h1>
					<p className="mt-2 text-slate-600">
						The selected plan will{" "}
						{projectId === "n"
							? "start as a standalone roadmap"
							: "be attached to this project"}
						.
					</p>
					{templatesQuery.isPending ? (
						<p className="py-16 text-center text-slate-500">
							Loading templates…
						</p>
					) : (
						<div className="mt-6 grid items-start gap-5 sm:grid-cols-2 lg:grid-cols-3">
							{(templatesQuery.data?.items ?? []).map((template) => (
								<RoadmapPreviewCard
									key={template.id}
									variant="template"
									title={template.title}
									description={template.summary}
									epics={template.preview.epics}
									status={null}
									footerLeading={
										<span className="text-xs text-slate-500">
											{template.category.name}
										</span>
									}
									footerAction={
										<Link
											to="/roadmap-templates/$slug"
											params={{ slug: template.slug }}
											onClick={() =>
												localStorage.setItem(
													"proyekto_template_intent",
													JSON.stringify({
														slug: template.slug,
														project_id: projectId === "n" ? null : projectId,
														start_date: new Date().toISOString().slice(0, 10),
													}),
												)
											}
											className="rounded-full bg-slate-950 px-3 py-1 text-xs font-bold text-white"
										>
											Choose
										</Link>
									}
								/>
							))}
						</div>
					)}
					<Link
						to="/roadmap-templates"
						className="mt-8 inline-block text-sm font-semibold text-primary"
					>
						Browse all templates →
					</Link>
				</div>
			)}
		</div>
	);
}
