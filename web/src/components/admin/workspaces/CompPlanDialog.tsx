import { AlertTriangle, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { AppDialog } from "@/components/common/AppDialog";
import {
	useAdminWorkspaceQuery,
	useSetWorkspaceCompMutation,
} from "@/hooks/useAdminPlans";
import { usePublicPlanLimits } from "@/hooks/usePlanLimits";
import { useToast } from "@/hooks/useToast";
import { cellValue, formatCount, planLabel } from "@/lib/planLimits";
import {
	COMP_PLANS,
	type CompPlan,
	compUntilToIso,
	compWarningCopy,
	isoToDateInput,
	MAX_ADMIN_NOTE,
	toDateInputValue,
} from "@/lib/planLimitsAdmin";
import type { AdminWorkspaceRow } from "@/services/admin.service";

/**
 * Grant or edit a complimentary plan for one workspace.
 *
 * A comp lifts the workspace to the chosen tier without billing; it never
 * touches a paid subscription, so the dialog says so when one exists. The
 * note is required because it is the only record of why revenue was given
 * away (it lands in the admin audit log, never on the workspace).
 */

const USAGE_KEYS = [
	{ key: "members", label: "Members" },
	{ key: "projects", label: "Projects" },
	{ key: "teams", label: "Teams" },
] as const;

const AUDIT_LABELS: Record<string, string> = {
	"workspace_comp.granted": "Comp granted",
	"workspace_comp.updated": "Comp updated",
	"workspace_comp.revoked": "Comp removed",
};

function formatDate(iso: string): string {
	const date = new Date(iso);
	return Number.isNaN(date.getTime())
		? ""
		: date.toLocaleDateString("en-US", {
				month: "short",
				day: "numeric",
				year: "numeric",
			});
}

export interface CompPlanDialogProps {
	open: boolean;
	workspace: AdminWorkspaceRow | null;
	onClose: () => void;
}

export function CompPlanDialog({
	open,
	workspace,
	onClose,
}: CompPlanDialogProps) {
	const toast = useToast();
	const save = useSetWorkspaceCompMutation();
	const { limits } = usePublicPlanLimits();
	const detail = useAdminWorkspaceQuery(open ? (workspace?.id ?? null) : null);

	const [plan, setPlan] = useState<CompPlan>("pro");
	const [until, setUntil] = useState("");
	const [note, setNote] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [warnings, setWarnings] = useState<string[] | null>(null);

	// Start from the current comp each time the dialog opens on a workspace.
	useEffect(() => {
		if (!open || !workspace) return;
		setPlan(workspace.complimentary?.plan ?? "pro");
		setUntil(isoToDateInput(workspace.complimentary?.until));
		setNote("");
		setError(null);
		setWarnings(null);
	}, [open, workspace]);

	if (!workspace) return null;

	const isEdit = !!workspace.complimentary;
	const trimmedNote = note.trim();
	const tomorrow = new Date();
	tomorrow.setDate(tomorrow.getDate() + 1);
	const minDate = toDateInputValue(tomorrow);
	const untilInvalid = until !== "" && until < minDate;
	const canSubmit =
		trimmedNote.length > 0 &&
		trimmedNote.length <= MAX_ADMIN_NOTE &&
		!untilInvalid &&
		!save.isPending;

	const submit = () => {
		if (!canSubmit) return;
		setError(null);
		save.mutate(
			{
				workspaceId: workspace.id,
				input: { plan, until: compUntilToIso(until), note: trimmedNote },
			},
			{
				onSuccess: (result) => {
					if (result.warnings.length > 0) {
						// Keep the dialog up so the warning is read, not toasted away.
						setWarnings(result.warnings);
						return;
					}
					toast.success(
						`${workspace.name} is on a complimentary ${planLabel(plan)} plan.`,
					);
					onClose();
				},
				onError: (err) => {
					setError(
						err instanceof Error && err.message
							? err.message
							: "Couldn't save the complimentary plan.",
					);
				},
			},
		);
	};

	const audit = detail.data?.audit.slice(0, 5) ?? [];

	if (warnings) {
		return (
			<AppDialog
				open={open}
				onClose={onClose}
				title="Complimentary plan saved"
				size="md"
				footer={
					<button
						type="button"
						onClick={onClose}
						className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90"
					>
						Done
					</button>
				}
			>
				<p className="text-sm text-foreground">
					{workspace.name} is on a complimentary {planLabel(plan)} plan.
				</p>
				<ul className="mt-3 space-y-2">
					{warnings.map((warning) => (
						<li
							key={warning}
							className="flex gap-2 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning-foreground"
						>
							<AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
							{compWarningCopy(warning)}
						</li>
					))}
				</ul>
			</AppDialog>
		);
	}

	return (
		<AppDialog
			open={open}
			onClose={onClose}
			title={isEdit ? "Edit complimentary plan" : "Comp a plan"}
			description={`${workspace.name} · ${workspace.slug}`}
			size="lg"
			busy={save.isPending}
			footer={
				<>
					<button
						type="button"
						onClick={onClose}
						disabled={save.isPending}
						className="rounded-xl border border-input px-4 py-2 text-sm text-foreground transition hover:bg-muted disabled:opacity-50"
					>
						Cancel
					</button>
					<button
						type="button"
						onClick={submit}
						disabled={!canSubmit}
						className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
					>
						{save.isPending ? (
							<Loader2 className="h-3.5 w-3.5 animate-spin" />
						) : null}
						{isEdit ? "Save comp" : "Comp plan"}
					</button>
				</>
			}
		>
			<div className="space-y-5">
				{workspace.subscription.has_provider_subscription ? (
					<div
						role="note"
						className="flex gap-2 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2.5 text-sm text-warning-foreground"
					>
						<AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
						<span>
							Comping doesn't cancel their paid subscription. They keep being
							billed for {planLabel(workspace.subscription.plan)} until an owner
							cancels it.
						</span>
					</div>
				) : null}

				<fieldset>
					<legend className="text-xs font-semibold text-foreground">
						Plan
					</legend>
					<div className="mt-2 grid gap-2 sm:grid-cols-3">
						{COMP_PLANS.map((option) => {
							const selected = option === plan;
							return (
								<label
									key={option}
									className={`cursor-pointer rounded-xl border px-3 py-3 transition ${
										selected
											? "border-primary bg-primary/5 ring-1 ring-primary"
											: "border-border hover:bg-muted/60"
									}`}
								>
									<input
										type="radio"
										name="comp-plan"
										value={option}
										checked={selected}
										onChange={() => setPlan(option)}
										className="sr-only"
									/>
									<span className="block text-sm font-semibold text-foreground">
										{planLabel(option)}
									</span>
									<span className="mt-0.5 block text-xs text-muted-foreground">
										{USAGE_KEYS.map(({ key, label }) => {
											const limit = cellValue(limits[option], key);
											return `${limit === null ? "Unlimited" : formatCount(limit)} ${label.toLowerCase()}`;
										}).join(" · ")}
									</span>
								</label>
							);
						})}
					</div>
				</fieldset>

				<div>
					<p className="text-xs font-semibold text-foreground">
						Usage against {planLabel(plan)}
					</p>
					<dl className="mt-2 grid grid-cols-3 gap-2">
						{USAGE_KEYS.map(({ key, label }) => {
							const used = workspace[key];
							const limit = cellValue(limits[plan], key);
							const over = limit !== null && used > limit;
							return (
								<div
									key={key}
									className="rounded-xl border border-border px-3 py-2"
								>
									<dt className="text-[11px] text-muted-foreground">{label}</dt>
									<dd
										className={`text-sm font-semibold ${over ? "text-destructive" : "text-foreground"}`}
									>
										{formatCount(used)}
										<span className="font-normal text-muted-foreground">
											{" "}
											/ {limit === null ? "Unlimited" : formatCount(limit)}
										</span>
									</dd>
								</div>
							);
						})}
					</dl>
				</div>

				<div>
					<label
						htmlFor="comp-until"
						className="text-xs font-semibold text-foreground"
					>
						Ends on (optional)
					</label>
					<input
						id="comp-until"
						type="date"
						value={until}
						min={minDate}
						onChange={(e) => setUntil(e.target.value)}
						className="mt-1 block w-48 rounded-xl border border-input bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
					/>
					<p
						className={`mt-1 text-xs ${untilInvalid ? "text-destructive" : "text-muted-foreground"}`}
					>
						{untilInvalid
							? "Pick a date after today, or leave it empty."
							: "Leave empty for no end date. The comp lasts through the end of that day."}
					</p>
				</div>

				<div>
					<label
						htmlFor="comp-note"
						className="text-xs font-semibold text-foreground"
					>
						Note (required)
					</label>
					<textarea
						id="comp-note"
						value={note}
						maxLength={MAX_ADMIN_NOTE}
						onChange={(e) => setNote(e.target.value)}
						rows={3}
						placeholder="Why this workspace gets a complimentary plan"
						className="mt-1 w-full resize-y rounded-xl border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
					/>
					<p className="mt-1 flex justify-between text-xs text-muted-foreground">
						<span>
							{trimmedNote.length === 0
								? "A note is required. It goes in the admin audit log."
								: "Goes in the admin audit log, not on the workspace."}
						</span>
						<span>
							{note.length}/{MAX_ADMIN_NOTE}
						</span>
					</p>
				</div>

				{audit.length > 0 ? (
					<div>
						<p className="text-xs font-semibold text-foreground">
							Recent changes
						</p>
						<ul className="mt-2 space-y-1.5">
							{audit.map((entry) => (
								<li key={entry.id} className="text-xs text-muted-foreground">
									<span className="font-medium text-foreground">
										{AUDIT_LABELS[entry.action] ?? entry.action}
									</span>{" "}
									· {formatDate(entry.created_at)}
									{entry.note ? ` · ${entry.note}` : ""}
								</li>
							))}
						</ul>
					</div>
				) : null}

				{error ? (
					<p role="alert" className="text-sm text-destructive">
						{error}
					</p>
				) : null}
			</div>
		</AppDialog>
	);
}
