// web/src/components/time/page/TimePolicyButton.tsx
//
// "Time policy" at the top right of the Time page, for the open workspace's
// owners and admins: a small popover with the policy's summary line
// ("Weekly · starts Monday · Asia/Manila · Approval required") and Edit time
// policy (`/w/<slug>/settings/time`). The page shows no policy cards; only a
// policy that needs confirming gets a banner (PolicyConfirmCard).

import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { CalendarClock } from "lucide-react";
import { useId, useRef, useState } from "react";
import { useDismissOnOutside } from "@/hooks/useDismissOnOutside";
import { isNativeApp } from "@/lib/platform";
import { isVisibleInApp } from "@/lib/platformSurfaces";
import { nativeSafe } from "@/lib/timeErrors";
import { timeQueries } from "@/queries/time";
import { browserTimeZone } from "@/services/time.service";
import type { WorkspaceTimeAdmin } from "@/services/time.types";
import { POLICY_SUMMARY_COPY, policySummaryParts } from "./PolicySummaryCards";

export const TIME_POLICY_BUTTON_COPY = {
	button: "Time policy",
	loading: "Loading the policy…",
} as const;

export function TimePolicyButton({ admin }: { admin: WorkspaceTimeAdmin }) {
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement | null>(null);
	const panelId = useId();
	useDismissOnOutside(open, ref, () => setOpen(false));
	const policyQuery = useQuery({
		...timeQueries.workspacePolicy(admin.workspace_id, {
			tz: browserTimeZone(),
		}),
		enabled: open,
	});
	const policy = policyQuery.data?.policy ?? null;
	const line = policy
		? nativeSafe(policySummaryParts(admin.name, policy).slice(1).join(" · "))
		: null;
	const editPath = admin.slug ? `/w/${admin.slug}/settings/time` : null;
	const canEdit = Boolean(
		admin.slug && editPath && isVisibleInApp(editPath, isNativeApp()),
	);

	return (
		<div ref={ref} className="relative">
			<button
				type="button"
				aria-expanded={open}
				aria-controls={open ? panelId : undefined}
				onClick={() => setOpen((value) => !value)}
				data-testid="time-policy-button"
				className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 max-sm:min-h-10"
			>
				<CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
				{TIME_POLICY_BUTTON_COPY.button}
			</button>
			{open ? (
				<div
					id={panelId}
					role="dialog"
					aria-label={TIME_POLICY_BUTTON_COPY.button}
					data-testid="time-policy-popover"
					className="absolute right-0 z-40 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-card p-3 text-sm shadow-lg"
				>
					<p className="font-medium text-foreground">
						{nativeSafe(admin.name.trim() || "This workspace")}
					</p>
					<p className="mt-0.5 text-muted-foreground">
						{line ?? TIME_POLICY_BUTTON_COPY.loading}
					</p>
					{canEdit && admin.slug ? (
						<Link
							to="/w/$workspaceSlug/settings/time"
							params={{ workspaceSlug: admin.slug }}
							className="mt-3 inline-flex h-8 items-center rounded-lg border border-border bg-background px-3 text-sm font-medium text-foreground hover:bg-muted"
						>
							{POLICY_SUMMARY_COPY.edit}
						</Link>
					) : null}
				</div>
			) : null}
		</div>
	);
}
