import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { motion, useInView } from "framer-motion";
import { ArrowRight, Sparkles } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { getFeaturedRoadmapTemplates } from "@/api";
import { TemplateEntryCard } from "./TemplateEntryCard";

const TEMPLATE_SKELETON_IDS = [
	"template-skeleton-1",
	"template-skeleton-2",
	"template-skeleton-3",
	"template-skeleton-4",
	"template-skeleton-5",
	"template-skeleton-6",
];

export const TemplatesSection = ({
	isActive: _isActive,
}: {
	isActive?: boolean;
} = {}) => {
	const [activeCategory, setActiveCategory] = useState("all");
	const ref = useRef<HTMLDivElement>(null);
	const inView = useInView(ref, { once: true, margin: "400px" });
	const templatesQuery = useQuery({
		queryKey: ["roadmap-templates", "landing-featured"],
		queryFn: getFeaturedRoadmapTemplates,
		enabled: inView,
		staleTime: 10 * 60 * 1000,
		gcTime: 30 * 60 * 1000,
		refetchOnWindowFocus: false,
	});
	const templates = templatesQuery.data?.items ?? [];
	const categories = useMemo(
		() => [
			{ slug: "all", name: "All" },
			...Array.from(
				new Map(
					templates.map((template) => [
						template.category.slug,
						template.category,
					]),
				).values(),
			),
		],
		[templates],
	);
	const filteredTemplates =
		activeCategory === "all"
			? templates
			: templates.filter(
					(template) => template.category.slug === activeCategory,
				);

	return (
		// biome-ignore lint/correctness/useUniqueElementIds: This is the stable landing-page anchor used by navigation links.
		<section id="templates" className="relative py-6">
			<motion.div
				className="pointer-events-none absolute inset-x-0 bottom-0 z-0 h-[62%] bg-[radial-gradient(75%_95%_at_50%_100%,rgba(37,99,235,0.26),rgba(37,99,235,0)_72%)]"
				animate={{ opacity: [0.7, 1, 0.7] }}
				transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
			/>
			<motion.div
				className="pointer-events-none absolute -left-28 bottom-10 z-0 h-64 w-64 rounded-full bg-blue-400/30 blur-3xl"
				animate={{ scale: [1, 1.14, 1], opacity: [0.3, 0.45, 0.3] }}
				transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
			/>
			<motion.div
				className="pointer-events-none absolute left-1/2 bottom-8 z-0 h-80 w-80 -translate-x-1/2 rounded-full bg-blue-500/22 blur-3xl"
				animate={{ scale: [1, 1.1, 1], opacity: [0.22, 0.35, 0.22] }}
				transition={{
					duration: 7,
					repeat: Infinity,
					ease: "easeInOut",
					delay: 1,
				}}
			/>
			<div ref={ref} className="max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-10">
				<motion.div
					className="relative z-10 mb-6"
					initial={{ opacity: 0, y: 20 }}
					animate={inView ? { opacity: 1, y: 0 } : {}}
					transition={{ duration: 0.5 }}
				>
					<div className="pr-0 lg:pr-[470px]">
						<p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
							Roadmap Templates
						</p>
						<h2 className="mt-2 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
							Start your project with just a few clicks
						</h2>
						<p className="mt-2 max-w-2xl text-sm text-muted-foreground sm:text-base">
							Choose a versioned template and create an independent roadmap with
							dates that start when you do.
						</p>
					</div>
					<div className="mt-4 flex flex-wrap items-center gap-2 lg:absolute lg:right-0 lg:top-0 lg:mt-0">
						<div className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-xs font-medium text-muted-foreground shadow-(--app-shadow-sm)">
							<Sparkles className="h-4 w-4 text-cyan-600" />
							Free execution-ready plans
						</div>
						<Link
							to="/roadmap-templates"
							className="inline-flex items-center gap-2 rounded-xl bg-foreground px-4 py-2 text-xs font-semibold text-background shadow-(--app-shadow-sm) transition-opacity hover:opacity-85"
						>
							View all templates
							<ArrowRight className="h-4 w-4" />
						</Link>
					</div>
				</motion.div>

				{templates.length > 0 ? (
					<motion.div
						className="relative z-10 mb-6 flex flex-wrap gap-2"
						initial={{ opacity: 0, y: 14 }}
						animate={inView ? { opacity: 1, y: 0 } : {}}
					>
						{categories.map((category) => (
							<button
								key={category.slug}
								type="button"
								onClick={() => setActiveCategory(category.slug)}
								className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-all ${category.slug === activeCategory ? "border-foreground bg-foreground text-background" : "border-border bg-card text-muted-foreground hover:border-input hover:text-foreground"}`}
							>
								{category.name}
							</button>
						))}
					</motion.div>
				) : null}

				<div className="relative z-10 rounded-3xl bg-card/55 p-1 backdrop-blur-[1px]">
					{templatesQuery.isPending ? (
						<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
							<span className="sr-only">Loading templates</span>
							{TEMPLATE_SKELETON_IDS.map((skeletonId) => (
								<div
									key={skeletonId}
									className="h-[440px] animate-pulse rounded-2xl border border-border bg-card/80"
								/>
							))}
						</div>
					) : templatesQuery.isError ? (
						<div className="rounded-2xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
							The template library is temporarily unavailable. Please try again
							shortly.
						</div>
					) : (
						<div className="grid items-start gap-x-3 gap-y-7 sm:grid-cols-2 xl:grid-cols-3">
							{filteredTemplates.map((template, index) => (
								<TemplateEntryCard
									key={template.id}
									template={template}
									index={index}
								/>
							))}
						</div>
					)}
				</div>
			</div>
		</section>
	);
};
