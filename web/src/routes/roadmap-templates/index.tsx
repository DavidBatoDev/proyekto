import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
	AppWindow,
	ArrowUpRight,
	BrainCircuit,
	ChevronLeft,
	ChevronRight,
	Cloud,
	Code2,
	Database,
	FlaskConical,
	GraduationCap,
	Handshake,
	HeartPulse,
	Home,
	Landmark,
	LayoutTemplate,
	type LucideIcon,
	Megaphone,
	Palette,
	Rocket,
	Search,
	Settings2,
	ShieldCheck,
	ShoppingBag,
	SlidersHorizontal,
	Smartphone,
	Sparkles,
	Star,
	UsersRound,
	Workflow,
	X,
} from "lucide-react";
import { useRef, useState } from "react";
import { getRoadmapTemplateCategories, getRoadmapTemplates } from "@/api";
import { RoadmapPreviewCard } from "@/components/home/RoadmapPreviewCard";
import { MarketplaceRoadmapPrompt } from "@/components/roadmap/templates/MarketplaceRoadmapPrompt";

const TEMPLATE_SKELETON_IDS = [
	"template-skeleton-1",
	"template-skeleton-2",
	"template-skeleton-3",
	"template-skeleton-4",
	"template-skeleton-5",
	"template-skeleton-6",
	"template-skeleton-7",
	"template-skeleton-8",
];

const CATEGORY_ICONS: Record<string, LucideIcon> = {
	saas: Sparkles,
	"mobile-app-development": Smartphone,
	"web-development": Code2,
	marketing: Megaphone,
	research: FlaskConical,
	"startup-launch": Rocket,
	"product-management": LayoutTemplate,
	"ux-ui-design": Palette,
	"ai-machine-learning": BrainCircuit,
	"data-engineering": Database,
	devops: Workflow,
	"cloud-infrastructure": Cloud,
	cybersecurity: ShieldCheck,
	"e-commerce": ShoppingBag,
	education: GraduationCap,
	healthcare: HeartPulse,
	finance: Landmark,
	"human-resources": UsersRound,
	sales: Handshake,
	operations: Settings2,
};

const CATEGORY_TONES = [
	"bg-violet-500/15 text-violet-600 dark:text-violet-300",
	"bg-cyan-500/15 text-cyan-700 dark:text-cyan-300",
	"bg-blue-500/15 text-blue-700 dark:text-blue-300",
	"bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300",
	"bg-amber-500/15 text-amber-700 dark:text-amber-300",
	"bg-rose-500/15 text-rose-700 dark:text-rose-300",
	"bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
	"bg-indigo-500/15 text-indigo-700 dark:text-indigo-300",
];

const SCHEDULE_OPTIONS = [
	{ value: "", label: "All plans" },
	{ value: "long_term", label: "Programs" },
	{ value: "short_learning", label: "Learning" },
];

export const Route = createFileRoute("/roadmap-templates/")({
	component: RoadmapTemplateCatalogPage,
});

export function RoadmapTemplateCatalogPage() {
	const [search, setSearch] = useState("");
	const [category, setCategory] = useState("");
	const [tags, setTags] = useState("");
	const [difficulty, setDifficulty] = useState("");
	const [scheduleKind, setScheduleKind] = useState("");
	const [sort, setSort] = useState<
		"featured" | "newest" | "popular" | "rating"
	>("featured");
	const categoryRailRef = useRef<HTMLDivElement>(null);
	const categoriesQuery = useQuery({
		queryKey: ["roadmap-template-categories"],
		queryFn: getRoadmapTemplateCategories,
		staleTime: 5 * 60 * 1000,
	});
	const templatesQuery = useInfiniteQuery({
		queryKey: [
			"roadmap-templates",
			{ search, category, tags, difficulty, scheduleKind, sort },
		],
		initialPageParam: undefined as string | undefined,
		queryFn: ({ pageParam }) =>
			getRoadmapTemplates({
				search: search || undefined,
				category: category || undefined,
				tags: tags || undefined,
				difficulty:
					(difficulty as "beginner" | "intermediate" | "advanced") || undefined,
				schedule_kind:
					(scheduleKind as "long_term" | "short_learning") || undefined,
				sort,
				cursor: pageParam,
				limit: 24,
			}),
		getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
	});

	const categories = categoriesQuery.data ?? [];
	const templates =
		templatesQuery.data?.pages.flatMap((page) => page.items) ?? [];
	const activeCategoryName =
		categories.find((item) => item.slug === category)?.name ??
		"All roadmap templates";
	const resultCount = templates.length;
	const hasActiveFilters = Boolean(
		search ||
			category ||
			tags ||
			difficulty ||
			scheduleKind ||
			sort !== "featured",
	);

	const clearFilters = () => {
		setSearch("");
		setCategory("");
		setTags("");
		setDifficulty("");
		setScheduleKind("");
		setSort("featured");
	};

	const scrollCategories = (direction: -1 | 1) => {
		categoryRailRef.current?.scrollBy({
			left: direction * 440,
			behavior: "smooth",
		});
	};

	return (
		<main className="app-shell-bg min-h-screen text-foreground">
			<section className="relative isolate overflow-hidden border-b border-border">
				<div className="mx-auto max-w-[1600px] px-4 pb-8 pt-8 sm:px-6 sm:pb-10 sm:pt-10 lg:px-8">
					<div className="flex justify-center gap-2">
						<Link
							to="/"
							className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background/80 px-3 py-1.5 text-sm font-medium text-muted-foreground backdrop-blur transition-colors hover:text-foreground"
						>
							<Home className="h-3.5 w-3.5" />
							Home
						</Link>
						<span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1.5 text-sm font-semibold text-primary">
							<LayoutTemplate className="h-3.5 w-3.5" />
							Templates
						</span>
					</div>

					<div className="mx-auto mt-5 max-w-4xl text-center">
						<p className="text-xs font-bold uppercase tracking-[0.2em] text-primary">
							Template marketplace
						</p>
						<h1 className="mt-2 text-4xl font-bold tracking-tight sm:text-5xl">
							What will you build next?
						</h1>
						<p className="mx-auto mt-3 max-w-2xl text-sm text-muted-foreground sm:text-base">
							Describe your idea for an AI-assisted roadmap, or start from a
							free, curated template.
						</p>
					</div>

					<MarketplaceRoadmapPrompt />

					<div className="relative mt-8">
						<button
							type="button"
							onClick={() => scrollCategories(-1)}
							aria-label="Scroll categories left"
							className="absolute left-0 top-5 z-10 hidden h-10 w-10 items-center justify-center rounded-full border border-border bg-card text-foreground shadow-(--app-shadow-sm) transition-colors hover:bg-muted sm:flex"
						>
							<ChevronLeft className="h-5 w-5" />
						</button>
						<div
							ref={categoryRailRef}
							className="flex gap-2 overflow-x-auto px-0 pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:px-12"
						>
							<button
								type="button"
								onClick={() => setCategory("")}
								aria-pressed={!category}
								className="group flex w-[92px] shrink-0 flex-col items-center gap-2 rounded-2xl px-2 py-2 text-center"
							>
								<span
									className={`flex h-12 w-12 items-center justify-center rounded-2xl transition-all ${
										!category
											? "bg-primary text-primary-foreground shadow-(--app-shadow-md)"
											: "bg-muted text-muted-foreground group-hover:text-foreground"
									}`}
								>
									<LayoutTemplate className="h-6 w-6" />
								</span>
								<span className="text-xs font-semibold">All templates</span>
							</button>
							{categories.map((item, index) => {
								const Icon = CATEGORY_ICONS[item.slug] ?? AppWindow;
								const selected = category === item.slug;
								return (
									<button
										key={item.id}
										type="button"
										onClick={() => setCategory(item.slug)}
										aria-pressed={selected}
										className="group flex w-[92px] shrink-0 flex-col items-center gap-2 rounded-2xl px-2 py-2 text-center"
									>
										<span
											className={`flex h-12 w-12 items-center justify-center rounded-2xl transition-all ${
												selected
													? "bg-primary text-primary-foreground shadow-(--app-shadow-md)"
													: CATEGORY_TONES[index % CATEGORY_TONES.length]
											}`}
										>
											<Icon className="h-6 w-6" />
										</span>
										<span className="line-clamp-2 text-xs font-semibold leading-4">
											{item.name}
										</span>
									</button>
								);
							})}
						</div>
						<button
							type="button"
							onClick={() => scrollCategories(1)}
							aria-label="Scroll categories right"
							className="absolute right-0 top-5 z-10 hidden h-10 w-10 items-center justify-center rounded-full border border-border bg-card text-foreground shadow-(--app-shadow-sm) transition-colors hover:bg-muted sm:flex"
						>
							<ChevronRight className="h-5 w-5" />
						</button>
					</div>
				</div>
			</section>

			<section className="mx-auto max-w-[1600px] px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
				<div className="flex flex-wrap items-end justify-between gap-4">
					<div>
						<div className="flex items-center gap-2">
							<h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
								{activeCategoryName}
							</h2>
							{!templatesQuery.isPending ? (
								<span className="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground">
									{resultCount}
								</span>
							) : null}
						</div>
						<p className="mt-1 text-sm text-muted-foreground">
							Choose a plan, set your start date, and make it your own.
						</p>
					</div>
				</div>

				<div className="mt-5 flex flex-col gap-3 rounded-2xl border border-border bg-card p-3 text-card-foreground shadow-(--app-shadow-sm) xl:flex-row xl:items-center">
					<div className="flex items-center gap-2 px-1 text-sm font-semibold">
						<SlidersHorizontal className="h-4 w-4 text-primary" />
						Filters
					</div>
					<div className="grid flex-1 gap-2 sm:grid-cols-2 xl:flex">
						<label className="relative">
							<span className="sr-only">Search roadmap templates</span>
							<Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
							<input
								type="search"
								value={search}
								onChange={(event) => setSearch(event.target.value)}
								placeholder="Search templates"
								className="h-10 w-full rounded-xl border border-input bg-background pl-9 pr-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary [&::-webkit-search-cancel-button]:appearance-none xl:w-52"
							/>
						</label>
						<input
							value={tags}
							onChange={(event) => setTags(event.target.value)}
							placeholder="Filter by tags"
							className="h-10 rounded-xl border border-input bg-background px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary xl:w-52"
						/>
						<select
							value={difficulty}
							onChange={(event) => setDifficulty(event.target.value)}
							aria-label="Difficulty"
							className="h-10 rounded-xl border border-input bg-background px-3 text-sm text-foreground xl:w-40"
						>
							<option value="">All levels</option>
							<option value="beginner">Beginner</option>
							<option value="intermediate">Intermediate</option>
							<option value="advanced">Advanced</option>
						</select>
						<select
							value={sort}
							onChange={(event) => setSort(event.target.value as typeof sort)}
							aria-label="Sort templates"
							className="h-10 rounded-xl border border-input bg-background px-3 text-sm text-foreground xl:w-40"
						>
							<option value="featured">Featured</option>
							<option value="newest">Newest</option>
							<option value="popular">Most used</option>
							<option value="rating">Top rated</option>
						</select>
					</div>
					<div className="flex flex-wrap items-center gap-1 rounded-xl bg-muted p-1">
						{SCHEDULE_OPTIONS.map((item) => (
							<button
								key={item.value}
								type="button"
								onClick={() => setScheduleKind(item.value)}
								className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
									scheduleKind === item.value
										? "bg-background text-foreground shadow-(--app-shadow-sm)"
										: "text-muted-foreground hover:text-foreground"
								}`}
							>
								{item.label}
							</button>
						))}
					</div>
					{hasActiveFilters ? (
						<button
							type="button"
							onClick={clearFilters}
							className="inline-flex h-10 items-center justify-center gap-1 rounded-xl px-3 text-sm font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
						>
							<X className="h-4 w-4" />
							Clear
						</button>
					) : null}
				</div>

				{templatesQuery.isPending ? (
					<div className="mt-5 grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
						{TEMPLATE_SKELETON_IDS.map((skeletonId) => (
							<div
								key={skeletonId}
								className="h-[420px] animate-pulse rounded-2xl border border-border bg-card"
							/>
						))}
					</div>
				) : templatesQuery.isError ? (
					<div className="mt-5 rounded-xl border border-destructive/30 bg-destructive/10 p-6 text-destructive">
						Could not load the template catalog.
					</div>
				) : templates.length === 0 ? (
					<div className="mt-5 rounded-xl border border-dashed border-border bg-card p-12 text-center text-muted-foreground">
						<p className="font-semibold text-foreground">
							No templates match those filters
						</p>
						<p className="mt-1 text-sm">
							Try another category or clear your filters.
						</p>
						<button
							type="button"
							onClick={clearFilters}
							className="mt-4 rounded-xl bg-foreground px-4 py-2 text-sm font-bold text-background"
						>
							Show all templates
						</button>
					</div>
				) : (
					<>
						<div className="mt-5 grid items-start gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
							{templates.map((template) => (
								<RoadmapPreviewCard
									key={template.id}
									variant="template"
									interactive
									title={template.title}
									description={template.summary}
									epics={template.preview.epics}
									status={
										<span className="rounded-full bg-muted px-2 py-1 text-[10px] font-bold uppercase text-muted-foreground">
											{template.difficulty}
										</span>
									}
									footerLeading={
										<span className="inline-flex min-w-0 items-center gap-1 truncate text-xs text-muted-foreground">
											<Star className="h-3 w-3 shrink-0 fill-amber-400 text-amber-400" />
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
											onClick={(event) => event.stopPropagation()}
											className="inline-flex shrink-0 items-center gap-1 rounded-full bg-foreground px-3 py-1 text-xs font-bold text-background transition-opacity hover:opacity-85"
										>
											Open
											<ArrowUpRight className="h-3 w-3" />
										</Link>
									}
								/>
							))}
						</div>
						{templatesQuery.hasNextPage ? (
							<div className="mt-8 flex justify-center">
								<button
									type="button"
									onClick={() => templatesQuery.fetchNextPage()}
									disabled={templatesQuery.isFetchingNextPage}
									className="rounded-xl border border-border bg-card px-5 py-2.5 text-sm font-bold text-card-foreground shadow-(--app-shadow-sm) transition-colors hover:bg-muted disabled:cursor-wait disabled:opacity-60"
								>
									{templatesQuery.isFetchingNextPage
										? "Loading templates..."
										: "Load more templates"}
								</button>
							</div>
						) : null}
					</>
				)}
			</section>
		</main>
	);
}
