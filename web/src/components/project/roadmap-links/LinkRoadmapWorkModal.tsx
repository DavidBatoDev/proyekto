import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import { AppDialog } from "@/components/common/AppDialog";
import {
	useLinkedRoadmapQuery,
	useRoadmapFullQuery,
} from "@/hooks/useProjectQueries";
import { PrimaryButton, SecondaryButton } from "./DeliveryPrimitives";

/**
 * Picks the roadmap work a delivery object covers.
 *
 * Shared by Deliverables and Change Requests, whose link junctions accept
 * DIFFERENT targets: `deliverable_links` takes feature / task / milestone, while
 * `change_request_links` takes epic / feature / task / deliverable and has no
 * milestone column at all. So the allowed kinds are passed in rather than
 * assumed — a picker offering a milestone to a change request would produce a
 * guaranteed 400.
 *
 * Linking a feature covers all of its tasks, so the common case is one click.
 */

/** Every column any of these junctions can point at. */
export interface LinkTarget {
	epic_id?: string;
	feature_id?: string;
	task_id?: string;
	milestone_id?: string;
	deliverable_id?: string;
}

export type LinkKind = keyof LinkTarget extends `${infer K}_id` ? K : never;

/**
 * An existing link row, in the shape both entities share.
 *
 * Separate from `LinkTarget` because the two come from different directions: a
 * target being CREATED omits the columns it isn't using (`undefined`), while a
 * row READ back from the database has every column present and null. Accepting
 * both keeps callers from having to map `null` to `undefined` at the boundary.
 */
export interface ExistingLink {
	id: string;
	epic_id?: string | null;
	feature_id?: string | null;
	task_id?: string | null;
	milestone_id?: string | null;
	deliverable_id?: string | null;
}

export function LinkRoadmapWorkModal({
	projectId,
	links,
	allowed,
	isOpen,
	title = "Link roadmap work",
	description = "Linking a feature covers all of its tasks.",
	onClose,
	onLink,
	onUnlink,
	busy,
}: {
	projectId: string;
	/** Already-linked rows, so a target can offer Unlink instead of duplicating. */
	links: ExistingLink[];
	/** Which target kinds this junction accepts. */
	allowed: readonly LinkKind[];
	isOpen: boolean;
	title?: string;
	description?: string;
	onClose: () => void;
	onLink: (target: LinkTarget) => void;
	onUnlink: (linkId: string) => void;
	busy: boolean;
}) {
	const linkedRoadmap = useLinkedRoadmapQuery(projectId);
	const roadmap = useRoadmapFullQuery(linkedRoadmap.data?.id ?? "");
	const [expanded, setExpanded] = useState<Set<string>>(new Set());

	// Existing links, indexed by target id so a row can show as already linked.
	const linkedByTarget = useMemo(() => {
		const map = new Map<string, string>();
		for (const link of links) {
			const target =
				link.epic_id ??
				link.feature_id ??
				link.task_id ??
				link.milestone_id ??
				link.deliverable_id;
			if (target) map.set(target, link.id);
		}
		return map;
	}, [links]);

	const permits = (kind: LinkKind) => allowed.includes(kind);

	if (!isOpen) return null;

	const epics = roadmap.data?.epics ?? [];
	const milestones = roadmap.data?.milestones ?? [];

	const toggle = (id: string) =>
		setExpanded((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});

	const Row = ({
		id,
		label,
		sublabel,
		depth,
		target,
	}: {
		id: string;
		label: string;
		sublabel?: string;
		depth: number;
		target: LinkTarget;
	}) => {
		const existingLinkId = linkedByTarget.get(id);
		return (
			<div
				className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 hover:bg-muted/60"
				style={{ paddingLeft: `${depth * 16 + 8}px` }}
			>
				<span className="min-w-0">
					<span className="block truncate text-sm text-foreground">
						{label}
					</span>
					{sublabel && (
						<span className="block text-[11px] text-muted-foreground">
							{sublabel}
						</span>
					)}
				</span>
				{existingLinkId ? (
					<SecondaryButton
						onClick={() => onUnlink(existingLinkId)}
						disabled={busy}
						tone="danger"
					>
						Unlink
					</SecondaryButton>
				) : (
					<SecondaryButton onClick={() => onLink(target)} disabled={busy}>
						Link
					</SecondaryButton>
				)}
			</div>
		);
	};

	return (
		<AppDialog
			open={isOpen}
			onClose={onClose}
			size="lg"
			title={title}
			description={description}
			footer={<PrimaryButton onClick={onClose}>Done</PrimaryButton>}
		>
			<div>
				{roadmap.isPending && linkedRoadmap.data?.id ? (
					<div className="flex items-center justify-center py-12 text-muted-foreground">
						<Loader2 className="h-5 w-5 animate-spin" />
					</div>
				) : epics.length === 0 ? (
					<p className="px-2 py-8 text-center text-sm text-muted-foreground">
						This project has no roadmap work to link yet.
					</p>
				) : (
					<div className="space-y-0.5">
						{permits("milestone") && milestones.length > 0 && (
							<div className="mb-2">
								<p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
									Milestones
								</p>
								{milestones.map((milestone) => (
									<Row
										key={milestone.id}
										id={milestone.id}
										label={milestone.title}
										sublabel={milestone.target_date?.slice(0, 10)}
										depth={0}
										target={{ milestone_id: milestone.id }}
									/>
								))}
							</div>
						)}

						<p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
							Epics
						</p>
						{epics.map((epic) => (
							<div key={epic.id}>
								{/* An epic is a disclosure toggle everywhere, and additionally
								    linkable where the junction has an epic_id column. */}
								<div className="flex items-center gap-1">
									<button
										type="button"
										onClick={() => toggle(epic.id)}
										className="flex min-w-0 flex-1 items-center gap-1.5 rounded-lg px-2 py-1.5 text-left hover:bg-muted/60"
									>
										{expanded.has(epic.id) ? (
											<ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
										) : (
											<ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
										)}
										<span className="truncate text-sm font-medium text-foreground">
											{epic.title}
										</span>
										<span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
											{(epic.features ?? []).length} features
										</span>
									</button>
									{permits("epic") &&
										(linkedByTarget.has(epic.id) ? (
											<SecondaryButton
												onClick={() =>
													onUnlink(linkedByTarget.get(epic.id) as string)
												}
												disabled={busy}
												tone="danger"
											>
												Unlink
											</SecondaryButton>
										) : (
											<SecondaryButton
												onClick={() => onLink({ epic_id: epic.id })}
												disabled={busy}
											>
												Link
											</SecondaryButton>
										))}
								</div>

								{expanded.has(epic.id) &&
									(epic.features ?? []).map((feature) => (
										<div key={feature.id}>
											{permits("feature") && (
												<Row
													id={feature.id}
													label={feature.title}
													sublabel={`${(feature.tasks ?? []).length} tasks`}
													depth={1}
													target={{ feature_id: feature.id }}
												/>
											)}
											{permits("task") &&
												(feature.tasks ?? []).map((task) => (
													<Row
														key={task.id}
														id={task.id}
														label={task.title}
														depth={2}
														target={{ task_id: task.id }}
													/>
												))}
										</div>
									))}
							</div>
						))}
					</div>
				)}
			</div>
		</AppDialog>
	);
}
