import { Flag, MoreHorizontal, ShieldBan, ShieldCheck } from "lucide-react";
import { useRef, useState } from "react";
import { AnchoredPopover } from "@/components/common/AnchoredPopover";
import type { PersonRef } from "@/queries/safety";
import { useSafety } from "./SafetyProvider";

function useActions(person: PersonRef | null) {
	const safety = useSafety();
	if (!person || !safety.canActOn(person.id)) return null;
	const blocked = safety.isBlocked(person.id);
	return {
		blocked,
		report: () =>
			safety.report({
				type: "user",
				id: person.id,
				author: {
					id: person.id,
					name: person.name,
					avatarUrl: person.avatarUrl,
				},
			}),
		toggleBlock: () =>
			blocked ? void safety.unblock(person) : safety.block(person),
	};
}

/**
 * "Report {name}" and "Block {name}" as full-width rows, for side panels and
 * profile cards. Renders nothing for yourself.
 */
export function PersonSafetyRows({ person }: { person: PersonRef | null }) {
	const actions = useActions(person);
	if (!person || !actions) return null;
	const row =
		"flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors";
	return (
		<>
			<button
				type="button"
				onClick={actions.report}
				className={`${row} border-border bg-card text-foreground hover:bg-muted`}
			>
				<Flag className="h-4 w-4 text-muted-foreground" />
				Report {person.name}
			</button>
			<button
				type="button"
				onClick={actions.toggleBlock}
				className={
					actions.blocked
						? `${row} border-border bg-card text-foreground hover:bg-muted`
						: `${row} border-destructive/30 text-destructive hover:bg-destructive/10`
				}
			>
				{actions.blocked ? (
					<ShieldCheck className="h-4 w-4 text-muted-foreground" />
				) : (
					<ShieldBan className="h-4 w-4" />
				)}
				{actions.blocked ? `Unblock ${person.name}` : `Block ${person.name}`}
			</button>
		</>
	);
}

/**
 * A "⋯" button with Report / Block for headers (DM header, inbox, profile).
 * Renders nothing for yourself.
 */
export function PersonSafetyMenu({
	person,
	triggerClassName,
	label = "More actions",
}: {
	person: PersonRef | null;
	triggerClassName?: string;
	label?: string;
}) {
	const actions = useActions(person);
	const [open, setOpen] = useState(false);
	const anchorRef = useRef<HTMLButtonElement | null>(null);
	if (!person || !actions) return null;

	const run = (fn: () => void) => () => {
		setOpen(false);
		fn();
	};

	return (
		<>
			<button
				ref={anchorRef}
				type="button"
				onClick={() => setOpen((v) => !v)}
				aria-label={label}
				aria-haspopup="menu"
				aria-expanded={open}
				className={
					triggerClassName ??
					"inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
				}
			>
				<MoreHorizontal className="h-5 w-5" />
			</button>
			<AnchoredPopover
				anchorRef={anchorRef}
				open={open}
				onClose={() => setOpen(false)}
				width={208}
				align="right"
				ariaLabel={label}
				className="overflow-hidden rounded-xl border border-border bg-popover py-1 shadow-(--app-shadow-lg)"
			>
				<div role="menu">
					<button
						type="button"
						role="menuitem"
						onClick={run(actions.report)}
						className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-popover-foreground hover:bg-muted"
					>
						<Flag className="h-4 w-4 text-muted-foreground" />
						Report {person.name}
					</button>
					<div className="my-1 border-t border-border" role="none" />
					<button
						type="button"
						role="menuitem"
						onClick={run(actions.toggleBlock)}
						className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-muted ${
							actions.blocked ? "text-popover-foreground" : "text-destructive"
						}`}
					>
						{actions.blocked ? (
							<ShieldCheck className="h-4 w-4 text-muted-foreground" />
						) : (
							<ShieldBan className="h-4 w-4" />
						)}
						{actions.blocked ? "Unblock" : "Block"} {person.name}
					</button>
				</div>
			</AnchoredPopover>
		</>
	);
}
