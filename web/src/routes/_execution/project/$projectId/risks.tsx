import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, Plus, ShieldAlert, Sparkles } from "lucide-react";
import { useState } from "react";
import { AppSurfaceCard } from "@/components/common/AppPrimitives";
import { RequireProjectAccess } from "@/components/common/RequireProjectAccess";
import {
	DeliveryEmpty,
	DeliveryPageShell,
	DeliverySkeleton,
	FieldLabel,
	humanize,
	inputClass,
	PrimaryButton,
	SecondaryButton,
	StatusPill,
	type StatusTone,
} from "@/components/project/delivery/DeliveryPrimitives";
import {
	useRiskCandidatesQuery,
	useRiskMutations,
	useRisksQuery,
} from "@/hooks/useDeliveryQueries";
import { useProjectMyPermissionsQuery } from "@/hooks/useProjectQueries";
import type { RiskEntry, RiskSeverity } from "@/services/delivery.service";

export const Route = createFileRoute("/_execution/project/$projectId/risks")({
	component: RisksPage,
});

const SEVERITY_TONE: Record<RiskSeverity, StatusTone> = {
	low: "neutral",
	medium: "progress",
	high: "review",
	critical: "bad",
};

const STATUS_TONE: Record<RiskEntry["status"], StatusTone> = {
	open: "bad",
	mitigating: "review",
	monitoring: "progress",
	resolved: "good",
	accepted: "neutral",
	closed: "neutral",
};

function RisksPage() {
	const { projectId } = Route.useParams();
	// Start the list fetch alongside the permission check rather than after
	// it: RequireProjectAccess blocks its children until permissions resolve,
	// so a query called only inside the body queues behind that round trip.
	// Same cache key as the body's call, so this is one request, not two.
	useRisksQuery(projectId);
	return (
		<RequireProjectAccess
			projectId={projectId}
			access="delivery"
			loadingFallback={<DeliverySkeleton />}
		>
			<RisksBody projectId={projectId} />
		</RequireProjectAccess>
	);
}

function RisksBody({ projectId }: { projectId: string }) {
	const query = useRisksQuery(projectId);
	const permissions = useProjectMyPermissionsQuery(projectId);
	const mutations = useRiskMutations(projectId);
	const canEdit = permissions.data?.risks?.edit === true;
	const candidates = useRiskCandidatesQuery(projectId, canEdit);
	const [isCreating, setIsCreating] = useState(false);

	if (query.isPending) return <DeliverySkeleton />;

	const entries = query.data?.items ?? [];
	const canViewInternal = query.data?.can_view_internal ?? false;
	const blocked = candidates.data?.blocked_tasks ?? [];
	const atRisk = candidates.data?.at_risk_milestones ?? [];
	const hasCandidates = blocked.length + atRisk.length > 0;

	return (
		<DeliveryPageShell
			icon={ShieldAlert}
			title="Risks & Issues"
			subtitle="What could go wrong, what already has, and who owns it."
			action={
				canEdit ? (
					<PrimaryButton onClick={() => setIsCreating((open) => !open)}>
						<Plus className="h-4 w-4" />
						Log an entry
					</PrimaryButton>
				) : undefined
			}
		>
			{isCreating && canEdit && (
				<CreateRiskForm
					pending={mutations.create.isPending}
					onCancel={() => setIsCreating(false)}
					onSubmit={(body) =>
						mutations.create.mutate(body, {
							onSuccess: () => setIsCreating(false),
						})
					}
				/>
			)}

			{/* Derived signals. The register overlaps blocked work by design — these
			    flags carry no owner or mitigation, so promoting beats re-keying. */}
			{canEdit && hasCandidates && (
				<AppSurfaceCard className="mb-4 border-amber-200 bg-amber-50/60 p-4">
					<div className="flex items-start gap-2">
						<Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
						<div className="min-w-0">
							<p className="text-sm font-semibold text-amber-900">
								{blocked.length + atRisk.length} unregistered signal
								{blocked.length + atRisk.length === 1 ? "" : "s"}
							</p>
							<p className="mt-0.5 text-xs text-amber-800">
								Blocked work and at-risk milestones that nobody has entered in
								the register yet.
							</p>
							<div className="mt-3 flex flex-col gap-2">
								{blocked.map((task) => (
									<CandidateRow
										key={task.id}
										label={task.title}
										hint="Blocked task"
										disabled={mutations.create.isPending}
										onPromote={() =>
											mutations.create.mutate({
												kind: "issue",
												title: task.title,
												severity: "high",
												source_kind: "blocked_task",
												impact: "Task is blocked.",
											})
										}
									/>
								))}
								{atRisk.map((milestone) => (
									<CandidateRow
										key={milestone.id}
										label={milestone.title}
										hint={`Milestone ${milestone.status}`}
										disabled={mutations.create.isPending}
										onPromote={() =>
											mutations.create.mutate({
												kind: "risk",
												title: milestone.title,
												severity: "high",
												likelihood: "high",
												source_kind: "at_risk_milestone",
												impact: "Milestone is off track.",
											})
										}
									/>
								))}
							</div>
						</div>
					</div>
				</AppSurfaceCard>
			)}

			{!canViewInternal && (
				<p className="mb-4 text-xs text-slate-500">
					Some entries may be hidden — internal risks require the View internal
					risks permission.
				</p>
			)}

			{entries.length === 0 && !isCreating ? (
				<DeliveryEmpty
					icon={ShieldAlert}
					title="Nothing logged"
					description="A risk is something that might go wrong; an issue is something that already has. Give each one an owner and a mitigation so it doesn't live only in someone's head."
					action={
						canEdit ? (
							<PrimaryButton onClick={() => setIsCreating(true)}>
								<Plus className="h-4 w-4" />
								Log the first one
							</PrimaryButton>
						) : undefined
					}
				/>
			) : (
				<div className="flex flex-col gap-3">
					{entries.map((entry) => (
						<RiskCard
							key={entry.id}
							entry={entry}
							canEdit={canEdit}
							busy={mutations.update.isPending}
							onResolve={() =>
								mutations.update.mutate({
									id: entry.id,
									body: { status: "resolved" },
								})
							}
						/>
					))}
				</div>
			)}
		</DeliveryPageShell>
	);
}

function CandidateRow({
	label,
	hint,
	onPromote,
	disabled,
}: {
	label: string;
	hint: string;
	onPromote: () => void;
	disabled: boolean;
}) {
	return (
		<div className="flex items-center justify-between gap-3 rounded-lg bg-white/70 px-3 py-2">
			<div className="min-w-0">
				<p className="truncate text-sm text-slate-800">{label}</p>
				<p className="text-[11px] text-slate-500">{hint}</p>
			</div>
			<SecondaryButton onClick={onPromote} disabled={disabled}>
				Add to register
			</SecondaryButton>
		</div>
	);
}

function RiskCard({
	entry,
	canEdit,
	busy,
	onResolve,
}: {
	entry: RiskEntry;
	canEdit: boolean;
	busy: boolean;
	onResolve: () => void;
}) {
	const isClosed = ["resolved", "closed", "accepted"].includes(entry.status);

	return (
		<AppSurfaceCard className="p-5">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="min-w-0">
					<div className="flex flex-wrap items-center gap-2">
						{entry.kind === "issue" ? (
							<AlertTriangle className="h-4 w-4 text-red-500" />
						) : (
							<ShieldAlert className="h-4 w-4 text-amber-500" />
						)}
						<h3 className="text-sm font-semibold text-slate-900">
							{entry.title}
						</h3>
						<StatusPill
							label={entry.severity}
							tone={SEVERITY_TONE[entry.severity]}
						/>
						<StatusPill
							label={humanize(entry.status)}
							tone={STATUS_TONE[entry.status]}
						/>
						{entry.visibility === "internal" && (
							<StatusPill label="Internal" tone="neutral" />
						)}
					</div>
					{entry.description && (
						<p className="mt-1 text-sm text-slate-600">{entry.description}</p>
					)}
				</div>
				{canEdit && !isClosed && (
					<SecondaryButton onClick={onResolve} disabled={busy}>
						Mark resolved
					</SecondaryButton>
				)}
			</div>

			{(entry.impact || entry.mitigation) && (
				<div className="mt-4 grid gap-3 sm:grid-cols-2">
					{entry.impact && (
						<div className="rounded-lg bg-slate-50 p-3">
							<p className="text-xs font-semibold text-slate-600">Impact</p>
							<p className="mt-0.5 text-sm text-slate-800">{entry.impact}</p>
						</div>
					)}
					{entry.mitigation && (
						<div className="rounded-lg bg-slate-50 p-3">
							<p className="text-xs font-semibold text-slate-600">Mitigation</p>
							<p className="mt-0.5 text-sm text-slate-800">
								{entry.mitigation}
							</p>
						</div>
					)}
				</div>
			)}

			{entry.due_date && (
				<p className="mt-3 text-xs text-slate-500">
					Review by {entry.due_date}
				</p>
			)}
		</AppSurfaceCard>
	);
}

function CreateRiskForm({
	onSubmit,
	onCancel,
	pending,
}: {
	onSubmit: (body: {
		kind: "risk" | "issue";
		title: string;
		description?: string;
		severity?: RiskSeverity;
		likelihood?: "low" | "medium" | "high";
		impact?: string;
		mitigation?: string;
		visibility?: "internal" | "shared";
	}) => void;
	onCancel: () => void;
	pending: boolean;
}) {
	const [kind, setKind] = useState<"risk" | "issue">("risk");
	const [title, setTitle] = useState("");
	const [description, setDescription] = useState("");
	const [severity, setSeverity] = useState<RiskSeverity>("medium");
	const [likelihood, setLikelihood] = useState<"low" | "medium" | "high">(
		"medium",
	);
	const [mitigation, setMitigation] = useState("");
	const [shared, setShared] = useState(false);

	return (
		<AppSurfaceCard strong className="mb-4 p-5">
			<form
				onSubmit={(event) => {
					event.preventDefault();
					if (!title.trim()) return;
					onSubmit({
						kind,
						title: title.trim(),
						description: description.trim() || undefined,
						severity,
						// An issue has already happened, so it carries no likelihood.
						likelihood: kind === "risk" ? likelihood : undefined,
						mitigation: mitigation.trim() || undefined,
						visibility: shared ? "shared" : "internal",
					});
				}}
			>
				<div className="mb-3 flex gap-2">
					{(["risk", "issue"] as const).map((option) => (
						<button
							key={option}
							type="button"
							onClick={() => setKind(option)}
							className={`rounded-lg border px-3 py-1.5 text-xs font-semibold capitalize ${
								kind === option
									? "border-primary bg-primary/10 text-primary"
									: "border-slate-300 text-slate-600"
							}`}
						>
							{option}
						</button>
					))}
				</div>

				<label className="mb-3 block">
					<FieldLabel>Title</FieldLabel>
					<input
						value={title}
						onChange={(event) => setTitle(event.target.value)}
						className={inputClass}
						placeholder="Third-party API may not support bulk export"
					/>
				</label>
				<label className="mb-3 block">
					<FieldLabel>Description</FieldLabel>
					<textarea
						value={description}
						onChange={(event) => setDescription(event.target.value)}
						rows={2}
						className={inputClass}
					/>
				</label>

				<div className="mb-3 grid gap-3 sm:grid-cols-2">
					<label className="block">
						<FieldLabel>Severity</FieldLabel>
						<select
							value={severity}
							onChange={(event) =>
								setSeverity(event.target.value as RiskSeverity)
							}
							className={inputClass}
						>
							{(["low", "medium", "high", "critical"] as const).map((value) => (
								<option key={value} value={value}>
									{humanize(value)}
								</option>
							))}
						</select>
					</label>
					{kind === "risk" && (
						<label className="block">
							<FieldLabel>Likelihood</FieldLabel>
							<select
								value={likelihood}
								onChange={(event) =>
									setLikelihood(event.target.value as "low" | "medium" | "high")
								}
								className={inputClass}
							>
								{(["low", "medium", "high"] as const).map((value) => (
									<option key={value} value={value}>
										{humanize(value)}
									</option>
								))}
							</select>
						</label>
					)}
				</div>

				<label className="mb-3 block">
					<FieldLabel>Mitigation</FieldLabel>
					<textarea
						value={mitigation}
						onChange={(event) => setMitigation(event.target.value)}
						rows={2}
						className={inputClass}
						placeholder="What we're doing about it."
					/>
				</label>

				<label className="mb-4 flex items-center gap-2 text-sm text-slate-700">
					<input
						type="checkbox"
						checked={shared}
						onChange={(event) => setShared(event.target.checked)}
						className="h-4 w-4 rounded border-slate-300"
					/>
					Share with everyone on the project
					<span className="text-xs text-slate-500">
						(entries are internal by default)
					</span>
				</label>

				<div className="flex items-center gap-2">
					<PrimaryButton type="submit" disabled={pending || !title.trim()}>
						Log it
					</PrimaryButton>
					<SecondaryButton onClick={onCancel} disabled={pending}>
						Cancel
					</SecondaryButton>
				</div>
			</form>
		</AppSurfaceCard>
	);
}
