import type { LucideIcon } from "lucide-react";
import { BrandMark } from "@/components/brand/BrandMark";
import {
	Badge,
	Sheet,
	ILLUSTRATION_SVG_PROPS as SVG_PROPS,
} from "@/components/common/illustrationPrimitives";

// =============================================================================
// How the assistant introduces itself, in one place.
//
// The dashboard rail, the dashboard fullscreen view, the in-roadmap panel and
// its mobile sheet are one assistant wearing four layouts, so the header
// lockup and the empty state belong to the kit rather than to whichever mount
// happened to draw them first. They lived in `home/DashboardAiPanel` until the
// roadmap panel needed the same two pieces; copying them would have been the
// third and fourth copy of a wordmark to keep in sync.
//
// Nothing here is roadmap-aware (it is `components/ai`, boundary-tested), so
// each mount supplies its own words and gets the same identity around them.
// =============================================================================

/**
 * The header-left lockup. Deliberately colourless: the rail paints
 * `text-sidebar-foreground` and the roadmap panel `text-foreground`, and a
 * hardcoded colour here would be wrong on one of them.
 */
export function AiAssistantWordmark() {
	return (
		<div className="flex min-w-0 items-center gap-2">
			<BrandMark variant="logomark" className="h-4 shrink-0" ariaLabel="" />
			<span className="text-xs font-semibold">Proyekto</span>
		</div>
	);
}

/** One clickable question. The label IS the prompt: what you click is asked. */
export interface AiQuickPrompt {
	prompt: string;
	icon: LucideIcon;
}

const QUICK_PROMPTS_LABEL = "Quick questions";

/**
 * The empty thread: the illustration, what this assistant is for, one line of
 * encouragement, and — where the mount offers them — the quick-question cards.
 *
 * `className` carries the layout, because the shapes want different things:
 * the rail and the roadmap panel centre this in the empty thread area
 * (`h-full`, the default), the dashboard's fullscreen view stacks it directly
 * above the composer. The cards appear only with `onAsk`, and each sends its
 * question as the first turn, disabled alongside the composer.
 */
export function AiAssistantIntro({
	title,
	subtitle,
	prompts,
	className = "h-full",
	onAsk,
	disabled = false,
}: {
	title: string;
	subtitle: string;
	prompts?: readonly AiQuickPrompt[];
	className?: string;
	onAsk?: (prompt: string) => void;
	disabled?: boolean;
}) {
	return (
		<div
			className={`flex flex-col items-center justify-center px-4 text-center ${className}`}
		>
			<AskIllustration className="mb-3 h-20 w-20" />
			<p className="text-sm font-medium text-foreground">{title}</p>
			<p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
			{onAsk && prompts && prompts.length > 0 && (
				<div
					role="group"
					aria-label={QUICK_PROMPTS_LABEL}
					className="mt-4 grid w-full max-w-sm grid-cols-2 gap-2"
				>
					{prompts.map(({ prompt, icon: Icon }) => (
						<button
							key={prompt}
							type="button"
							onClick={() => onAsk(prompt)}
							disabled={disabled}
							className="flex flex-col items-start gap-2 rounded-xl border border-border bg-card px-3 py-2.5 text-left text-xs font-medium leading-snug text-card-foreground shadow-sm transition-colors hover:border-primary/40 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
						>
							<Icon className="h-4 w-4 text-primary" aria-hidden />
							<span>{prompt}</span>
						</button>
					))}
				</div>
			)}
		</div>
	);
}

/**
 * A conversation waiting to happen: two message bubbles on the sheet, with the
 * sparkle badge. Same grammar as every other illustration in the app
 * (`common/illustrationPrimitives.tsx`) — a `Bot` glyph from the icon set says
 * "robot", which is neither what this is nor what it is called.
 */
export function AskIllustration({ className }: { className?: string }) {
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
