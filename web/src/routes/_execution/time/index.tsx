import {
	createFileRoute,
	useNavigate,
	useRouterState,
} from "@tanstack/react-router";
import { useCallback } from "react";
import {
	TimePage,
	type TimePageSearchOptions,
} from "@/components/time/page/TimePage";
import { type TimePageSearch, validateTimePageSearch } from "@/lib/timeSearch";
import type { TimeEntryView } from "@/services/time.types";

/**
 * `/time`: the one personal Time page (ux.md › The Time Page). Search params:
 * `for`, `project`, `week`, `view` (`list` | `month`, D86), `entry`,
 * `tab` (`mine` | `approvals`) (lib/timeSearch.ts); `#waiting` opens the
 * Approvals tab when something waits. The page itself
 * lives in components/time/page.
 */
export const Route = createFileRoute("/_execution/time/")({
	validateSearch: validateTimePageSearch,
	component: TimeIndexPage,
});

function TimeIndexPage() {
	const search = Route.useSearch();
	const navigate = useNavigate({ from: Route.fullPath });
	const hash = useRouterState({ select: (state) => state.location.hash });

	const onSearchChange = useCallback(
		(patch: Partial<TimePageSearch>, options?: TimePageSearchOptions) => {
			void navigate({
				search: (prev: TimePageSearch) => ({ ...prev, ...patch }),
				replace: options?.replace ?? false,
			});
		},
		[navigate],
	);

	const onOpenTask = useCallback(
		(entry: TimeEntryView) => {
			if (!entry.project_id || !entry.task_id) return;
			void navigate({
				to: "/project/$projectId/roadmap",
				params: { projectId: entry.project_id },
				search: { taskId: entry.task_id } as never,
			});
		},
		[navigate],
	);

	return (
		<TimePage
			search={search}
			onSearchChange={onSearchChange}
			hash={hash}
			onOpenTask={onOpenTask}
		/>
	);
}
