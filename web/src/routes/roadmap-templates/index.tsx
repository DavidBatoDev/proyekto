import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Search, Star } from "lucide-react";
import { useState } from "react";
import { getRoadmapTemplateCategories, getRoadmapTemplates } from "@/api";
import { RoadmapPreviewCard } from "@/components/home/RoadmapPreviewCard";

const TEMPLATE_SKELETON_IDS = [
	"template-skeleton-1",
	"template-skeleton-2",
	"template-skeleton-3",
	"template-skeleton-4",
	"template-skeleton-5",
	"template-skeleton-6",
];

export const Route = createFileRoute("/roadmap-templates/")({
	component: RoadmapTemplateCatalogPage,
});

function RoadmapTemplateCatalogPage() {
	const [search, setSearch] = useState("");
	const [category, setCategory] = useState("");
	const [tags, setTags] = useState("");
	const [difficulty, setDifficulty] = useState("");
	const [scheduleKind, setScheduleKind] = useState("");
	const [sort, setSort] = useState<
		"featured" | "newest" | "popular" | "rating"
	>("featured");
	const categoriesQuery = useQuery({
		queryKey: ["roadmap-template-categories"],
		queryFn: getRoadmapTemplateCategories,
		staleTime: 5 * 60 * 1000,
	});
	const templatesQuery = useQuery({
		queryKey: [
			"roadmap-templates",
			{ search, category, tags, difficulty, scheduleKind, sort },
		],
		queryFn: () =>
			getRoadmapTemplates({
				search: search || undefined,
				category: category || undefined,
				tags: tags || undefined,
				difficulty:
					(difficulty as "beginner" | "intermediate" | "advanced") || undefined,
				schedule_kind:
					(scheduleKind as "long_term" | "short_learning") || undefined,
				sort,
				limit: 50,
			}),
	});

	return (
		<main className="min-h-screen bg-background pt-24 text-foreground">
			<div className="mx-auto max-w-7xl px-4 pb-20 sm:px-6">
				<div className="mb-8 max-w-3xl">
					<p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">
						Template marketplace
					</p>
					<h1 className="mt-2 text-4xl font-bold tracking-tight">
						Start with a roadmap that already knows the terrain
					</h1>
					<p className="mt-3 text-muted-foreground">
						Browse free, versioned plans from Proyekto and verified consultants.
						Every copy is yours to edit.
					</p>
				</div>

				<div className="mb-8 grid gap-3 rounded-2xl border border-border bg-card p-4 text-card-foreground shadow-sm md:grid-cols-6">
					<label className="relative md:col-span-2">
						<Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
						<input
							value={search}
							onChange={(event) => setSearch(event.target.value)}
							placeholder="Search templates"
							className="h-10 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary"
						/>
					</label>
					<select
						value={category}
						onChange={(event) => setCategory(event.target.value)}
						className="h-10 rounded-lg border border-input bg-background px-3 text-sm text-foreground"
					>
						<option value="">All categories</option>
						{(categoriesQuery.data ?? []).map((item) => (
							<option key={item.id} value={item.slug}>
								{item.name}
							</option>
						))}
					</select>
					<input
						value={tags}
						onChange={(event) => setTags(event.target.value)}
						placeholder="Tags (comma-separated)"
						className="h-10 rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary"
					/>
					<select
						value={difficulty}
						onChange={(event) => setDifficulty(event.target.value)}
						className="h-10 rounded-lg border border-input bg-background px-3 text-sm text-foreground"
					>
						<option value="">All levels</option>
						<option value="beginner">Beginner</option>
						<option value="intermediate">Intermediate</option>
						<option value="advanced">Advanced</option>
					</select>
					<select
						value={sort}
						onChange={(event) => setSort(event.target.value as typeof sort)}
						className="h-10 rounded-lg border border-input bg-background px-3 text-sm text-foreground"
					>
						<option value="featured">Featured</option>
						<option value="newest">Newest</option>
						<option value="popular">Most used</option>
						<option value="rating">Top rated</option>
					</select>
					<div className="flex gap-2 md:col-span-6">
						{[
							{ value: "", label: "All schedules" },
							{ value: "long_term", label: "Programs" },
							{ value: "short_learning", label: "Learning plans" },
						].map((item) => (
							<button
								key={item.value}
								type="button"
								onClick={() => setScheduleKind(item.value)}
								className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${scheduleKind === item.value ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:text-foreground"}`}
							>
								{item.label}
							</button>
						))}
					</div>
				</div>

				{templatesQuery.isPending ? (
					<div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
						{TEMPLATE_SKELETON_IDS.map((skeletonId) => (
							<div
								key={skeletonId}
								className="h-[420px] animate-pulse rounded-2xl border border-border bg-card"
							/>
						))}
					</div>
				) : templatesQuery.isError ? (
					<div className="rounded-xl border border-destructive/30 bg-destructive/10 p-6 text-destructive">
						Could not load the template catalog.
					</div>
				) : templatesQuery.data.items.length === 0 ? (
					<div className="rounded-xl border border-dashed border-border bg-card p-12 text-center text-muted-foreground">
						No templates match those filters.
					</div>
				) : (
					<div className="grid items-start gap-5 sm:grid-cols-2 lg:grid-cols-3">
						{templatesQuery.data.items.map((template) => (
							<RoadmapPreviewCard
								key={template.id}
								variant="template"
								title={template.title}
								description={template.summary}
								epics={template.preview.epics}
								status={
									<span className="rounded-full bg-muted px-2 py-1 text-[10px] font-bold uppercase text-muted-foreground">
										{template.difficulty}
									</span>
								}
								footerLeading={
									<span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
										<Star className="h-3 w-3 fill-amber-400 text-amber-400" />
										{template.rating_count
											? template.rating_average.toFixed(1)
											: "New"}{" "}
										· {template.category.name}
									</span>
								}
								footerAction={
									<Link
										to="/roadmap-templates/$slug"
										params={{ slug: template.slug }}
										className="rounded-full bg-foreground px-3 py-1 text-xs font-bold text-background transition-opacity hover:opacity-85"
									>
										View template
									</Link>
								}
							/>
						))}
					</div>
				)}
			</div>
		</main>
	);
}
