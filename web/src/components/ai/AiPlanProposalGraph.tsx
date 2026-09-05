import type { FC } from "react";
import type { AgentPlanProposalEpic } from "@/services/ai-agent.service";

type NodeKind = "epic" | "feature" | "task";

interface TreeRow {
	id: string;
	kind: NodeKind;
	title: string;
	description?: string | null;
	targetTitle?: string | null;
	/** Proposed assignees (tasks only), display names in set order. */
	assigneeLabels: string[];
	/**
	 * One bool per ancestor depth. true = draw a vertical rail (ancestor has more
	 * siblings below), false = blank (ancestor was the last child at that depth).
	 */
	ancestorRails: boolean[];
	isLast: boolean;
}

/**
 * `assignee_labels` (the full set) wins over the legacy single
 * `assignee_label`; blank entries are dropped.
 */
const resolveAssigneeLabels = (task: {
	assignee_label?: string | null;
	assignee_labels?: string[] | null;
}): string[] => {
	const list = (task.assignee_labels ?? [])
		.map((label) => (typeof label === "string" ? label.trim() : ""))
		.filter((label) => label.length > 0);
	if (list.length > 0) return list;
	const single = task.assignee_label?.trim();
	return single ? [single] : [];
};

const listWithAnd = (parts: string[]): string => {
	if (parts.length <= 1) return parts[0] ?? "";
	if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
	return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
};

const flatten = (epics: AgentPlanProposalEpic[]): TreeRow[] => {
	const rows: TreeRow[] = [];

	epics.forEach((epic, ei) => {
		const epicIsLast = ei === epics.length - 1;
		const epicId = `e${ei}`;
		rows.push({
			id: epicId,
			kind: "epic",
			title: epic.title,
			description: epic.description,
			assigneeLabels: [],
			ancestorRails: [],
			isLast: epicIsLast,
		});

		const features = epic.features ?? [];
		features.forEach((feature, fi) => {
			const featureIsLast = fi === features.length - 1;
			const featureId = `${epicId}-f${fi}`;
			rows.push({
				id: featureId,
				kind: "feature",
				title: feature.title,
				description: feature.description,
				targetTitle: feature.target_epic_title,
				assigneeLabels: [],
				ancestorRails: [!epicIsLast],
				isLast: featureIsLast,
			});

			const tasks = feature.tasks ?? [];
			tasks.forEach((task, ti) => {
				const taskIsLast = ti === tasks.length - 1;
				rows.push({
					id: `${featureId}-t${ti}`,
					kind: "task",
					title: task.title,
					description: task.description,
					targetTitle: task.target_feature_title,
					assigneeLabels: resolveAssigneeLabels(task),
					ancestorRails: [!epicIsLast, !featureIsLast],
					isLast: taskIsLast,
				});
			});
		});
	});

	return rows;
};

const labelClass: Record<NodeKind, string> = {
	epic: "bg-primary/20 text-primary",
	feature: "bg-primary/10 text-primary",
	task: "bg-muted text-muted-foreground",
};

const labelText: Record<NodeKind, string> = {
	epic: "Epic",
	feature: "Feature",
	task: "Task",
};

const titleClass: Record<NodeKind, string> = {
	epic: "font-semibold text-foreground",
	feature: "font-medium text-foreground",
	task: "text-muted-foreground",
};

const cardClass: Record<NodeKind, string> = {
	epic: "border-primary/25 bg-primary/[0.07]",
	feature: "border-primary/15 bg-primary/[0.04]",
	task: "border-border bg-card",
};

const RAIL_W = 16;

const Rail: FC<{ kind: "vertical" | "blank" | "branch" | "last" }> = ({
	kind,
}) => (
	<span
		aria-hidden
		className="relative inline-block shrink-0"
		style={{ width: RAIL_W, alignSelf: "stretch" }}
	>
		{(kind === "vertical" || kind === "branch") && (
			<span className="absolute left-1/2 top-0 bottom-0 w-px -translate-x-1/2 bg-border" />
		)}
		{kind === "last" && (
			<span className="absolute left-1/2 top-0 h-1/2 w-px -translate-x-1/2 bg-border" />
		)}
		{(kind === "branch" || kind === "last") && (
			<span className="absolute left-1/2 top-1/2 h-px w-1/2 bg-border" />
		)}
	</span>
);

export interface AiPlanProposalGraphProps {
	epics: AgentPlanProposalEpic[];
}

export const AiPlanProposalGraph: FC<AiPlanProposalGraphProps> = ({
	epics,
}) => {
	const rows = flatten(epics);
	if (rows.length === 0) return null;

	return (
		<div className="rounded-md border border-border bg-muted/40 px-2 py-2 text-sm">
			<ul className="space-y-1.5">
				{rows.map((row) => (
					<li key={row.id} className="flex items-stretch">
						{row.ancestorRails.map((show, i) => (
							<Rail key={`a-${i}`} kind={show ? "vertical" : "blank"} />
						))}
						{row.kind !== "epic" && (
							<Rail kind={row.isLast ? "last" : "branch"} />
						)}
						<div
							className={`flex-1 rounded-md border px-2.5 py-1.5 shadow-sm ${cardClass[row.kind]}`}
						>
							<div className="flex items-baseline gap-1.5 flex-wrap">
								<span
									className={`inline-flex items-center rounded-sm px-1 text-[9px] font-semibold uppercase tracking-wide ${labelClass[row.kind]}`}
								>
									{labelText[row.kind]}
								</span>
								<span className={titleClass[row.kind]}>{row.title}</span>
								{row.targetTitle ? (
									<span className="text-xs text-muted-foreground">
										under existing "{row.targetTitle}"
									</span>
								) : null}
								{row.assigneeLabels.length > 0 ? (
									<span
										className="inline-flex items-center rounded-full bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"
										data-testid="ai-plan-task-assignees"
									>
										{row.assigneeLabels.length === 1
											? "assigned to "
											: `${row.assigneeLabels.length} assignees: `}
										{listWithAnd(row.assigneeLabels)}
									</span>
								) : null}
							</div>
							{row.description ? (
								<div className="mt-0.5 text-xs text-muted-foreground">
									{row.description}
								</div>
							) : null}
						</div>
					</li>
				))}
			</ul>
		</div>
	);
};
