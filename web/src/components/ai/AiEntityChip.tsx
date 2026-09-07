import { displayNameOf, initialsOf } from "@/components/common/Avatar";
import type { AiEntityAssignee } from "@/services/ai-context.service";
import { AiMentionKindIcon } from "./AiMentionPicker";
import { entityLabelsMatch } from "./aiEntityLinks";
import { useAiEntity } from "./aiEntityResolver";
import {
	AI_MENTION_CHIP_TONE_CLASS,
	type AiMentionKind,
	AiRouteLink,
	resolveAiEntityDestination,
} from "./aiMentions";
import type { AiSessionScope } from "./scope";

export const AI_ENTITY_KIND_LABEL: Record<AiMentionKind, string> = {
	project: "Project",
	roadmap: "Roadmap",
	epic: "Epic",
	feature: "Feature",
	task: "Task",
	milestone: "Milestone",
	team: "Team",
	workspace: "Workspace",
};

const AVATAR_CLASS =
	"inline-flex h-4 w-4 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-[8px] text-muted-foreground ring-1 ring-background";

function assigneeName(assignee: AiEntityAssignee): string {
	return displayNameOf({
		...assignee,
		email: null,
		first_name: null,
		last_name: null,
	});
}

/** Up to three stacked 16px assignee avatars with a +N overflow slot. */
export function AiEntityAvatars({
	assignees,
	count,
}: {
	assignees: AiEntityAssignee[];
	count?: number;
}) {
	const total = Math.max(count ?? assignees.length, assignees.length);
	// Three visual slots; overflow occupies the last slot when needed.
	const visible = assignees.slice(0, total > 3 ? 2 : 3);
	const overflow = total - visible.length;
	return (
		<span
			aria-hidden="true"
			className="ml-0.5 inline-flex shrink-0 items-center"
		>
			{visible.map((assignee, index) => {
				const name = assigneeName(assignee);
				return (
					<span
						key={assignee.id}
						title={name}
						className={`${AVATAR_CLASS} ${index ? "-ml-1.5" : ""}`}
					>
						{assignee.avatar_url ? (
							<img
								src={assignee.avatar_url}
								alt={name}
								className="h-full w-full object-cover"
							/>
						) : (
							<span aria-label={name}>{initialsOf(name)}</span>
						)}
					</span>
				);
			})}
			{overflow > 0 && (
				<span
					className={`${AVATAR_CLASS} -ml-1.5`}
					title={`${overflow} more assignees`}
				>
					+{overflow}
				</span>
			)}
		</span>
	);
}

export interface AiEntityChipProps {
	kind: AiMentionKind;
	id: string;
	label: string;
	scope: AiSessionScope | null;
}

export function AiEntityChip({ kind, id, label, scope }: AiEntityChipProps) {
	const { data, isPending } = useAiEntity(kind, id);
	const entity = data?.accessible ? data : undefined;
	const canonical = entity?.title;
	const useCanonical = !!canonical && entityLabelsMatch(canonical, label);
	const mismatch = !!canonical && !useCanonical;
	const title = useCanonical ? canonical : label;
	const destination = entity
		? resolveAiEntityDestination(
				{
					kind,
					id,
					label: title,
					roadmapId: entity.roadmap_id ?? undefined,
					projectId: entity.project_id ?? null,
					slug: entity.slug ?? undefined,
				},
				scope,
			)
		: null;
	const status = entity?.status
		?.replace(/[_-]+/g, " ")
		.replace(/\b\w/g, (letter) => letter.toUpperCase());
	const chain = entity?.parent_chain
		?.map((parent) => parent.title)
		.filter(Boolean)
		.join(" / ");
	const assignees = kind === "task" ? (entity?.assignees ?? []) : [];
	const additionalAssignees = Math.max(
		0,
		(entity?.assignee_count ?? assignees.length) - assignees.length,
	);
	const assignedTo = assignees.length
		? `Assigned to ${assignees.map(assigneeName).join(", ")}${additionalAssignees ? `, and ${additionalAssignees} more` : ""}`
		: undefined;
	const attributes = {
		title: [
			AI_ENTITY_KIND_LABEL[kind],
			status,
			chain,
			assignedTo,
			mismatch ? `Canonical: ${canonical}` : undefined,
		]
			.filter(Boolean)
			.join(" · "),
		"data-entity-kind": kind,
		"data-entity-id": id,
		"data-entity-mismatch": mismatch ? "true" : undefined,
		"data-entity-state": isPending
			? "loading"
			: destination
				? "linked"
				: "plain",
		className: `inline-flex max-w-full items-center gap-1 rounded px-1 py-px align-baseline font-medium ${AI_MENTION_CHIP_TONE_CLASS.onSurface}`,
	};
	const body = (
		<>
			<AiMentionKindIcon kind={kind} size={12} />
			<span className="min-w-0 truncate">{title}</span>
			{kind === "task" && !!entity?.assignees?.length && (
				<AiEntityAvatars
					assignees={entity.assignees}
					count={entity.assignee_count}
				/>
			)}
		</>
	);
	return destination ? (
		<AiRouteLink
			{...destination}
			{...attributes}
			aria-label={`${AI_ENTITY_KIND_LABEL[kind]} ${title}`}
			className={`${attributes.className} underline-offset-2 hover:underline`}
		>
			{body}
		</AiRouteLink>
	) : (
		<span {...attributes}>{body}</span>
	);
}
