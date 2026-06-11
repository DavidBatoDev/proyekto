import type { FC } from "react";
import type { AgentPlanProposalEpic } from "@/services/roadmap-agent.service";

type NodeKind = "epic" | "feature" | "task";

interface TreeRow {
  id: string;
  kind: NodeKind;
  title: string;
  description?: string | null;
  targetTitle?: string | null;
  /**
   * One bool per ancestor depth. true = draw a vertical rail (ancestor has more
   * siblings below), false = blank (ancestor was the last child at that depth).
   */
  ancestorRails: boolean[];
  isLast: boolean;
}

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
          ancestorRails: [!epicIsLast, !featureIsLast],
          isLast: taskIsLast,
        });
      });
    });
  });

  return rows;
};

const labelClass: Record<NodeKind, string> = {
  epic: "bg-blue-900/40 text-blue-200 dark:bg-blue-900/60 dark:text-blue-200",
  feature: "bg-purple-900/40 text-purple-200 dark:bg-purple-900/60 dark:text-purple-200",
  task: "bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200",
};

const labelText: Record<NodeKind, string> = {
  epic: "Epic",
  feature: "Feature",
  task: "Task",
};

const titleClass: Record<NodeKind, string> = {
  epic: "font-semibold text-slate-100 dark:text-neutral-100",
  feature: "font-medium text-slate-200 dark:text-neutral-200",
  task: "text-neutral-700 dark:text-neutral-300",
};

const cardClass: Record<NodeKind, string> = {
  epic: "border-blue-900/60 bg-blue-950/40/60 dark:border-blue-900/70 dark:bg-blue-950/30",
  feature: "border-purple-700/60 bg-purple-950/40/60 dark:border-purple-900/70 dark:bg-purple-950/30",
  task: "border-neutral-200 bg-slate-900 dark:border-neutral-800 dark:bg-neutral-900",
};

const RAIL_W = 16;

const Rail: FC<{ kind: "vertical" | "blank" | "branch" | "last" }> = ({ kind }) => (
  <span
    aria-hidden
    className="relative inline-block shrink-0"
    style={{ width: RAIL_W, alignSelf: "stretch" }}
  >
    {(kind === "vertical" || kind === "branch") && (
      <span className="absolute left-1/2 top-0 bottom-0 w-px -translate-x-1/2 bg-neutral-300 dark:bg-neutral-700" />
    )}
    {kind === "last" && (
      <span className="absolute left-1/2 top-0 h-1/2 w-px -translate-x-1/2 bg-neutral-300 dark:bg-neutral-700" />
    )}
    {(kind === "branch" || kind === "last") && (
      <span className="absolute left-1/2 top-1/2 h-px w-1/2 bg-neutral-300 dark:bg-neutral-700" />
    )}
  </span>
);

export interface RoadmapAiPlanProposalGraphProps {
  epics: AgentPlanProposalEpic[];
}

export const RoadmapAiPlanProposalGraph: FC<RoadmapAiPlanProposalGraphProps> = ({
  epics,
}) => {
  const rows = flatten(epics);
  if (rows.length === 0) return null;

  return (
    <div className="rounded-md border border-neutral-200 bg-neutral-50/60 px-2 py-2 text-sm dark:border-neutral-800 dark:bg-neutral-900/40">
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
                  <span className="text-xs text-neutral-500">
                    under existing "{row.targetTitle}"
                  </span>
                ) : null}
              </div>
              {row.description ? (
                <div className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
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
