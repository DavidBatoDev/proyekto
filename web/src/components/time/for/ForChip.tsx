// web/src/components/time/for/ForChip.tsx
//
// The For chip (ux.md › For Chip › Chip details): who a piece of time is for.
//
//   Team       Users     + team name
//   Workspace  Building  + workspace name
//   Agreement  Briefcase + counterparty (no "contract" wording anywhere)
//   Just me    User      + "Just me"
//
// Labels are cut at 22 characters + "…" with the full label as a tooltip. The
// grey workspace tag (L57) shows only when the option's governing workspace
// differs from the project's (`workspace_tag`, as the resolver sends it).
//
// Variants:
// - `readonly`: picked automatically ("Only option on this project"); a
//   click opens "Who approves this time" when the project is known.
// - `menu`: the caller's picker opens on click (a ▾ shows).
// - `locked`: 🔒 with "Submitted Oct 6. Withdraw to change."

import {
	Briefcase,
	Building,
	ChevronDown,
	Lock,
	type LucideIcon,
	User,
	Users,
} from "lucide-react";
import { useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { FOR_LABEL } from "./forCopy";
import {
	CHIP_LABEL_MAX,
	type ForChipOption,
	type ForIconKind,
	forIconKind,
	truncateLabel,
} from "./forOptions";
import { WhoApprovesPopover } from "./WhoApprovesPopover";

const ICONS: Record<ForIconKind, LucideIcon> = {
	team: Users,
	workspace: Building,
	agreement: Briefcase,
	personal: User,
};

export function ForIcon({
	kind,
	className,
}: {
	kind: ForChipOption["kind"];
	className?: string;
}) {
	const Icon = ICONS[forIconKind(kind)];
	return (
		<Icon
			className={cn("h-3.5 w-3.5 shrink-0", className)}
			aria-hidden="true"
			data-icon={forIconKind(kind)}
		/>
	);
}

/** The grey workspace tag (L57). */
export function ForWorkspaceTag({ name }: { name: string | null | undefined }) {
	const tag = name?.trim();
	if (!tag) return null;
	const { text, full } = truncateLabel(tag, CHIP_LABEL_MAX);
	return (
		<span
			className="inline-flex shrink-0 items-center rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
			title={full}
			data-testid="for-workspace-tag"
		>
			{text}
		</span>
	);
}

export interface ForChipProps {
	option: ForChipOption;
	variant?: "readonly" | "menu" | "locked";
	/** Read-only chips: "Only option on this project" / "Same approver …". */
	note?: string | null;
	/** Locked chips: "Submitted Oct 6. Withdraw to change." */
	lockedText?: string | null;
	/** Enables "Who approves this time" on click (readonly and locked). */
	projectId?: string | null;
	projectWorkspaceName?: string | null;
	personalReason?: "plan" | "no_governed_option" | null;
	/** `menu`: opens the caller's picker. */
	onOpenMenu?: () => void;
	menuOpen?: boolean;
	/** Writes "For:" before the chip (the timer bar, quick add). */
	showPrefix?: boolean;
	/** Characters before "…" (chips 22, cards 32). */
	maxLength?: number;
	/** Above AppDialog when the chip sits in one. */
	popoverZIndex?: number;
	className?: string;
}

export function ForChip({
	option,
	variant = "readonly",
	note,
	lockedText,
	projectId,
	projectWorkspaceName,
	personalReason,
	onOpenMenu,
	menuOpen,
	showPrefix = false,
	maxLength = CHIP_LABEL_MAX,
	popoverZIndex,
	className,
}: ForChipProps) {
	const anchorRef = useRef<HTMLButtonElement | null>(null);
	const [popoverOpen, setPopoverOpen] = useState(false);
	const { text, full } = truncateLabel(option.label, maxLength);
	const locked = variant === "locked";
	const menu = variant === "menu" && Boolean(onOpenMenu);
	const opensPopover = !menu && Boolean(projectId);
	const tooltip = [full, note, locked ? lockedText : null]
		.filter((part): part is string => Boolean(part?.trim()))
		.join(" · ");

	const body = (
		<>
			<ForIcon kind={option.kind} />
			<span className="min-w-0 truncate">{text}</span>
			{locked ? (
				<Lock
					className="h-3 w-3 shrink-0 text-muted-foreground"
					aria-hidden="true"
				/>
			) : null}
			{menu ? (
				<ChevronDown
					className="h-3 w-3 shrink-0 text-muted-foreground"
					aria-hidden="true"
				/>
			) : null}
		</>
	);
	const chipClass = cn(
		"inline-flex min-w-0 max-w-full items-center gap-1 rounded-md border border-border bg-muted/40 px-1.5 py-0.5 text-xs font-medium text-foreground",
		locked && "text-muted-foreground",
	);
	const srText = [note, locked ? lockedText : null]
		.filter((part): part is string => Boolean(part?.trim()))
		.join(" ");

	return (
		<span
			className={cn(
				"inline-flex min-w-0 max-w-full items-center gap-1",
				className,
			)}
			data-variant={variant}
		>
			{showPrefix ? (
				<span className="shrink-0 text-xs text-muted-foreground">
					{FOR_LABEL}:
				</span>
			) : null}
			{menu || opensPopover ? (
				<button
					ref={anchorRef}
					type="button"
					title={tooltip || undefined}
					aria-haspopup="dialog"
					aria-expanded={menu ? Boolean(menuOpen) : popoverOpen}
					onClick={(event) => {
						event.stopPropagation();
						if (menu) onOpenMenu?.();
						else setPopoverOpen((open) => !open);
					}}
					className={cn(
						chipClass,
						"transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
					)}
				>
					{body}
					{srText ? <span className="sr-only">{srText}</span> : null}
				</button>
			) : (
				<span className={chipClass} title={tooltip || undefined}>
					{body}
					{srText ? <span className="sr-only">{srText}</span> : null}
				</span>
			)}
			<ForWorkspaceTag name={option.workspace_tag} />
			{opensPopover ? (
				<WhoApprovesPopover
					anchorRef={anchorRef}
					open={popoverOpen}
					onClose={() => setPopoverOpen(false)}
					projectId={projectId}
					option={option}
					projectWorkspaceName={projectWorkspaceName}
					personalReason={personalReason}
					zIndex={popoverZIndex}
				/>
			) : null}
		</span>
	);
}
