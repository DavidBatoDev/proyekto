import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import type { ChangeRequest } from "@/services/delivery.service";
import type { ProfileSummary } from "@/services/teams.service";
import { CrRow } from "./CrRow";
import type { CrQueueGroup, CrQueueGroupKey } from "./crQueueModel";

export interface CrRowHandlers {
	canCreate: boolean;
	canDecide: boolean;
	busy: boolean;
	requesterFor: (request: ChangeRequest) => ProfileSummary | null;
	onOpen: (request: ChangeRequest) => void;
	onSubmit: (request: ChangeRequest) => void;
	onDecide: (request: ChangeRequest) => void;
	onApply: (request: ChangeRequest) => void;
	onWithdraw: (request: ChangeRequest) => void;
	onEdit: (request: ChangeRequest) => void;
	onDelete: (request: ChangeRequest) => void;
}

/**
 * Each group's accent, carried by the header dot and the rows' left edge.
 *
 * Colour is what tells you at a glance which band you are in; without it, five
 * stacked groups are five identical grey headings.
 */
const GROUP_ACCENT: Record<CrQueueGroupKey, { dot: string; bar: string }> = {
	awaiting: { dot: "bg-warning", bar: "bg-warning" },
	approved: { dot: "bg-info", bar: "bg-info" },
	draft: { dot: "bg-muted-foreground/40", bar: "bg-muted-foreground/30" },
	applied: { dot: "bg-success", bar: "bg-success" },
	closed: { dot: "bg-muted-foreground/30", bar: "bg-muted-foreground/20" },
};

/** The column ruler. Shared by the header strip and every row so they line up. */
export const CR_COLUMNS =
	"grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 lg:grid-cols-[5rem_minmax(0,2.2fr)_11rem_minmax(0,1.4fr)_9rem_4.5rem_4rem_auto]";

/**
 * The queue: grouped rows, ordered by what needs a human.
 *
 * Deliberately not a board. The pipeline gave the four live statuses equal
 * columns, which flattened the one asymmetry that matters — an approved request
 * has been decided but has *not* changed the plan, and it will sit there until
 * somebody applies it. As a group with its own heading, that state can say so.
 *
 * Empty groups do NOT get a heading of their own. Five stacked rows all reading
 * "0" is a wall of nothing that makes a healthy project look abandoned; they
 * collapse into one quiet line at the foot of the queue instead, which still
 * answers "is there anything in Draft?" without dominating the page.
 */
export function CrQueue({
	groups,
	projectId,
	handlers,
}: {
	groups: CrQueueGroup[];
	projectId: string;
	handlers: CrRowHandlers;
}) {
	const [closed, setClosed] = useState<Set<CrQueueGroupKey>>(
		() =>
			new Set(
				groups.filter((group) => !group.defaultOpen).map((group) => group.key),
			),
	);

	const toggle = (key: CrQueueGroupKey) =>
		setClosed((prev) => {
			const next = new Set(prev);
			if (next.has(key)) next.delete(key);
			else next.add(key);
			return next;
		});

	const populated = groups.filter((group) => group.requests.length > 0);
	const empty = groups.filter((group) => group.requests.length === 0);

	return (
		<div className="flex flex-col gap-7">
			{populated.map((group) => {
				const open = !closed.has(group.key);
				const accent = GROUP_ACCENT[group.key];
				return (
					<section key={group.key}>
						<div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
							<button
								type="button"
								onClick={() => toggle(group.key)}
								aria-expanded={open}
								className="flex min-w-0 items-center gap-2 text-left"
							>
								{open ? (
									<ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
								) : (
									<ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
								)}
								<span
									aria-hidden
									className={`h-2 w-2 shrink-0 rounded-full ${accent.dot}`}
								/>
								<span className="text-sm font-semibold text-foreground">
									{group.label}
								</span>
								<span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold tabular-nums text-muted-foreground">
									{group.requests.length}
								</span>
							</button>
							{group.hint && (
								<span className="hidden truncate text-xs text-muted-foreground/80 sm:block">
									{group.hint}
								</span>
							)}
						</div>

						{open && (
							<div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
								{/* Column captions, so the numbers down the right have names.
								    Wide screens only — below `lg` the row stacks. */}
								<div
									className={`${CR_COLUMNS} hidden border-b border-border bg-muted/40 px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground lg:grid`}
								>
									<span>Ref</span>
									<span>Request</span>
									<span>Raised by</span>
									<span>Affects</span>
									<span>Status</span>
									<span className="text-right">Impact</span>
									<span className="text-right">Age</span>
									<span />
								</div>

								{group.requests.map((request) => (
									<CrRow
										key={request.id}
										request={request}
										projectId={projectId}
										accentBar={accent.bar}
										requester={handlers.requesterFor(request)}
										canCreate={handlers.canCreate}
										canDecide={handlers.canDecide}
										busy={handlers.busy}
										onOpen={() => handlers.onOpen(request)}
										onSubmit={() => handlers.onSubmit(request)}
										onDecide={() => handlers.onDecide(request)}
										onApply={() => handlers.onApply(request)}
										onWithdraw={() => handlers.onWithdraw(request)}
										onEdit={() => handlers.onEdit(request)}
										onDelete={() => handlers.onDelete(request)}
									/>
								))}
							</div>
						)}
					</section>
				);
			})}

			{empty.length > 0 && (
				<p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 px-1 text-xs text-muted-foreground/70">
					<span className="font-medium text-muted-foreground">Empty:</span>
					{empty.map((group, index) => (
						<span key={group.key}>
							{group.label}
							{index < empty.length - 1 && (
								<span className="text-muted-foreground/40"> ·</span>
							)}
						</span>
					))}
				</p>
			)}
		</div>
	);
}
