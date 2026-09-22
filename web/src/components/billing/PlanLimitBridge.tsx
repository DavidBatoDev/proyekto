import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import type { ToastAction } from "@/contexts/ToastContext";
import { useToast } from "@/hooks/useToast";
import { useCurrentWorkspace } from "@/hooks/useWorkspaceQueries";
import {
	type PlanLimitInfo,
	setPlanLimitNotifier,
} from "@/lib/planLimitErrors";
import { planLimitToastCopy } from "@/lib/usageCopy";
import { workspaceKeys } from "@/queries/workspaces";

/** Long enough to read a sentence and reach the button. */
const PLAN_LIMIT_TOAST_MS = 8000;

/**
 * Turns every blocked write into one upgrade prompt.
 *
 * The axios interceptor and the fetch-based project creates call
 * `notifyPlanLimit` from outside React; this component, mounted once inside
 * the ToastProvider and the router, is the notifier they reach. It picks the
 * action by the viewer's role in the BLOCKED workspace — which may not be the
 * one they are looking at, and may be one they do not belong to at all (an
 * invitee accepting into a full workspace):
 *
 *  - owner: "Upgrade" to that workspace's billing page
 *  - any other member: "View usage"
 *  - not a member: no action, the message says who to ask
 *
 * The blocked workspace's usage is refetched too, so any meter or disabled
 * button on screen catches up with what the server just said.
 */
export function PlanLimitBridge() {
	const { showToast } = useToast();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const { workspaces } = useCurrentWorkspace();

	// Read through a ref so the notifier registers once, not on every refetch
	// of the workspace list.
	const workspacesRef = useRef(workspaces);
	useEffect(() => {
		workspacesRef.current = workspaces;
	}, [workspaces]);

	useEffect(() => {
		const notify = (info: PlanLimitInfo) => {
			const workspace = info.workspaceId
				? (workspacesRef.current.find((item) => item.id === info.workspaceId) ??
					null)
				: null;
			const copy = planLimitToastCopy(info, workspace?.my_role ?? null);
			const slug = workspace?.slug ?? null;

			let action: ToastAction | undefined;
			if (slug && copy.action === "upgrade") {
				action = {
					label: copy.actionLabel ?? "Upgrade",
					onClick: () =>
						void navigate({
							to: "/w/$workspaceSlug/settings/billing",
							params: { workspaceSlug: slug },
						}),
				};
			} else if (slug && copy.action === "view_usage") {
				action = {
					label: copy.actionLabel ?? "View usage",
					onClick: () =>
						void navigate({
							to: "/w/$workspaceSlug/settings/usage",
							params: { workspaceSlug: slug },
						}),
				};
			}

			showToast({
				message: info.message || copy.message,
				severity: "warning",
				duration: PLAN_LIMIT_TOAST_MS,
				action,
			});

			if (info.workspaceId) {
				void queryClient.invalidateQueries({
					queryKey: workspaceKeys.usage(info.workspaceId),
				});
			}
		};

		setPlanLimitNotifier(notify);
		return () => setPlanLimitNotifier(null);
	}, [showToast, navigate, queryClient]);

	return null;
}
