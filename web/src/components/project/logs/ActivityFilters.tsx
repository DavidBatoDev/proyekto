import { CalendarRange, Filter, Users } from "lucide-react";
import { FilterSelect } from "@/components/team-time/FilterSelect";
import { useProjectMembersQuery } from "@/hooks/useProjectQueries";
import { ACTION_FAMILIES, ACTION_FAMILY_LABELS } from "./activityCatalog";
import {
	DATE_PRESETS,
	DATE_PRESET_LABELS,
	type DatePreset,
	type LogsSearch,
} from "./logsSearch";

export function ActivityFilters({
	projectId,
	value,
	onChange,
}: {
	projectId: string;
	value: LogsSearch;
	onChange: (next: Partial<LogsSearch>) => void;
}) {
	const membersQuery = useProjectMembersQuery(projectId);

	// Actors come from the cached member list rather than a dedicated
	// options endpoint. Known limitation: a member who has since been removed
	// still has log rows but is not selectable here.
	const actorOptions = [
		{ value: "", label: "Everyone" },
		...(membersQuery.data ?? [])
			.filter((m) => m.user_id)
			.map((m) => ({
				value: m.user_id as string,
				label: m.user?.display_name || m.user?.email || "Unknown member",
				avatarUrl: m.user?.avatar_url ?? null,
			})),
	];

	const familyOptions = [
		{ value: "", label: "All activity" },
		...ACTION_FAMILIES.map((family) => ({
			value: family,
			label: ACTION_FAMILY_LABELS[family] ?? family,
		})),
	];

	const dateOptions = DATE_PRESETS.map((preset) => ({
		value: preset,
		label: DATE_PRESET_LABELS[preset],
	}));

	return (
		<div
			data-testid="activity-filters"
			className="flex flex-wrap items-center gap-x-3 gap-y-2"
		>
			<FilterSelect
				value={value.family ?? ""}
				options={familyOptions}
				onChange={(next) => onChange({ family: next || undefined })}
				icon={<Filter className="h-3.5 w-3.5" />}
				placeholder="All activity"
			/>
			<FilterSelect
				value={value.actor ?? ""}
				options={actorOptions}
				onChange={(next) => onChange({ actor: next || undefined })}
				icon={<Users className="h-3.5 w-3.5" />}
				placeholder="Everyone"
			/>
			<FilterSelect
				value={value.since}
				options={dateOptions}
				onChange={(next) => onChange({ since: next as DatePreset })}
				icon={<CalendarRange className="h-3.5 w-3.5" />}
				placeholder="All time"
			/>
		</div>
	);
}
