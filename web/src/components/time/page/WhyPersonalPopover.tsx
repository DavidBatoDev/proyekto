// web/src/components/time/page/WhyPersonalPopover.tsx
//
// The **Why?** next to "Just me" (ux.md › Personas P1b, For Chip). When the
// resolver can only offer "Just me" (L31) it says why in
// `LoggingForResult.personal_reason`, and lists the options it ruled out in
// `unavailable[]`:
//
//   Why?
//   ┌──────────────────────────────────────────────────────────────────┐
//   │ Your workspace's plan doesn't include timesheets; this time is   │
//   │ just for you.                                                    │
//   │ Prodigitality has time tracking off for this team.               │
//   └──────────────────────────────────────────────────────────────────┘
//
// The sentences come from the For chip's copy (`for/forCopy.ts`), so the chip's
// "Who approves this time" popover and this one never disagree.

import { HelpCircle } from "lucide-react";
import { useRef, useState } from "react";
import { AnchoredPopover } from "@/components/common/AnchoredPopover";
import {
	PERSONAL_LABEL,
	personalReasonText,
	unavailableReasonText,
	WHY_LABEL,
} from "@/components/time/for/forCopy";
import { isNativeApp } from "@/lib/platform";
import { nativeSafe } from "@/lib/timeErrors";
import { cn } from "@/lib/utils";
import type {
	LoggingForResult,
	UnavailableOption,
} from "@/services/time.types";

export type PersonalReason = NonNullable<LoggingForResult["personal_reason"]>;

/** The popover's accessible name (screen readers only). */
export const WHY_PERSONAL_ARIA_LABEL = `Why ${PERSONAL_LABEL}`;

/**
 * A-4: a team row names the workspace it answers to (backend
 * `UnavailableOption.workspace_name?`). Typed here until the web mirror in
 * `services/time.types.ts` carries the field; the intersection stays exact
 * once it does.
 */
type NamedUnavailableOption = UnavailableOption & {
	workspace_name?: string | null;
};

/** The workspace a team row answers to: the row's own name, else the caller's. */
function teamOwnerName(
	item: NamedUnavailableOption,
	fallback: string | null | undefined,
): string | null | undefined {
	if (item.kind !== "team") return undefined;
	return item.workspace_name?.trim() || fallback;
}

/**
 * The popover's sentences, in order: why it's "Just me", then each option
 * that was ruled out (deduplicated). With `plan` the plan sentence already
 * says it, so `plan` rows of `unavailable[]` are not repeated. A team row
 * reads "Prodigitality has time tracking off for this team." /
 * "Prodigitality's plan doesn't include timesheets." with the workspace the
 * server named on it (A-4), else `ownerName`.
 */
export function whyPersonalLines(
	reason: PersonalReason | null | undefined,
	unavailable: readonly UnavailableOption[] = [],
	options: { native?: boolean; ownerName?: string | null } = {},
): string[] {
	const native = options.native ?? isNativeApp();
	const lines = [personalReasonText(reason ?? null)];
	for (const item of unavailable as readonly NamedUnavailableOption[]) {
		if (reason === "plan" && item.reason === "plan") continue;
		const line = unavailableReasonText(item, {
			ownerName: teamOwnerName(item, options.ownerName),
		});
		if (!lines.includes(line)) lines.push(line);
	}
	return lines.map((line) => nativeSafe(line, { native }));
}

export interface WhyPersonalPopoverProps {
	/** `LoggingForResult.personal_reason`; null reads "This time is just for you." */
	reason: PersonalReason | null | undefined;
	/** `LoggingForResult.unavailable`: the options that were ruled out. */
	unavailable?: readonly UnavailableOption[];
	/**
	 * The team's workspace name, for "<workspace> has time tracking off for
	 * this team." on team rows the server sent without a `workspace_name`.
	 */
	ownerName?: string | null;
	/** The trigger's text (default "Why?"). */
	label?: string;
	/** Raise above AppDialog (1200) when opened from inside one. */
	zIndex?: number;
	className?: string;
}

export function WhyPersonalPopover({
	reason,
	unavailable,
	ownerName,
	label = WHY_LABEL,
	zIndex,
	className,
}: WhyPersonalPopoverProps) {
	const [open, setOpen] = useState(false);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const lines = whyPersonalLines(reason, unavailable, { ownerName });

	return (
		<>
			<button
				ref={triggerRef}
				type="button"
				aria-expanded={open}
				aria-haspopup="dialog"
				onClick={() => setOpen((value) => !value)}
				className={cn(
					"inline-flex items-center gap-1 rounded-sm text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
					className,
				)}
			>
				<HelpCircle className="h-3.5 w-3.5" aria-hidden="true" />
				{label}
			</button>
			<AnchoredPopover
				anchorRef={triggerRef}
				open={open}
				onClose={() => setOpen(false)}
				width={300}
				maxHeight={240}
				zIndex={zIndex}
				ariaLabel={WHY_PERSONAL_ARIA_LABEL}
			>
				<div className="space-y-1.5 p-3 text-xs leading-relaxed text-popover-foreground">
					{lines.map((line, index) => (
						<p
							key={line}
							className={index === 0 ? "text-sm text-foreground" : undefined}
						>
							{line}
						</p>
					))}
				</div>
			</AnchoredPopover>
		</>
	);
}
