import { createFileRoute, Link } from "@tanstack/react-router";
import {
	CalendarDays,
	CheckCircle2,
	FolderKanban,
	GitBranch,
	KanbanSquare,
	type LucideIcon,
	MessagesSquare,
	ShieldCheck,
	Sparkles,
	Timer,
} from "lucide-react";
import { Header } from "@/components/root/Header";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { cn } from "@/lib/utils";

/**
 * The product page.
 *
 * Reuses the marketing header rather than drawing its own, the way
 * `roadmap-templates/route.tsx` does — `usePresentationContext` has a no-op
 * fallback, so that header is safe outside the landing deck. `pt-20` clears its
 * fixed `h-20`.
 *
 * Static, not a deck: the landing page is the animated snap-scroll pitch, and
 * this is the page someone reads once they have decided to pay attention. The
 * motion here is in the clips, which show behaviour a screenshot cannot —
 * a card changing column, a diff being approved, a series repeating.
 *
 * Every section alternates the clip's side. A column of seven identically
 * arranged blocks reads as a list to scroll past rather than seven things to
 * look at.
 */
export const Route = createFileRoute("/product")({
	component: ProductPage,
});

interface Capability {
	id: string;
	icon: LucideIcon;
	eyebrow: string;
	title: string;
	body: string;
	points: string[];
	clip: { src: string; poster: string; alt: string };
}

/**
 * One clip per section.
 *
 * `alt` is the clip's text alternative and repeats what the animation shows;
 * keep it in step if a composition changes. Bump `?v=` when a clip is
 * re-rendered — filenames are stable and browser-cached, so the version param
 * is the only thing that forces a refetch.
 */
const CAPABILITIES: Capability[] = [
	{
		id: "roadmap",
		icon: GitBranch,
		eyebrow: "Plan",
		title: "A plan that is actually the plan",
		body: "Roadmaps are a tree of epics, features and tasks — one dataset behind four views, so the canvas, the board, the timeline and the epic view can never disagree with each other.",
		points: [
			"Epics are value-based initiatives, not technical layers",
			"Features carry the dates; tasks carry the work",
			"A feature's status is derived from its tasks — nothing to keep up to date by hand",
			"Every structural change is a commit you can inspect or roll back",
		],
		clip: {
			src: "/roadmap-empty.mp4?v=1",
			poster: "/roadmap-empty-poster.webp?v=1",
			alt: "A roadmap being built: a canvas, a milestone, epics, then features and owners.",
		},
	},
	{
		id: "ai",
		icon: Sparkles,
		eyebrow: "Draft",
		title: "An assistant that shows its work",
		body: "Describe what you are building and the assistant drafts the roadmap. Ask it to restructure an epic and it will — after showing you exactly what it intends to change.",
		points: [
			"Structural edits are two-stage: read the diff, then commit",
			"Works inside one roadmap, or across everything you can access",
			"@-mention a project, roadmap or task to point it at the right thing",
			"It can never do more than your own permissions allow",
		],
		clip: {
			src: "/ai-assistant.mp4?v=1",
			poster: "/ai-assistant-poster.webp?v=1",
			alt: "A request to the assistant, a proposed set of operations, the diff reviewed, then committed to the roadmap.",
		},
	},
	{
		id: "board",
		icon: KanbanSquare,
		eyebrow: "Run",
		title: "The day-to-day, without a second tool",
		body: "A kanban board per roadmap, a timeline with milestones, and a command center that collects every task assigned to you across every project you are in.",
		points: [
			"Drag between columns; the roadmap updates everywhere",
			"Milestones group features into dates you can report against",
			"Multiple assignees, checklists, dependencies and attachments",
		],
		clip: {
			src: "/board-empty.mp4?v=1",
			poster: "/board-empty-poster.webp?v=1",
			alt: "A task card created in To do, given an owner, dragged to In progress, then ticked into Done.",
		},
	},
	{
		id: "governance",
		icon: ShieldCheck,
		eyebrow: "Govern",
		title: "Governance that survives the project",
		body: "Four registers turn conversations into records with owners and outcomes — so what was agreed is still findable six months later, when it matters most.",
		points: [
			"Deliverables carry acceptance criteria and named reviewers",
			"Change requests run submit → decide → mark applied",
			"Risks and decisions have an explicit internal/external split",
			"Every entry can link to the roadmap work it affects",
		],
		clip: {
			src: "/deliverable-empty.mp4?v=1",
			poster: "/deliverable-empty-poster.webp?v=1",
			alt: "A deliverable defined, linked to the work, sent for review, then accepted.",
		},
	},
	{
		id: "chat",
		icon: MessagesSquare,
		eyebrow: "Talk",
		title: "Conversation next to the work",
		body: "Project-scoped channels and direct messages, with an inbox that gathers your mentions and DMs from every project rather than leaving them in five places.",
		points: [
			"Channels, threads, reactions, edits and unsend",
			"Search a project's history, and a media library of everything shared",
			"Mentions reach you in-app, on your phone, and by email",
		],
		clip: {
			src: "/project-chat.mp4?v=1",
			poster: "/project-chat-poster.webp?v=1",
			alt: "A project channel, a message with a mention, the notification it raises, and a threaded reply.",
		},
	},
	{
		id: "meetings",
		icon: CalendarDays,
		eyebrow: "Schedule",
		title: "Meetings, properly scheduled",
		body: "A real calendar with day, week, month and year views, full recurring series, timezone handling, and a video link created for you.",
		points: [
			"Recurring rules with this / this-and-following / all scoping",
			"An IANA timezone picker, so a series survives daylight saving",
			"Auto-created rooms, or paste an existing Meet, Zoom or Teams link",
			"Guests can be workspace members or outside email addresses",
		],
		clip: {
			src: "/meetings.mp4?v=1",
			poster: "/meetings-poster.webp?v=1",
			alt: "A week grid, a slot picked and set up, the meeting repeating across weeks, then guests joining.",
		},
	},
	{
		id: "time",
		icon: Timer,
		eyebrow: "Account",
		title: "Time, rates and what is owed",
		body: "Log time against the work itself, send it for approval, and resolve it against per-member and per-project rate cards.",
		points: [
			"My logs and team logs, with approval states",
			"Rate cards per member, overridable per project",
			"Payouts group approved single-currency time into one record",
		],
		clip: {
			src: "/time-rates.mp4?v=1",
			poster: "/time-rates-poster.webp?v=1",
			alt: "Time logged against a task, submitted, approved by a reviewer, then grouped into a payout.",
		},
	},
];

/** The overview strip, so the page states its shape before the deep dive. */
const AT_A_GLANCE = [
	{
		icon: FolderKanban,
		title: "One project, everything in it",
		body: "Roadmap, board, chat, meetings, files and governance — not six tools pointed at each other.",
	},
	{
		icon: Sparkles,
		title: "AI that proposes, never imposes",
		body: "Every structural change is previewed as a diff you approve, and revertible after the fact.",
	},
	{
		icon: ShieldCheck,
		title: "A record that outlives the work",
		body: "Decisions, changes and risks are written down where the next person will actually find them.",
	},
];

function ProductPage() {
	useDocumentTitle("Product");

	return (
		<>
			<Header />
			<div className="min-h-screen bg-background pt-20">
				{/* ---------- Hero ---------- */}
				<section className="border-b border-border bg-gradient-to-b from-primary/[0.07] to-transparent">
					<div className="mx-auto w-full max-w-7xl px-4 py-20 sm:px-6 lg:px-10 lg:py-24">
						<p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">
							The product
						</p>
						<h1 className="mt-3 max-w-3xl text-4xl font-bold tracking-tight text-foreground sm:text-5xl lg:text-6xl">
							The plan, the work, and the people doing it — in one place
						</h1>
						<p className="mt-5 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
							Proyekto is where a roadmap and the delivery against it live
							together. Plan it with an assistant that shows you every change
							before it makes it, run it on a board and a timeline drawn from
							the same data, and keep the decisions somewhere you can find them
							later.
						</p>
						<div className="mt-8 flex flex-wrap gap-3">
							<Link
								to="/auth/signup"
								search={{ redirect: undefined }}
								className="inline-flex h-12 items-center rounded-xl bg-primary px-7 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
							>
								Get started free
							</Link>
							<Link
								to="/docs"
								className="inline-flex h-12 items-center rounded-xl border border-border bg-card px-7 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
							>
								Read the docs
							</Link>
						</div>
					</div>
				</section>

				{/* ---------- At a glance ---------- */}
				<section className="border-b border-border">
					<div className="mx-auto grid w-full max-w-7xl gap-px bg-border px-0 sm:grid-cols-3">
						{AT_A_GLANCE.map((item) => (
							<div key={item.title} className="bg-background px-6 py-8 lg:px-8">
								<item.icon className="h-5 w-5 text-primary" aria-hidden />
								<h2 className="mt-3.5 text-sm font-semibold text-foreground">
									{item.title}
								</h2>
								<p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
									{item.body}
								</p>
							</div>
						))}
					</div>
				</section>

				{/* ---------- The capabilities ---------- */}
				<div className="mx-auto w-full max-w-7xl px-4 pb-24 sm:px-6 lg:px-10">
					{CAPABILITIES.map((capability, index) => (
						<CapabilitySection
							key={capability.id}
							capability={capability}
							// Alternate which side the clip sits on.
							flipped={index % 2 === 1}
						/>
					))}

					<section className="mt-24 overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-primary/10 via-primary/5 to-transparent px-8 py-14 text-center">
						<h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
							Start with a roadmap
						</h2>
						<p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
							You can draft one before you even make an account. Describe what
							you are building and see what comes back.
						</p>
						<div className="mt-7 flex flex-wrap justify-center gap-3">
							<Link
								to="/auth/signup"
								search={{ redirect: undefined }}
								className="inline-flex h-12 items-center rounded-xl bg-primary px-7 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
							>
								Get started free
							</Link>
							<Link
								to="/pricing"
								className="inline-flex h-12 items-center rounded-xl border border-border bg-card px-7 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
							>
								See pricing
							</Link>
						</div>
					</section>
				</div>
			</div>
		</>
	);
}

function CapabilitySection({
	capability,
	flipped,
}: {
	capability: Capability;
	flipped: boolean;
}) {
	const { icon: Icon, clip } = capability;
	return (
		<section className="border-t border-border py-16 first:border-t-0 lg:py-20">
			<div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
				<div className={cn(flipped && "lg:order-2")}>
					<div className="flex items-center gap-3">
						<span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
							<Icon className="h-5 w-5" aria-hidden />
						</span>
						<span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
							{capability.eyebrow}
						</span>
					</div>

					<h2 className="mt-5 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
						{capability.title}
					</h2>
					<p className="mt-3 max-w-xl text-[15px] leading-relaxed text-muted-foreground">
						{capability.body}
					</p>

					<ul className="mt-7 space-y-3">
						{capability.points.map((point) => (
							<li
								key={point}
								className="flex gap-2.5 text-[15px] leading-relaxed text-muted-foreground"
							>
								<CheckCircle2
									className="mt-[3px] h-4 w-4 shrink-0 text-primary"
									aria-hidden
								/>
								{point}
							</li>
						))}
					</ul>
				</div>

				<figure className={cn("m-0", flipped && "lg:order-1")}>
					{/* The border is what draws the clip's edge: these are light
					    compositions, and #ffffff on a near-white page separates by
					    about 1.03:1 — see remotion/src/brand/palette.ts. */}
					<div className="aspect-video overflow-hidden rounded-2xl border border-border bg-muted/40 shadow-(--app-shadow-sm)">
						<video
							src={clip.src}
							poster={clip.poster}
							muted
							loop
							playsInline
							autoPlay
							preload="none"
							aria-hidden
							className="block h-full w-full object-cover motion-reduce:hidden"
						/>
					</div>
					{/* The text alternative. Visually hidden rather than absent: the
					    clip carries real information, and `aria-hidden` on the video
					    means nothing else would announce it. */}
					<figcaption className="sr-only">{clip.alt}</figcaption>
				</figure>
			</div>
		</section>
	);
}
