import {
	Archive,
	Check,
	ChevronDown,
	CircleCheck,
	CirclePause,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { SemanticBadge } from "@/components/common/SemanticBadge";
import {
	normalizeTeamStatus,
	TEAM_STATUS_CONFIG,
	TEAM_STATUSES,
} from "@/components/team/teamStatus";
import type { TeamStatus } from "@/services/teams.service";
import { useTeamPatch } from "./useTeamPatch";

const STATUS_ICON = {
	active: { icon: CircleCheck, iconClassName: "text-emerald-600" },
	paused: { icon: CirclePause, iconClassName: "text-muted-foreground" },
	archived: { icon: Archive, iconClassName: "text-muted-foreground" },
} as const;

/** The chip on its own — used wherever a team status is displayed, not chosen. */
export function TeamStatusBadge({
	status,
	className,
}: {
	status: TeamStatus;
	className?: string;
}) {
	const config = STATUS_ICON[status];
	return (
		<SemanticBadge
			icon={config.icon}
			iconClassName={config.iconClassName}
			className={className}
		>
			{TEAM_STATUS_CONFIG[status].label}
		</SemanticBadge>
	);
}

/**
 * Click-to-change status chip.
 *
 * Structurally the project overview's `StatusBadgeSelector`, but not lifted
 * from it: that one is bound to `projectService.update`, the project status
 * vocabulary and the project query keys, and generalising it would need a
 * config prop, an onSelect prop, a renderBadge prop and a pending prop — at
 * which point it is a new component and the old one has to be deleted, which is
 * a second refactor riding along on this one. Worth doing separately.
 */
export function TeamStatusSelector({
	teamId,
	status,
	canEdit,
}: {
	teamId: string;
	status: TeamStatus;
	canEdit: boolean;
}) {
	const patch = useTeamPatch(teamId);
	const [open, setOpen] = useState(false);
	const wrapperRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!open) return;
		const handler = (event: MouseEvent) => {
			if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
		};
		document.addEventListener("mousedown", handler);
		return () => document.removeEventListener("mousedown", handler);
	}, [open]);

	if (!canEdit) return <TeamStatusBadge status={status} />;

	return (
		<div ref={wrapperRef} className="relative">
			<button
				type="button"
				onClick={() => setOpen((v) => !v)}
				disabled={patch.isPending}
				aria-haspopup="listbox"
				aria-expanded={open}
				className="inline-flex items-center gap-1 rounded-md transition-opacity hover:opacity-80 disabled:opacity-50"
			>
				<TeamStatusBadge status={status} />
				<ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
			</button>

			{open && (
				<div
					role="listbox"
					className="absolute left-0 top-full z-50 mt-1 w-56 overflow-hidden rounded-xl border border-border bg-popover py-1 text-popover-foreground shadow-xl"
				>
					{TEAM_STATUSES.map((key) => {
						const value = normalizeTeamStatus(key);
						const config = TEAM_STATUS_CONFIG[value];
						return (
							<button
								key={key}
								type="button"
								role="option"
								aria-selected={value === status}
								onClick={() => {
									setOpen(false);
									if (value !== status) patch.mutate({ status: value });
								}}
								className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-muted"
							>
								<span className="flex-1">
									<span className="block text-sm font-medium">
										{config.label}
									</span>
									<span className="block text-xs text-muted-foreground">
										{config.hint}
									</span>
								</span>
								{value === status && (
									<Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
								)}
							</button>
						);
					})}
				</div>
			)}
		</div>
	);
}
