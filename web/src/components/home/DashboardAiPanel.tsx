import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import { motion, useReducedMotion } from "framer-motion";
import {
	CalendarClock,
	FolderKanban,
	LayoutDashboard,
	ListChecks,
	Maximize2,
	Minimize2,
	Sparkles,
} from "lucide-react";
import { type ReactNode, useCallback, useMemo } from "react";
import {
	AiAssistantIntro,
	AiAssistantWordmark,
	type AiQuickPrompt,
} from "@/components/ai/AiAssistantIdentity";
import { AiAssistantPanel } from "@/components/ai/AiAssistantPanel";
import type { RunHooks } from "@/components/ai/runController";
import type { AiSessionScope } from "@/components/ai/scope";
import { BrandMark } from "@/components/brand/BrandMark";
import { invalidateDashboardRoadmaps } from "@/hooks/dashboardInvalidation";
import { invalidateDashboardProjects } from "@/hooks/useDashboardProjectsQuery";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useCurrentWorkspace } from "@/hooks/useWorkspaceQueries";
import { projectKeys } from "@/queries/project";
import type { RunCommitView } from "@/services/ai-agent.service";

/**
 * The dashboard's assistant, in its two shapes.
 *
 * `DashboardAiRail` is the pinned right-hand column. It took the place of the
 * Upcoming Meetings and Activity cards, which between them spent the whole
 * right column saying "no meetings" and "no activity" — two panels only worth
 * their space on an account that already has both. It is a sibling of the
 * sidebar rather than a card inside the page (see `DashboardShell`'s `rail`
 * slot), so it holds the full height of the window and scrolls its own thread
 * while the dashboard scrolls past it.
 *
 * `DashboardAiFullscreen` is the same assistant given the whole page: the
 * thread and a centred composer on an open field with the logomark
 * watermarked behind it. The sidebar stays, so you are still in the app rather
 * than in a modal you have to escape from.
 *
 * Both are the shared AI kit (`components/ai`) in WORKSPACE scope: one session
 * per workspace, so the assistant can read and edit any roadmap the user can
 * reach, and @-mentions pull projects, roadmaps, nodes and teams into the turn.
 * Both shapes are mounted at once (the rail stays under the overlay so the
 * circular reveal lands back on a page that never went away) and they share
 * the thread, the draft and the run: a send started in the rail is visible in
 * fullscreen and cannot be sent twice. While the overlay is open the rail is
 * `inert` and hidden from assistive tech, so there is exactly one interactive
 * "Proyekto assistant" on the page at a time.
 *
 * Nothing here touches `roadmapStore`: the dashboard renders MANY roadmaps
 * and the store is a singleton for one. Commits refresh through query
 * invalidation only (`invalidateAfterDashboardCommits`).
 *
 * Both wear the product's own logomark and are called Proyekto: it is the
 * product answering, not a third-party bot bolted into the corner.
 */

const RAIL_ARIA_LABEL = "Proyekto assistant";
const FULLSCREEN_ARIA_LABEL = "Proyekto assistant, full screen";
const COMPOSER_PLACEHOLDER = "Ask Proyekto...";
const COMPOSER_ARIA_LABEL = "Ask Proyekto";
const UNAVAILABLE_HINT = "Choose a workspace to start";
const INTRO_TITLE = "Ask Proyekto about your projects and roadmaps";
const INTRO_SUBTITLE = "Pick a question or ask your own.";

/**
 * The questions on the intro cards. Each is sent verbatim as the first turn,
 * so the label IS the prompt: what you click is what the assistant is asked.
 * They lean on the workspace-scope tools (my tasks, the overview,
 * cross-roadmap search), not on anything a fresh account would lack.
 */
const DASHBOARD_QUICK_PROMPTS: readonly AiQuickPrompt[] = [
	{ prompt: "What are my assigned tasks?", icon: ListChecks },
	{ prompt: "What should I work on today?", icon: Sparkles },
	{ prompt: "What is overdue across my projects?", icon: CalendarClock },
	{ prompt: "Summarize my projects and roadmaps", icon: FolderKanban },
];

// ─── Scope + commits ───────────────────────────────────────────────────────

/**
 * The workspace under `/w/<slug>/` is the session's scope. Null while the
 * workspace list is loading (no hint yet — a hint that flashes on every
 * reload teaches people to ignore it) or when the user belongs to none (then
 * the hint is the honest state).
 */
function useDashboardAiScope(): {
	scope: AiSessionScope | null;
	unavailableHint: string | undefined;
} {
	const { workspace, isLoading } = useCurrentWorkspace();
	const workspaceId = workspace?.id;
	const slug = workspace?.slug;
	const scope = useMemo<AiSessionScope | null>(
		() =>
			workspaceId && slug ? { kind: "workspace", workspaceId, slug } : null,
		[workspaceId, slug],
	);
	return { scope, unavailableHint: isLoading ? undefined : UNAVAILABLE_HINT };
}

/**
 * What a committed edit changes on this page: the roadmap preview cards, the
 * project cards (a roadmap summary rides on each), the header search's full
 * index, and the detail cache of every roadmap the run wrote to — so the next
 * visit to that roadmap does not open on the pre-edit tree.
 */
export function invalidateAfterDashboardCommits(
	queryClient: QueryClient,
	commits: readonly RunCommitView[],
): void {
	void invalidateDashboardRoadmaps(queryClient);
	void invalidateDashboardProjects(queryClient);
	void queryClient.invalidateQueries({ queryKey: projectKeys.allRoadmapsFull });
	const seen = new Set<string>();
	for (const commit of commits) {
		if (!commit.roadmap_id || seen.has(commit.roadmap_id)) continue;
		seen.add(commit.roadmap_id);
		void queryClient.invalidateQueries({
			queryKey: projectKeys.roadmapFull(commit.roadmap_id),
		});
	}
}

function useDashboardCommits(): NonNullable<RunHooks["onCommits"]> {
	const queryClient = useQueryClient();
	return useCallback(
		(commits) => invalidateAfterDashboardCommits(queryClient, commits),
		[queryClient],
	);
}

/**
 * `?assistant=full` is owned by the dashboard route (it is what Back
 * collapses). Read here rather than threaded through a prop so the route's
 * `rail` slot stays a one-liner; the rail only ever mounts on that route.
 */
function useIsAssistantFullscreen(): boolean {
	return useSearch({
		from: "/w/$workspaceSlug/dashboard",
		select: (search) => search.assistant === "full",
	});
}

// ─── Rail ──────────────────────────────────────────────────────────────────

export function DashboardAiRail({ onExpand }: { onExpand: () => void }) {
	const { scope, unavailableHint } = useDashboardAiScope();
	const onCommits = useDashboardCommits();
	const isFullscreenOpen = useIsAssistantFullscreen();

	return (
		<aside
			// No exit animation. The circular reveal already carries the whole
			// transition; a rail sliding out underneath it is a second animation
			// competing with the first, and the two never agree on timing.
			// Geometry copied from DashboardSidebar deliberately: same sticky
			// offset, same height, mirrored border, same surface tokens. The two
			// rails frame the same page and should sit on exactly the same edges —
			// they drift apart the moment one of them invents its own numbers.
			// Hidden below xl, where the page is already narrow enough without
			// giving 360px to a panel.
			className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-[360px] shrink-0 flex-col border-l border-sidebar-border bg-sidebar text-sidebar-foreground backdrop-blur xl:flex"
			// The overlay is drawn on top of a rail that never unmounts. `inert`
			// takes it out of the tab order and the click path; `aria-hidden`
			// takes it out of the accessibility tree, so the only "Proyekto
			// assistant" a screen reader (or Playwright's strict mode) can find is
			// the one you can actually use.
			inert={isFullscreenOpen || undefined}
			aria-hidden={isFullscreenOpen || undefined}
		>
			<AiAssistantPanel
				scope={scope}
				variant="rail"
				ariaLabel={RAIL_ARIA_LABEL}
				title={<AiAssistantWordmark />}
				headerActions={
					<IconButton
						label="Expand assistant"
						title="Expand to full screen"
						onClick={onExpand}
					>
						<Maximize2 className="h-3.5 w-3.5" />
					</IconButton>
				}
				emptyState={(context) => (
					<AiAssistantIntro
						title={INTRO_TITLE}
						subtitle={INTRO_SUBTITLE}
						prompts={DASHBOARD_QUICK_PROMPTS}
						onAsk={context.send}
						disabled={context.disabled}
					/>
				)}
				placeholder={COMPOSER_PLACEHOLDER}
				composerAriaLabel={COMPOSER_ARIA_LABEL}
				unavailableHint={unavailableHint}
				onCommits={onCommits}
			/>
		</aside>
	);
}

// ─── Fullscreen ────────────────────────────────────────────────────────────

export function DashboardAiFullscreen({
	onCollapse,
}: {
	onCollapse: () => void;
}) {
	const reducedMotion = useReducedMotion();
	// Below `xl` there is no rail, so the top-right corner the circle sweeps
	// from is just an empty piece of chrome. The assistant is reached from the
	// bottom switcher instead, so it arrives from the bottom.
	const isCompact = useIsMobile(1279);

	if (isCompact) {
		return (
			<motion.div
				// Rises from the bottom, and does so on the compositor: a plain
				// translate with `willChange: transform` is the one property phones
				// animate without a repaint. The earlier spring looked fine on a
				// desktop and stuttered on a phone, because a spring re-samples
				// every frame with no fixed end — a short tween is cheaper and
				// arrives when it says it will. `translateZ(0)` promotes the layer
				// up front so the first frame is not the one that pays for it.
				initial={reducedMotion ? { opacity: 0 } : { y: "100%" }}
				animate={reducedMotion ? { opacity: 1 } : { y: 0 }}
				exit={reducedMotion ? { opacity: 0 } : { y: "100%" }}
				transition={{
					duration: reducedMotion ? 0.15 : 0.32,
					ease: [0.32, 0.72, 0, 1],
				}}
				// `contain: paint` walls the surface off as its own paint root, so
				// the browser never has to consider the dashboard behind it while
				// the layer slides.
				style={{
					willChange: "transform",
					transform: "translateZ(0)",
					contain: "paint",
				}}
				className={FULLSCREEN_SURFACE}
			>
				<AssistantFullscreenBody onCollapse={onCollapse} compact />
			</motion.div>
		);
	}

	return (
		<motion.div
			// A circular reveal, swept from the top-right corner — where the rail
			// and its expand button are — out past the far corner of the page.
			//
			// The clip-path circle is the whole effect: the panel is not moving or
			// growing, the page is being *uncovered* from the point you clicked,
			// which is why it reads as the side panel spreading rather than as a
			// dialog opening. 150% is the reference radius that guarantees the
			// circle clears the opposite corner at any aspect ratio (percentage
			// radii resolve against sqrt(w²+h²)/sqrt(2), so 142% is the true
			// minimum; 150% leaves room and costs nothing).
			//
			// `z-10` + the popLayout exit in the route keep this painted above the
			// outgoing dashboard, so the circle reveals the assistant over the
			// page it is replacing instead of over a blank background.
			initial={
				reducedMotion ? { opacity: 0 } : { clipPath: "circle(0% at 100% 0%)" }
			}
			animate={
				reducedMotion ? { opacity: 1 } : { clipPath: "circle(150% at 100% 0%)" }
			}
			exit={
				reducedMotion ? { opacity: 0 } : { clipPath: "circle(0% at 100% 0%)" }
			}
			transition={{
				duration: reducedMotion ? 0.15 : 0.6,
				ease: [0.4, 0, 0.2, 1],
			}}
			className={FULLSCREEN_SURFACE}
		>
			<AssistantFullscreenBody onCollapse={onCollapse} />
		</motion.div>
	);
}

/**
 * Fixed over the content column rather than in the page flow, so the dashboard
 * underneath is never unmounted: it is still sitting there, fully rendered and
 * at its old scroll position, the instant the transition reverses. The offsets
 * mirror the chrome — `top-14` is the header, and the left inset is the
 * sidebar's own 260px, which it only occupies from `lg`.
 */
const FULLSCREEN_SURFACE =
	"fixed top-14 right-0 bottom-0 left-0 z-30 flex flex-col bg-background lg:left-[260px]";

function AssistantFullscreenBody({
	onCollapse,
	compact = false,
}: {
	onCollapse: () => void;
	compact?: boolean;
}) {
	const reducedMotion = useReducedMotion();
	const { scope, unavailableHint } = useDashboardAiScope();
	const onCommits = useDashboardCommits();

	return (
		<>
			{/* The mark is watermarked behind the thread and pulled slightly
			    above centre, so it reads as the page's own surface rather than
			    as a picture sitting under a box. */}
			{/* Decorative, and a 420px bitmap: it is the most expensive thing
			    on this surface to composite, so the phones doing the sliding
			    do not draw it. */}
			{!compact && (
				<BrandMark
					variant="logomark"
					ariaLabel=""
					className="pointer-events-none absolute top-1/2 left-1/2 h-[420px] -translate-x-1/2 -translate-y-[60%] opacity-[0.04]"
				/>
			)}

			{/* `relative` so the panel paints above the (positioned) watermark. */}
			<AiAssistantPanel
				scope={scope}
				variant="fullscreen"
				ariaLabel={FULLSCREEN_ARIA_LABEL}
				className="relative"
				title={<AiAssistantWordmark />}
				headerActions={
					<IconButton
						label="Exit full screen"
						title="Back to the dashboard"
						onClick={onCollapse}
					>
						<Minimize2 className="h-3.5 w-3.5" />
					</IconButton>
				}
				emptyState={(context) => (
					// The same greeting the rail shows, above the field rather than
					// filling the space where a thread will go — an empty page with
					// only an input on it says nothing about what to type into it.
					// It fades in once the reveal has cleared the composer.
					<motion.div
						initial={reducedMotion || compact ? false : { opacity: 0, y: 12 }}
						animate={{ opacity: 1, y: 0 }}
						transition={{ delay: 0.28, duration: 0.3, ease: "easeOut" }}
					>
						<AiAssistantIntro
							title={INTRO_TITLE}
							subtitle={INTRO_SUBTITLE}
							prompts={DASHBOARD_QUICK_PROMPTS}
							className="mb-4"
							onAsk={context.send}
							disabled={context.disabled}
						/>
					</motion.div>
				)}
				placeholder={COMPOSER_PLACEHOLDER}
				composerAriaLabel={COMPOSER_ARIA_LABEL}
				unavailableHint={unavailableHint}
				onCommits={onCommits}
			/>
		</>
	);
}

// ─── Compact switcher ──────────────────────────────────────────────────────

/**
 * The floating Dashboard / Proyekto switch, for screens with no room for a
 * rail.
 *
 * From `xl` up the assistant lives in its own column and this is hidden — on
 * anything narrower the rail is not rendered at all, so without this the
 * assistant would be unreachable on a phone or a tablet. It sits above the
 * fullscreen surface (`z-40` over `z-30`) so it stays the way back out, which
 * matters most on a phone where the header's collapse button is a small target
 * at the far corner.
 */
export function AssistantModeSwitcher({
	isAssistantOpen,
	onChange,
}: {
	isAssistantOpen: boolean;
	onChange: (open: boolean) => void;
}) {
	return (
		<div
			// `--safe-bottom` keeps it clear of the iOS home indicator; without it
			// the pill sits under the gesture bar on a notched phone.
			className="fixed bottom-[calc(1rem+var(--safe-bottom))] left-1/2 z-40 -translate-x-1/2 xl:hidden"
		>
			<div
				role="tablist"
				aria-label="Dashboard or assistant"
				className="flex items-center gap-1 rounded-full border border-sidebar-border bg-sidebar p-1 shadow-lg"
			>
				<SwitcherTab
					selected={!isAssistantOpen}
					onClick={() => onChange(false)}
					icon={<LayoutDashboard className="h-4 w-4" />}
					label="Dashboard"
				/>
				<SwitcherTab
					selected={isAssistantOpen}
					onClick={() => onChange(true)}
					icon={<BrandMark variant="logomark" className="h-4" ariaLabel="" />}
					label="Proyekto"
				/>
			</div>
		</div>
	);
}

function SwitcherTab({
	selected,
	onClick,
	icon,
	label,
}: {
	selected: boolean;
	onClick: () => void;
	icon: ReactNode;
	label: string;
}) {
	return (
		<button
			type="button"
			role="tab"
			aria-selected={selected}
			onClick={onClick}
			className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium ${
				selected
					? "bg-primary text-primary-foreground"
					: "text-sidebar-foreground/70 hover:bg-sidebar-accent"
			}`}
		>
			{icon}
			{label}
		</button>
	);
}

// ─── Shared pieces ─────────────────────────────────────────────────────────

function IconButton({
	label,
	title,
	onClick,
	children,
}: {
	label: string;
	title: string;
	onClick: () => void;
	children: ReactNode;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			aria-label={label}
			title={title}
			className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-sidebar-border text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
		>
			{children}
		</button>
	);
}
