import { Link } from "@tanstack/react-router";
import {
	Check,
	GitBranch,
	MoreHorizontal,
	Send,
	Undo2,
	Upload,
	X,
} from "lucide-react";
import { useRef, useState } from "react";
import { AnchoredPopover } from "@/components/common/AnchoredPopover";
import { Avatar } from "@/components/common/Avatar";
import {
	canDecide as canDecideRequest,
	canMarkApplied,
	canWithdraw,
	isOpen as isOpenRequest,
	isOptimisticId,
} from "@/components/project/delivery/changeRequestCache";
import {
	CHANGE_REQUEST_STATUS_LABEL,
	changeRequestReference,
	crLinkSegments,
} from "@/components/project/delivery/changeRequestModel";
import { RoadmapNodeGlyph } from "@/components/roadmap/shared/NodeGlyph";
import type { ChangeRequest } from "@/services/delivery.service";
import type { ProfileSummary } from "@/services/teams.service";
import { CrDays, CrIconButton, CrStatusDot } from "./CrPrimitives";
import { CR_COLUMNS } from "./CrQueue";

/**
 * One line of the queue.
 *
 * A row, not a card: the point of the queue is that twenty requests fit on a
 * screen and the eye runs down the day column. Everything that needed a
 * three-column card body now lives in the drawer, one click away.
 *
 * The status predicates come from `changeRequestCache` — the same ones the
 * detail route uses, and the same ones the backend enforces. The old card
 * re-derived them from raw status strings, which meant two places to update when
 * the state machine moved.
 */
export function CrRow({
	request,
	projectId,
	accentBar,
	requester,
	canCreate,
	canDecide,
	busy,
	onOpen,
	onSubmit,
	onDecide,
	onApply,
	onWithdraw,
	onEdit,
	onDelete,
}: {
	request: ChangeRequest;
	projectId: string;
	/** The group's accent, drawn down the row's left edge. */
	accentBar: string;
	requester: ProfileSummary | null;
	canCreate: boolean;
	canDecide: boolean;
	busy: boolean;
	onOpen: () => void;
	onSubmit: () => void;
	onDecide: () => void;
	onApply: () => void;
	onWithdraw: () => void;
	onEdit: () => void;
	onDelete: () => void;
}) {
	// Still being created: it exists only in the cache, so its detail route and
	// its actions have nothing to address yet.
	const saving = isOptimisticId(request.id);
	const links = request.links ?? [];
	const leadLink = links.length ? crLinkSegments(links[0]).at(-1) : undefined;

	return (
		<div
			className={`group relative ${CR_COLUMNS} border-b border-border/60 px-3 py-2.5 pl-4 transition-colors last:border-b-0 hover:bg-muted/40 ${
				saving ? "pointer-events-none opacity-60" : ""
			}`}
		>
			{/* The group's colour, carried down the row's edge. */}
			<span
				aria-hidden
				className={`absolute inset-y-0 left-0 w-[3px] ${accentBar}`}
			/>

			{/* Reference — monospace so the column reads as a register. */}
			<span className="hidden font-mono text-[11px] text-muted-foreground lg:block">
				{changeRequestReference(request)}
			</span>

			<div className="min-w-0">
				{saving ? (
					<span className="block truncate text-sm font-semibold text-foreground">
						{request.title}
					</span>
				) : (
					<button
						type="button"
						onClick={onOpen}
						className="block w-full truncate text-left text-sm font-semibold text-foreground hover:text-primary"
					>
						{request.title}
					</button>
				)}
				{/* Below `lg` the promoted columns fold back under the title, so a
				    narrow screen still gets every fact without a horizontal scroll. */}
				<div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 lg:hidden">
					<span className="font-mono text-[10px] text-muted-foreground">
						{changeRequestReference(request)}
					</span>
					{requester && (
						<span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
							<Avatar user={requester} size="xs" />
							{requester.display_name ?? "Someone"}
						</span>
					)}
					{leadLink && (
						<span className="inline-flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground">
							<RoadmapNodeGlyph kind={leadLink.kind} size={11} />
							<span className="truncate">{leadLink.title}</span>
						</span>
					)}
					<CrStatusDot
						status={request.status}
						label={CHANGE_REQUEST_STATUS_LABEL[request.status]}
					/>
				</div>
			</div>

			{/* Raised by, affected work and status become real columns from `lg`, so
			    the width carries information instead of whitespace. */}
			<span className="hidden min-w-0 items-center gap-1.5 text-xs text-muted-foreground lg:flex">
				{requester ? (
					<>
						<Avatar user={requester} size="xs" />
						<span className="truncate">
							{requester.display_name ?? "Someone"}
						</span>
					</>
				) : (
					<span className="text-muted-foreground/50">—</span>
				)}
			</span>

			<span className="hidden min-w-0 items-center gap-1.5 text-xs text-muted-foreground lg:flex">
				{leadLink ? (
					<>
						<RoadmapNodeGlyph kind={leadLink.kind} size={12} />
						<span className="truncate">{leadLink.title}</span>
						{links.length > 1 && (
							<span className="shrink-0 text-muted-foreground/70">
								+{links.length - 1}
							</span>
						)}
					</>
				) : (
					<span className="text-muted-foreground/50">Nothing linked</span>
				)}
			</span>

			<span className="hidden lg:block">
				<CrStatusDot
					status={request.status}
					label={CHANGE_REQUEST_STATUS_LABEL[request.status]}
				/>
			</span>

			{/* Schedule impact — the column the eye runs down. */}
			<span className="hidden justify-self-end lg:block">
				<CrDays days={request.impact_timeline_days} />
			</span>

			<span className="hidden justify-self-end text-[11px] tabular-nums text-muted-foreground lg:block">
				{ageLabel(request)}
			</span>

			<div className="flex shrink-0 items-center gap-1 justify-self-end">
				<span className="lg:hidden">
					<CrDays days={request.impact_timeline_days} />
				</span>
				{saving && (
					<span className="px-1 text-[11px] text-muted-foreground">
						Saving…
					</span>
				)}

				{!saving && canDecide && canDecideRequest(request) && (
					<>
						<CrIconButton
							icon={Check}
							label="Decide"
							tone="positive"
							disabled={busy}
							onClick={onDecide}
						/>
					</>
				)}

				{!saving && canDecide && canMarkApplied(request) && (
					<CrIconButton
						icon={Upload}
						label="Record it as applied to the roadmap"
						tone="positive"
						disabled={busy}
						onClick={onApply}
					/>
				)}

				{!saving && canCreate && isOpenRequest(request) && (
					<CrIconButton
						icon={Send}
						label="Submit for decision"
						disabled={busy}
						onClick={onSubmit}
					/>
				)}

				{!saving && (canCreate || canDecide) && (
					<RowMenu
						request={request}
						projectId={projectId}
						canCreate={canCreate}
						canDecide={canDecide}
						busy={busy}
						onEdit={onEdit}
						onWithdraw={onWithdraw}
						onDelete={onDelete}
					/>
				)}
			</div>
		</div>
	);
}

/** Whole days since the row last moved. */
function ageLabel(request: ChangeRequest): string {
	const since = Date.parse(request.updated_at);
	if (Number.isNaN(since)) return "";
	const days = Math.max(0, Math.floor((Date.now() - since) / 86_400_000));
	return days === 0 ? "today" : `${days}d`;
}

/**
 * The overflow menu.
 *
 * This is where `withdraw`, `update` and `remove` finally surface — all three are
 * wired in `useChangeRequestMutations` and, before the queue, were reachable only
 * by opening the detail page.
 */
function RowMenu({
	request,
	projectId,
	canCreate,
	canDecide,
	busy,
	onEdit,
	onWithdraw,
	onDelete,
}: {
	request: ChangeRequest;
	projectId: string;
	canCreate: boolean;
	canDecide: boolean;
	busy: boolean;
	onEdit: () => void;
	onWithdraw: () => void;
	onDelete: () => void;
}) {
	const [open, setOpen] = useState(false);
	const anchorRef = useRef<HTMLDivElement>(null);

	const item =
		"flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40";

	return (
		<div ref={anchorRef}>
			<CrIconButton
				icon={MoreHorizontal}
				label="More actions"
				onClick={() => setOpen((value) => !value)}
			/>
			{/* Portaled rather than absolutely positioned: the group container has
			    `overflow-hidden` so its rows clip to the rounded corners, which also
			    clipped this menu to a sliver. AnchoredPopover escapes that, clamps to
			    the viewport and flips above when the row is near the bottom. */}
			<AnchoredPopover
				anchorRef={anchorRef}
				open={open}
				onClose={() => setOpen(false)}
				width={208}
				maxHeight={200}
				align="right"
				ariaLabel="Change request actions"
				className="overflow-auto rounded-md border border-border bg-card py-1 shadow-lg"
			>
				<div>
					<Link
						to="/project/$projectId/change-requests/$changeRequestId"
						params={{ projectId, changeRequestId: request.id }}
						className={item}
						onClick={() => setOpen(false)}
					>
						<GitBranch className="h-3.5 w-3.5 text-muted-foreground" />
						Open the full record
					</Link>

					{canCreate && isOpenRequest(request) && (
						<button
							type="button"
							className={item}
							disabled={busy}
							onClick={() => {
								setOpen(false);
								onEdit();
							}}
						>
							<Send className="h-3.5 w-3.5 text-muted-foreground" />
							Edit
						</button>
					)}

					{canCreate && canWithdraw(request) && (
						<button
							type="button"
							className={item}
							disabled={busy}
							onClick={() => {
								setOpen(false);
								onWithdraw();
							}}
						>
							<Undo2 className="h-3.5 w-3.5 text-muted-foreground" />
							Withdraw
						</button>
					)}

					{canDecide && (
						<button
							type="button"
							className={`${item} text-destructive`}
							disabled={busy}
							onClick={() => {
								setOpen(false);
								onDelete();
							}}
						>
							<X className="h-3.5 w-3.5" />
							Delete
						</button>
					)}
				</div>
			</AnchoredPopover>
		</div>
	);
}
