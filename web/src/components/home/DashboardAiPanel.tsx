import { motion, useReducedMotion } from "framer-motion";
import {
	ChevronDown,
	LayoutDashboard,
	Maximize2,
	Minimize2,
	Paperclip,
	Send,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { BrandMark } from "@/components/brand/BrandMark";
import {
	Badge,
	Sheet,
	ILLUSTRATION_SVG_PROPS as SVG_PROPS,
} from "@/components/common/illustrationPrimitives";
import { useIsMobile } from "@/hooks/useIsMobile";

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
 * `DashboardAiFullscreen` is the same assistant given the whole page: a
 * centred composer on an empty field with the logomark watermarked behind it.
 * The sidebar stays, so you are still in the app rather than in a modal you
 * have to escape from.
 *
 * Both wear the product's own logomark and are called Proyekto: it is the
 * product answering, not a third-party bot bolted into the corner.
 *
 * UI ONLY. Nothing here talks to the agent: the thread menu does not open, the
 * attachment button does not pick a file, and Send stays disabled. It is
 * deliberately not faking a reply — a canned answer would be a lie about a
 * feature that does not exist, and would have to be unpicked when the real
 * session lands. Expanding and collapsing are the only things that work.
 */

const NOT_CONNECTED =
	"Not connected yet — this is the panel, not the assistant.";

// ─── Rail ──────────────────────────────────────────────────────────────────

export function DashboardAiRail({ onExpand }: { onExpand: () => void }) {
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
			aria-label="Proyekto assistant"
		>
			<AssistantHeader
				actionLabel="Expand assistant"
				actionTitle="Expand to full screen"
				onAction={onExpand}
				actionIcon={<Maximize2 className="h-3.5 w-3.5" />}
			/>

			<div className="thin-scrollbar relative flex-1 space-y-3 overflow-y-auto px-3 py-4">
				<AssistantIntro />
			</div>

			<footer className="border-t border-sidebar-border px-3 py-3">
				<p className="mb-2 text-[11px] text-muted-foreground">
					{NOT_CONNECTED}
				</p>
				<AssistantComposer />
			</footer>
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

	return (
		<>
			<AssistantHeader
				actionLabel="Exit full screen"
				actionTitle="Back to the dashboard"
				onAction={onCollapse}
				actionIcon={<Minimize2 className="h-3.5 w-3.5" />}
			/>

			<div className="relative flex flex-1 items-center justify-center overflow-hidden px-4 pb-24">
				{/* The mark is watermarked behind the composer and pulled slightly
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

				<motion.div
					initial={reducedMotion || compact ? false : { opacity: 0, y: 12 }}
					animate={{ opacity: 1, y: 0 }}
					transition={{ delay: 0.28, duration: 0.3, ease: "easeOut" }}
					className="relative w-full max-w-2xl"
				>
					{/* The same greeting the rail shows, above the field rather than
					    filling the space where a thread will go — an empty page with
					    only an input on it says nothing about what to type into it. */}
					<AssistantIntro className="mb-6" />

					<div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
						<AssistantComposer stacked />
					</div>
					<p className="mt-3 text-center text-xs text-muted-foreground">
						{NOT_CONNECTED}
					</p>
				</motion.div>
			</div>
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

/**
 * The header bar, identical in both shapes.
 *
 * One component rather than two copies of the same row: the rail and the
 * fullscreen view sit at the same top edge, and the moment their padding is
 * written out twice the lockup lands a few pixels off between them. Only the
 * trailing button differs — expand in one, collapse in the other.
 */
function AssistantHeader({
	actionLabel,
	actionTitle,
	onAction,
	actionIcon,
}: {
	actionLabel: string;
	actionTitle: string;
	onAction: () => void;
	actionIcon: ReactNode;
}) {
	return (
		<div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-sidebar-border px-3">
			<AssistantWordmark />
			{/* Identity on the left, controls on the right, in both shapes. */}
			<div className="flex items-center gap-1">
				<ThreadMenuButton />
				<IconButton label={actionLabel} title={actionTitle} onClick={onAction}>
					{actionIcon}
				</IconButton>
			</div>
		</div>
	);
}

function AssistantWordmark() {
	return (
		<div className="flex min-w-0 items-center gap-2">
			<BrandMark variant="logomark" className="h-4 shrink-0" ariaLabel="" />
			<span className="text-xs font-semibold text-sidebar-foreground">
				Proyekto
			</span>
		</div>
	);
}

function ThreadMenuButton() {
	return (
		<button
			type="button"
			disabled
			title="Threads arrive with the assistant"
			className="flex items-center gap-1 rounded-md border border-sidebar-border px-2 py-1 text-xs text-sidebar-foreground hover:bg-sidebar-accent disabled:cursor-not-allowed disabled:opacity-60"
		>
			<span className="max-w-[140px] truncate">New chat</span>
			<ChevronDown size={12} />
		</button>
	);
}

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

/**
 * `className` carries the layout: the rail centres this in the empty thread
 * area (`h-full`), the fullscreen view stacks it directly above the composer.
 */
function AssistantIntro({ className = "h-full" }: { className?: string }) {
	return (
		<div
			className={`flex flex-col items-center justify-center px-4 text-center ${className}`}
		>
			<AskIllustration className="mb-3 h-20 w-20" />
			<p className="text-sm font-medium text-sidebar-foreground">
				Ask Proyekto about your projects and roadmaps
			</p>
			<p className="mt-1 text-xs text-muted-foreground">
				Example: "what should I work on today?"
			</p>
		</div>
	);
}

/**
 * The composer, in one row (rail) or with the controls under the field
 * (fullscreen, where the field is wide enough that buttons beside it would
 * strand them at the far edge).
 */
function AssistantComposer({ stacked = false }: { stacked?: boolean }) {
	const [input, setInput] = useState("");

	const field = (
		<textarea
			value={input}
			onChange={(event) => setInput(event.target.value)}
			rows={stacked ? 2 : 1}
			placeholder="Ask Proyekto..."
			aria-label="Ask Proyekto"
			className={
				stacked
					? "no-scrollbar max-h-60 min-h-12 w-full resize-none overflow-y-auto bg-transparent text-[15px] outline-none placeholder:text-muted-foreground [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
					: "no-scrollbar max-h-40 min-h-10 flex-1 resize-none overflow-y-auto rounded-xl border border-sidebar-border bg-sidebar px-3 py-2 text-sm [-ms-overflow-style:none] [scrollbar-width:none] focus:border-sidebar-ring focus:outline-none focus:ring-2 focus:ring-sidebar-ring/30 [&::-webkit-scrollbar]:hidden"
			}
		/>
	);

	const attach = (
		<button
			type="button"
			disabled
			title="Attachments arrive with the assistant"
			aria-label="Add attachment"
			className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-sidebar-border text-sidebar-foreground/70 hover:bg-sidebar-accent disabled:cursor-not-allowed disabled:opacity-50"
		>
			<Paperclip className="h-4 w-4" />
		</button>
	);

	const send = (
		<button
			type="button"
			disabled
			title="The assistant is not connected yet"
			aria-label="Send message"
			className="ai-gradient-bg inline-flex h-10 w-10 items-center justify-center rounded-xl text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
		>
			<Send className="h-4 w-4" />
		</button>
	);

	if (!stacked) {
		return (
			<div className="flex items-end gap-2">
				{attach}
				{field}
				{send}
			</div>
		);
	}

	return (
		<>
			{field}
			<div className="mt-2 flex items-center justify-end gap-2">
				{attach}
				{send}
			</div>
		</>
	);
}

/**
 * A conversation waiting to happen: two message bubbles on the sheet, with the
 * sparkle badge. Same grammar as every other illustration in the app
 * (`common/illustrationPrimitives.tsx`) — a `Bot` glyph from the icon set says
 * "robot", which is neither what this is nor what it is called.
 */
function AskIllustration({ className }: { className?: string }) {
	return (
		<svg {...SVG_PROPS} className={className}>
			<Sheet y={10} h={28} />
			<rect
				x="10.5"
				y="16"
				width="14"
				height="5"
				rx="2.5"
				className="fill-muted-foreground"
				opacity="0.25"
			/>
			<rect
				x="15.5"
				y="23.5"
				width="14"
				height="5"
				rx="2.5"
				className="fill-primary"
				opacity="0.9"
			/>
			<rect
				x="10.5"
				y="31"
				width="9"
				height="4"
				rx="2"
				className="fill-muted-foreground"
				opacity="0.18"
			/>
			<Badge cy={17}>
				<path
					d="M36 12.8c0.5 2.6 1.6 3.7 4.2 4.2-2.6 0.5-3.7 1.6-4.2 4.2-0.5-2.6-1.6-3.7-4.2-4.2 2.6-0.5 3.7-1.6 4.2-4.2Z"
					className="fill-primary-foreground"
				/>
			</Badge>
		</svg>
	);
}
