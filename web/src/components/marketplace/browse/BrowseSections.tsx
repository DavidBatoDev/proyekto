import { Link } from "@tanstack/react-router";
import { ChevronDown, FileText, LayoutTemplate, Users } from "lucide-react";
import { useId, useState } from "react";
import { CategoryArt } from "@/components/marketplace/category/CategoryArt";
import { useMarketplaceCategoryNavigationQuery } from "@/hooks/useMarketplaceTaxonomy";

/**
 * The explanatory band under the results.
 *
 * The reference puts a wall of category prose here; this says the one thing
 * that is actually different about Proyekto — a consultant leads the delivery
 * rather than being handed a task list — because that is the question somebody
 * scrolling past forty profiles is asking.
 */
export function BrowseAbout() {
	const responsibilities = [
		"Scoping the work and agreeing it in a contract",
		"Turning the brief into a roadmap of epics, features and tasks",
		"Assembling and briefing the delivery team",
		"Running the work and reporting on progress",
		"Accepting deliverables against agreed criteria",
	];

	return (
		<section className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
			<div className="grid items-center gap-10 lg:grid-cols-[1.2fr_1fr]">
				<div>
					<h2 className="text-[20px] font-semibold text-foreground">
						What a consultant does on Proyekto
					</h2>
					<p className="mt-3 max-w-2xl text-[13.5px] leading-relaxed text-muted-foreground">
						A consultant is the accountable lead on a piece of work. You
						describe the outcome you want; they scope it, price it, put the team
						together and stay responsible for delivering it. Every one of them
						is reviewed and verified before they can take work.
					</p>
					<p className="mt-3 text-[13.5px] text-muted-foreground">
						A consultant typically owns:
					</p>
					<ul className="mt-3 space-y-2">
						{responsibilities.map((item) => (
							<li
								key={item}
								className="flex items-start gap-2 text-[13px] text-muted-foreground"
							>
								<span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-primary" />
								{item}
							</li>
						))}
					</ul>
				</div>

				<CategoryArt
					slug="consultant-led-delivery"
					className="hidden w-full rounded-xl lg:block"
				/>
			</div>
		</section>
	);
}

/**
 * Specialities from the live taxonomy rather than a hand-written list of
 * keywords, so a chip can never point at a leaf page that no longer exists.
 */
export function RelatedSpecialities({
	categorySlug,
}: {
	categorySlug?: string;
}) {
	const navigationQuery = useMarketplaceCategoryNavigationQuery();
	const categories = navigationQuery.data ?? [];
	const focused = categorySlug
		? categories.filter((entry) => entry.slug === categorySlug)
		: categories;

	const chips = focused
		.flatMap((category) =>
			category.subcategories.slice(0, categorySlug ? 12 : 2).map((entry) => ({
				categorySlug: category.slug,
				subcategorySlug: entry.slug,
				name: entry.name,
			})),
		)
		.slice(0, 14);

	if (chips.length === 0) return null;

	return (
		<section className="mx-auto max-w-7xl px-4 pb-12 sm:px-6 lg:px-8">
			<h2 className="text-center text-[18px] font-semibold text-foreground">
				Explore related specialities
			</h2>
			<ul className="mt-5 flex flex-wrap justify-center gap-2">
				{chips.map((chip) => (
					<li key={`${chip.categorySlug}/${chip.subcategorySlug}`}>
						<Link
							to="/marketplace/category/$categorySlug/$subcategorySlug"
							params={{
								categorySlug: chip.categorySlug,
								subcategorySlug: chip.subcategorySlug,
							}}
							preload="intent"
							className="inline-block rounded-full border border-border bg-card px-3.5 py-1.5 text-[12.5px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
						>
							{chip.name}
						</Link>
					</li>
				))}
			</ul>
		</section>
	);
}

const FAQ_ENTRIES = [
	{
		question: "What does a consultant actually do here?",
		answer:
			"They lead the delivery. A consultant scopes the work with you, agrees it in a contract, builds the roadmap, assembles the team that executes it, and is accountable for what ships. You deal with one person rather than coordinating a group of freelancers yourself.",
	},
	{
		question: "How are consultants vetted?",
		answer:
			"Every consultant applies and is reviewed before they can take work. Only a verified enrolment can be listed here, appear in a category, or be named on a contract — and verification can be suspended, which removes them from these pages immediately.",
	},
	{
		question: "How does pricing work?",
		answer:
			"Consultants publish a service catalog with a starting price, and some also publish an hourly rate. Those are starting points, not quotes: the real scope, rate and dates are agreed with you and written into a contract before any work begins.",
	},
	{
		question: "What happens after I pick someone?",
		answer:
			"You post the project or message them from their profile. They scope it, you agree terms in a contract, and signing it activates the engagement. From then on the work lives in a shared workspace — roadmap, tasks, files and chat in one place.",
	},
	{
		question: "Can I hire individual talent instead of a consultant?",
		answer:
			"Yes. Talent is discoverable separately, and consultants routinely bring their own. The difference is accountability: with a consultant, one person owns the outcome rather than each contributor owning their slice.",
	},
];

export function BrowseFaq() {
	return (
		<section className="bg-muted/40 px-4 py-12 sm:px-6 lg:px-8">
			<div className="mx-auto max-w-3xl">
				<h2 className="text-center text-[20px] font-semibold text-foreground">
					Hiring a consultant — common questions
				</h2>
				<div className="mt-6 divide-y divide-border rounded-xl border border-border bg-card">
					{FAQ_ENTRIES.map((entry) => (
						<FaqRow key={entry.question} {...entry} />
					))}
				</div>
			</div>
		</section>
	);
}

function FaqRow({ question, answer }: { question: string; answer: string }) {
	const [open, setOpen] = useState(false);
	const panelId = useId();

	return (
		<div>
			<button
				type="button"
				onClick={() => setOpen((current) => !current)}
				aria-expanded={open}
				aria-controls={panelId}
				className="flex w-full items-center justify-between gap-4 px-4 py-3.5 text-left text-[13.5px] font-medium text-foreground"
			>
				{question}
				<ChevronDown
					className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
						open ? "rotate-180" : ""
					}`}
				/>
			</button>
			{open && (
				<p
					id={panelId}
					className="px-4 pb-4 text-[13px] leading-relaxed text-muted-foreground"
				>
					{answer}
				</p>
			)}
		</div>
	);
}

/**
 * The three ways into the work, mirroring the reference's "your way" band.
 * Each card goes somewhere that exists today — a dead entry point on the last
 * band before the footer is the worst place to put one.
 */
export function WaysToStartBand() {
	const ways = [
		{
			icon: FileText,
			title: "Post a project",
			body: "Describe the outcome you want. Consultants come to you with scope and pricing.",
			cta: "Post a project",
			to: "/marketplace/project-posting" as const,
			search: { roadmapId: undefined },
		},
		{
			icon: LayoutTemplate,
			title: "Start from a template",
			body: "Browse published roadmap templates and use one as the plan for your delivery.",
			cta: "Browse templates",
			to: "/roadmap-templates" as const,
		},
		{
			icon: Users,
			title: "Lead work yourself",
			body: "Apply to consult on Proyekto, publish a service catalog and take on delivery.",
			cta: "Apply to lead",
			to: "/marketplace/consultant/apply" as const,
		},
	];

	return (
		<section className="border-t border-border bg-muted/30 px-4 py-10 sm:px-6 lg:px-8">
			<div className="mx-auto max-w-7xl">
				<h2 className="text-[15px] font-semibold text-foreground">
					Find the right team — your way
				</h2>
				<div className="mt-4 grid gap-4 md:grid-cols-3">
					{ways.map((way) => (
						<div
							key={way.title}
							className="flex flex-col rounded-xl border border-border bg-card p-5"
						>
							<way.icon className="h-5 w-5 text-primary" />
							<h3 className="mt-3 text-[13.5px] font-semibold text-foreground">
								{way.title}
							</h3>
							<p className="mt-1.5 grow text-[12.5px] leading-relaxed text-muted-foreground">
								{way.body}
							</p>
							<Link
								to={way.to}
								search={way.search as never}
								className="mt-4 w-fit rounded-lg border border-border px-3 py-1.5 text-[12.5px] font-semibold text-foreground transition-colors hover:bg-muted"
							>
								{way.cta}
							</Link>
						</div>
					))}
				</div>
			</div>
		</section>
	);
}
