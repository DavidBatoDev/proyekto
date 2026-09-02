import { CreditCard, Loader2 } from "lucide-react";
import { WorkspaceSettingsGate } from "@/components/workspace/settings/WorkspaceSettingsGate";
import {
	useWorkspaceInvitesQuery,
	useWorkspaceMembersQuery,
} from "@/hooks/useWorkspaceQueries";
import type { Workspace, WorkspacePlan } from "@/services/workspaces.service";

const PLAN_LABEL: Record<WorkspacePlan, string> = {
	free: "Free",
	pro: "Pro",
	business: "Business",
	enterprise: "Enterprise",
};

export function WorkspaceBillingPlaceholder() {
	return (
		<WorkspaceSettingsGate>
			{(workspace) => <BillingContent workspace={workspace} />}
		</WorkspaceSettingsGate>
	);
}

function BillingContent({ workspace }: { workspace: Workspace }) {
	const canManage =
		workspace.my_role === "owner" || workspace.my_role === "admin";
	// Only needed as the seat-count fallback when the workspace payload carries
	// no counter.
	const membersQuery = useWorkspaceMembersQuery(
		workspace.seats_used == null && workspace.member_count == null
			? workspace.id
			: null,
	);
	// Plain members cannot list invites, so don't fire a doomed request.
	const invitesQuery = useWorkspaceInvitesQuery(
		canManage ? workspace.id : null,
	);

	const plan = workspace.subscription?.plan ?? workspace.plan ?? "free";
	const seatsUsed =
		workspace.seats_used ?? workspace.member_count ?? membersQuery.data?.length;
	const invitedCount = (invitesQuery.data ?? []).filter(
		(invite) => invite.status === "pending",
	).length;

	return (
		<div className="app-fade-in">
			<header className="mb-8 flex items-start gap-4">
				<div className="hidden h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-primary/30 bg-primary/10 text-primary sm:flex">
					<CreditCard className="h-6 w-6" />
				</div>
				<div>
					<h1 className="text-3xl font-semibold tracking-tight text-foreground">
						Billing
					</h1>
					<p className="mt-2 max-w-2xl text-sm text-muted-foreground">
						The plan and seats for this workspace.
					</p>
				</div>
			</header>

			<section className="rounded-2xl border border-border bg-card p-5 text-card-foreground shadow-(--app-shadow-sm) sm:p-6">
				<p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
					Current plan
				</p>
				<p className="mt-2 text-3xl font-semibold text-foreground">
					{PLAN_LABEL[plan]}
				</p>
				<p className="mt-2 text-sm text-muted-foreground">
					Paid plans are coming soon. Everything in Proyekto is included while
					your workspace is on the free plan.
				</p>

				<div className="mt-6 flex flex-wrap gap-x-8 gap-y-4 border-t border-border pt-5">
					<div>
						<p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
							Seats in use
						</p>
						{seatsUsed == null && membersQuery.isLoading ? (
							<Loader2 className="mt-2 h-4 w-4 animate-spin text-muted-foreground" />
						) : (
							<p className="mt-1 text-xl font-semibold text-foreground">
								{seatsUsed ?? "—"}
							</p>
						)}
					</div>
					{canManage ? (
						<div>
							<p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
								Invited
							</p>
							<p className="mt-1 text-xl font-semibold text-foreground">
								{invitedCount}
							</p>
							<p className="text-xs text-muted-foreground">
								Pending invitations do not use a seat until accepted.
							</p>
						</div>
					) : null}
				</div>
			</section>
		</div>
	);
}
