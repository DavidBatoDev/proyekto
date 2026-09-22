import { AlertTriangle, Loader2, Lock, RotateCcw } from "lucide-react";
import { useMemo, useState } from "react";
import { AppDialog } from "@/components/common/AppDialog";
import { SettingSwitch } from "@/components/team-time/SettingSwitch";
import {
	useAdminPlanLimitsQuery,
	useIsSuperAdmin,
	useUpdatePlanLimitsMutation,
} from "@/hooks/useAdminPlans";
import { useToast } from "@/hooks/useToast";
import {
	LIMIT_DEFINITIONS,
	type LimitCell,
	type LimitKind,
	PLAN_ORDER,
	type PlanId,
	planLabel,
} from "@/lib/planLimits";
import {
	type AdminLimitKeyMeta,
	type AdminPlanLimits,
	diffPlanLimits,
	dirtyChanges,
	draftCell,
	findTierInversions,
	isPlanLimitsStaleError,
	limitedFallback,
	MAX_ADMIN_NOTE,
	MAX_DISPLAY_LABEL,
	mergeDraft,
	minimumFor,
	type PlanLimitsDraft,
	sameCell,
	validateCell,
	withDraftCell,
} from "@/lib/planLimitsAdmin";

/**
 * /admin/plans — what each plan includes, edited in place.
 *
 * Edits collect in a draft of overrides and go to the server in ONE PUT with
 * the matrix `version` the page loaded; a save that lost a race comes back
 * 409 `plan_limits_stale` and the page asks for a reload (the draft survives
 * it). Any admin can read; only a super admin gets live controls.
 */

const GROUP_ORDER = ["usage", "ai", "governance", "team", "platform"];
const GROUP_LABELS: Record<string, string> = {
	usage: "Usage",
	ai: "AI",
	governance: "Delivery governance",
	team: "Team",
	platform: "Platform",
};

const PUBLIC_PRICING_NOTE = "Public pricing updates within about 5 minutes.";
const GRANDFATHER_NOTE =
	"Workspaces already over it keep everything; only new creation is blocked.";
const STALE_MESSAGE = "Changed by someone else since you opened this page.";

interface LimitRow {
	key: string;
	label: string;
	kind: LimitKind;
	group: string;
	enforced: boolean;
	min: number;
	description: string | null;
}

interface LimitGroupRows {
	group: string;
	label: string;
	rows: LimitRow[];
}

/** Server key order (sort_order), bucketed into the catalogue's groups. */
function buildGroups(keys: readonly AdminLimitKeyMeta[]): LimitGroupRows[] {
	const source: AdminLimitKeyMeta[] = keys.length
		? [...keys].sort((a, b) => a.sort_order - b.sort_order)
		: LIMIT_DEFINITIONS.map((definition, index) => ({
				key: definition.key,
				kind: definition.kind,
				label: definition.label,
				unit: definition.unit?.plural ?? null,
				group: definition.group,
				sort_order: index,
				description: null,
				enforced: definition.enforced,
			}));
	const byGroup = new Map<string, LimitRow[]>();
	for (const meta of source) {
		const rows = byGroup.get(meta.group) ?? [];
		rows.push({
			key: meta.key,
			label: meta.label,
			kind: meta.kind,
			group: meta.group,
			enforced: meta.enforced,
			min: minimumFor(meta.key, meta.kind, meta.min),
			description: meta.description,
		});
		byGroup.set(meta.group, rows);
	}
	const rank = (group: string) => {
		const index = GROUP_ORDER.indexOf(group);
		return index === -1 ? GROUP_ORDER.length : index;
	};
	return [...byGroup.entries()]
		.sort(([a], [b]) => rank(a) - rank(b))
		.map(([group, rows]) => ({
			group,
			label: GROUP_LABELS[group] ?? group,
			rows,
		}));
}

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

/** The newest `updated_at` among a plan's cells, formatted; null if none. */
function planUpdatedAt(matrix: AdminPlanLimits, plan: PlanId): string | null {
	let newest: string | null = null;
	for (const cell of Object.values(matrix.cells[plan] ?? {})) {
		if (cell.updated_at && (!newest || cell.updated_at > newest)) {
			newest = cell.updated_at;
		}
	}
	return newest ? formatDate(newest) : null;
}

const cellId = (plan: PlanId, key: string) => `${plan}:${key}`;

export function PlanLimitsEditor() {
	const canEdit = useIsSuperAdmin();
	const query = useAdminPlanLimitsQuery();
	const save = useUpdatePlanLimitsMutation();
	const toast = useToast();

	const [draft, setDraft] = useState<PlanLimitsDraft>({});
	const [showLabels, setShowLabels] = useState(false);
	const [reviewOpen, setReviewOpen] = useState(false);
	const [note, setNote] = useState("");
	const [stale, setStale] = useState(false);
	const [saveError, setSaveError] = useState<string | null>(null);

	const matrix = query.data;
	const server = matrix?.cells ?? {};
	const groups = useMemo(() => buildGroups(matrix?.keys ?? []), [matrix]);
	const rowsByKey = useMemo(
		() => new Map(groups.flatMap((group) => group.rows.map((r) => [r.key, r]))),
		[groups],
	);

	const changes = useMemo(
		() => (matrix ? dirtyChanges(draft, matrix.cells) : []),
		[draft, matrix],
	);
	const errors = useMemo(() => {
		const out = new Map<string, string>();
		for (const plan of PLAN_ORDER) {
			for (const [key, cell] of Object.entries(draft[plan] ?? {})) {
				const error = validateCell(cell, rowsByKey.get(key)?.min ?? 0);
				if (error) out.set(cellId(plan, key), error);
			}
		}
		return out;
	}, [draft, rowsByKey]);

	const review = useMemo(() => {
		if (!matrix) return null;
		const keys = matrix.keys.length ? matrix.keys : [...rowsByKey.values()];
		const lines = diffPlanLimits(matrix.cells, draft, keys);
		const touched = [...new Set(lines.map((line) => line.key))];
		return {
			lines,
			inversions: findTierInversions(
				mergeDraft(matrix.cells, draft),
				keys,
				touched,
			),
			tightened: lines.filter((line) => line.enforced && line.tightened),
		};
	}, [draft, matrix, rowsByKey]);

	const setCell = (plan: PlanId, key: string, cell: LimitCell) => {
		if (!matrix || !canEdit) return;
		setDraft((current) =>
			withDraftCell(current, matrix.cells, plan, key, cell),
		);
	};

	const discard = () => {
		setDraft({});
		setNote("");
		setSaveError(null);
	};

	const reload = async () => {
		await query.refetch();
		setStale(false);
	};

	const submit = () => {
		if (!matrix || changes.length === 0 || errors.size > 0) return;
		setSaveError(null);
		save.mutate(
			{
				changes,
				note: note.trim() || undefined,
				base_version: matrix.version,
			},
			{
				onSuccess: (result) => {
					setDraft({});
					setNote("");
					setStale(false);
					setReviewOpen(false);
					toast.success(`Plan limits saved. ${PUBLIC_PRICING_NOTE}`);
					if (result.warnings.length > 0) {
						toast.warning(result.warnings.join(" "));
					}
				},
				onError: (err) => {
					if (isPlanLimitsStaleError(err)) {
						setStale(true);
						setReviewOpen(false);
						return;
					}
					setSaveError(
						err instanceof Error && err.message
							? err.message
							: "Couldn't save plan limits.",
					);
				},
			},
		);
	};

	const unsaved = changes.length;
	const drift = matrix?.drift;
	const hasDrift =
		!!drift &&
		(drift.missing_in_db.length > 0 || drift.unknown_to_code.length > 0);

	return (
		<div className="h-full overflow-auto bg-background">
			<div className="px-4 py-6 sm:px-8 sm:py-8">
				<div className="mb-6 flex flex-wrap items-end justify-between gap-4">
					<div>
						<h1 className="text-2xl font-bold text-foreground">
							Plans &amp; limits
						</h1>
						<p className="mt-1 max-w-2xl text-sm text-muted-foreground">
							What each plan includes. Enforced limits block new creation once a
							workspace reaches them; pricing-only rows are published on the
							pricing page but not enforced yet.
						</p>
					</div>
					{matrix && canEdit ? (
						<label className="flex items-center gap-2 text-sm text-muted-foreground">
							<input
								type="checkbox"
								checked={showLabels}
								onChange={(e) => setShowLabels(e.target.checked)}
								className="h-4 w-4 rounded border-input accent-primary"
							/>
							Edit pricing labels
						</label>
					) : null}
				</div>

				{!canEdit && matrix ? (
					<div className="mb-4 flex items-center gap-2 rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
						<Lock className="h-4 w-4 shrink-0" />
						Read only. Only a super admin can change plan limits.
					</div>
				) : null}

				{stale ? (
					<div
						role="alert"
						className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive"
					>
						<AlertTriangle className="h-4 w-4 shrink-0" />
						<span className="min-w-0 flex-1">
							{STALE_MESSAGE} Reload to see their changes; your unsaved edits
							are kept.
						</span>
						<button
							type="button"
							onClick={() => void reload()}
							disabled={query.isFetching}
							className="inline-flex items-center gap-1.5 rounded-lg border border-destructive/40 px-3 py-1.5 text-xs font-semibold transition hover:bg-destructive/10 disabled:opacity-50"
						>
							<RotateCcw className="h-3.5 w-3.5" />
							Reload
						</button>
					</div>
				) : null}

				{hasDrift && drift ? (
					<div className="mb-4 flex gap-2 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning-foreground">
						<AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
						<div>
							The database and the app disagree about which limits exist.
							{drift.missing_in_db.length > 0
								? ` Missing in the database: ${drift.missing_in_db.join(", ")}.`
								: ""}
							{drift.unknown_to_code.length > 0
								? ` Unknown to the app: ${drift.unknown_to_code.join(", ")}.`
								: ""}
						</div>
					</div>
				) : null}

				{query.isLoading ? (
					<div className="flex items-center justify-center py-24">
						<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
					</div>
				) : query.isError || !matrix ? (
					<div className="rounded-2xl border border-border bg-card p-8 text-center">
						<p className="text-sm text-muted-foreground">
							{query.error instanceof Error && query.error.message
								? query.error.message
								: "Couldn't load plan limits."}
						</p>
						<button
							type="button"
							onClick={() => void query.refetch()}
							className="mt-4 rounded-xl border border-input px-4 py-2 text-sm text-foreground transition hover:bg-muted"
						>
							Try again
						</button>
					</div>
				) : (
					<div className="overflow-x-auto rounded-2xl border border-border bg-card">
						<table className="w-full min-w-[960px] border-collapse text-sm">
							<thead>
								<tr className="border-b border-border">
									<th
										scope="col"
										className="w-[28%] px-4 py-3 text-left text-xs font-semibold text-muted-foreground"
									>
										Limit
									</th>
									{PLAN_ORDER.map((plan) => {
										const updated = planUpdatedAt(matrix, plan);
										return (
											<th
												key={plan}
												scope="col"
												className="px-3 py-3 text-left align-bottom"
											>
												<span className="block text-sm font-semibold text-foreground">
													{planLabel(plan)}
												</span>
												{updated ? (
													<span className="block text-[11px] font-normal text-muted-foreground">
														Updated {updated}
													</span>
												) : null}
											</th>
										);
									})}
								</tr>
							</thead>
							<tbody>
								{groups.map((group) => (
									<GroupRows
										key={group.group}
										group={group}
										server={server}
										draft={draft}
										errors={errors}
										canEdit={canEdit}
										showLabels={showLabels}
										onChange={setCell}
									/>
								))}
							</tbody>
						</table>
					</div>
				)}

				{canEdit ? (
					<p className="mt-3 text-xs text-muted-foreground">
						{PUBLIC_PRICING_NOTE}
					</p>
				) : null}
			</div>

			{canEdit && unsaved > 0 ? (
				<div className="sticky bottom-0 z-10 border-t border-border bg-card/95 px-4 py-3 backdrop-blur sm:px-8">
					<div className="flex flex-wrap items-center justify-between gap-3">
						<p className="text-sm text-foreground">
							<span className="font-semibold">
								{unsaved} unsaved {unsaved === 1 ? "change" : "changes"}
							</span>
							{errors.size > 0 ? (
								<span className="ml-2 text-destructive">
									Fix the highlighted {errors.size === 1 ? "cell" : "cells"}{" "}
									first.
								</span>
							) : null}
						</p>
						<div className="flex items-center gap-2">
							<button
								type="button"
								onClick={discard}
								className="rounded-xl border border-input px-4 py-2 text-sm text-foreground transition hover:bg-muted"
							>
								Discard
							</button>
							<button
								type="button"
								onClick={() => {
									setSaveError(null);
									setReviewOpen(true);
								}}
								// A stale page would only 409 again; the banner asks for a reload.
								disabled={errors.size > 0 || stale}
								className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
							>
								Review &amp; save
							</button>
						</div>
					</div>
				</div>
			) : null}

			<AppDialog
				open={reviewOpen && !!review}
				onClose={() => setReviewOpen(false)}
				title="Review plan limit changes"
				description={`${unsaved} ${unsaved === 1 ? "change" : "changes"}, saved together.`}
				size="lg"
				busy={save.isPending}
				footer={
					<>
						<button
							type="button"
							onClick={() => setReviewOpen(false)}
							disabled={save.isPending}
							className="rounded-xl border border-input px-4 py-2 text-sm text-foreground transition hover:bg-muted disabled:opacity-50"
						>
							Keep editing
						</button>
						<button
							type="button"
							onClick={submit}
							disabled={save.isPending || unsaved === 0 || errors.size > 0}
							className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
						>
							{save.isPending ? (
								<Loader2 className="h-3.5 w-3.5 animate-spin" />
							) : null}
							Save changes
						</button>
					</>
				}
			>
				{review ? (
					<div className="space-y-4">
						<ul className="space-y-1.5">
							{review.lines.map((line) => (
								<li
									key={cellId(line.plan, line.key)}
									className="rounded-lg bg-muted/40 px-3 py-2 text-sm text-foreground"
								>
									{line.text}
								</li>
							))}
						</ul>

						{review.inversions.length > 0 ? (
							<div className="rounded-xl border border-warning/40 bg-warning/10 px-3 py-2.5 text-sm text-warning-foreground">
								<p className="font-semibold">Check the tier order</p>
								<ul className="mt-1 list-disc space-y-0.5 pl-5">
									{review.inversions.map((warning) => (
										<li key={warning}>{warning}</li>
									))}
								</ul>
							</div>
						) : null}

						{review.tightened.length > 0 ? (
							<div className="rounded-xl border border-border bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground">
								<p>
									Tightens an enforced limit:{" "}
									{review.tightened
										.map((line) => `${planLabel(line.plan)} · ${line.label}`)
										.join(", ")}
									.
								</p>
								<p className="mt-1">{GRANDFATHER_NOTE}</p>
							</div>
						) : null}

						<div>
							<label
								htmlFor="plan-limits-note"
								className="text-xs font-semibold text-foreground"
							>
								Note for the audit log (optional)
							</label>
							<textarea
								id="plan-limits-note"
								value={note}
								maxLength={MAX_ADMIN_NOTE}
								onChange={(e) => setNote(e.target.value)}
								rows={3}
								placeholder="Why these limits are changing"
								className="mt-1 w-full resize-y rounded-xl border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
							/>
						</div>

						<p className="text-xs text-muted-foreground">
							{PUBLIC_PRICING_NOTE}
						</p>

						{saveError ? (
							<p role="alert" className="text-sm text-destructive">
								{saveError}
							</p>
						) : null}
					</div>
				) : null}
			</AppDialog>
		</div>
	);
}

type CellsByPlan = Partial<Record<PlanId, Record<string, LimitCell>>>;

function GroupRows({
	group,
	server,
	draft,
	errors,
	canEdit,
	showLabels,
	onChange,
}: {
	group: LimitGroupRows;
	server: CellsByPlan;
	draft: PlanLimitsDraft;
	errors: Map<string, string>;
	canEdit: boolean;
	showLabels: boolean;
	onChange: (plan: PlanId, key: string, cell: LimitCell) => void;
}) {
	return (
		<>
			<tr>
				<th
					scope="colgroup"
					colSpan={PLAN_ORDER.length + 1}
					className="border-b border-border bg-muted/40 px-4 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground"
				>
					{group.label}
				</th>
			</tr>
			{group.rows.map((row) => (
				<tr key={row.key} className="border-b border-border last:border-b-0">
					<th scope="row" className="px-4 py-3 text-left align-top font-normal">
						<span className="block font-medium text-foreground">
							{row.label}
						</span>
						<span
							className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${
								row.enforced
									? "bg-primary/10 text-primary"
									: "bg-muted text-muted-foreground"
							}`}
						>
							{row.enforced ? "Enforced" : "Pricing only"}
						</span>
						{row.description ? (
							<span className="mt-1 block text-xs text-muted-foreground">
								{row.description}
							</span>
						) : null}
					</th>
					{PLAN_ORDER.map((plan) => {
						const cell = draftCell(draft, server, plan, row.key);
						const serverCell = server[plan]?.[row.key];
						return (
							<td
								key={plan}
								className={`px-3 py-3 align-top ${
									cell && !sameCell(cell, serverCell) ? "bg-primary/5" : ""
								}`}
							>
								{cell ? (
									<LimitCellEditor
										plan={plan}
										row={row}
										cell={cell}
										serverCell={serverCell}
										error={errors.get(cellId(plan, row.key)) ?? null}
										disabled={!canEdit}
										showLabel={showLabels}
										onChange={(next) => onChange(plan, row.key, next)}
									/>
								) : (
									<span className="text-xs text-muted-foreground">
										Not stored
									</span>
								)}
							</td>
						);
					})}
				</tr>
			))}
		</>
	);
}

function LimitCellEditor({
	plan,
	row,
	cell,
	serverCell,
	error,
	disabled,
	showLabel,
	onChange,
}: {
	plan: PlanId;
	row: LimitRow;
	cell: LimitCell;
	serverCell: LimitCell | undefined;
	error: string | null;
	disabled: boolean;
	showLabel: boolean;
	onChange: (cell: LimitCell) => void;
}) {
	const name = `${planLabel(plan)} ${row.label}`;

	const labelEditor = showLabel ? (
		<input
			type="text"
			value={cell.display_label ?? ""}
			maxLength={MAX_DISPLAY_LABEL}
			disabled={disabled}
			onChange={(e) =>
				onChange({ ...cell, display_label: e.target.value || null })
			}
			placeholder="Pricing label"
			aria-label={`${name} pricing label`}
			className="mt-2 w-full rounded-lg border border-input bg-background px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none disabled:opacity-60"
		/>
	) : cell.display_label ? (
		<span className="mt-1 block text-[11px] text-muted-foreground">
			Shown as "{cell.display_label}"
		</span>
	) : null;

	if (cell.kind === "feature") {
		return (
			<div>
				<div className="flex items-center gap-2">
					<SettingSwitch
						checked={cell.enabled}
						disabled={disabled}
						label={name}
						onChange={(enabled) => onChange({ ...cell, enabled })}
					/>
					<span className="text-xs text-muted-foreground">
						{cell.enabled ? "On" : "Off"}
					</span>
				</div>
				{labelEditor}
				{error ? (
					<p className="mt-1 text-[11px] text-destructive">{error}</p>
				) : null}
			</div>
		);
	}

	const unlimited = cell.value === null;
	const inputValue =
		cell.value === null || Number.isNaN(cell.value) ? "" : String(cell.value);

	return (
		<div>
			<div className="flex flex-wrap items-center gap-2">
				<input
					type="number"
					inputMode="numeric"
					min={row.min}
					step={1}
					value={inputValue}
					disabled={disabled || unlimited}
					aria-label={name}
					aria-invalid={error ? true : undefined}
					onChange={(e) => {
						const raw = e.target.value;
						onChange({
							...cell,
							value: raw === "" ? Number.NaN : Number(raw),
						});
					}}
					className={`w-24 rounded-lg border bg-background px-2 py-1 text-sm text-foreground focus:outline-none disabled:opacity-60 ${
						error
							? "border-destructive focus:border-destructive"
							: "border-input focus:border-primary"
					}`}
				/>
				<label className="flex items-center gap-1.5 text-xs text-muted-foreground">
					<input
						type="checkbox"
						checked={unlimited}
						disabled={disabled}
						aria-label={`${name} unlimited`}
						onChange={(e) =>
							onChange({
								...cell,
								value: e.target.checked
									? null
									: limitedFallback(plan, row.key, serverCell, row.min),
							})
						}
						className="h-3.5 w-3.5 rounded border-input accent-primary"
					/>
					Unlimited
				</label>
			</div>
			{cell.kind === "quota" ? (
				<div className="mt-2 flex items-center gap-2">
					<SettingSwitch
						checked={cell.per_seat}
						disabled={disabled}
						label={`${name} per seat`}
						onChange={(per_seat) => onChange({ ...cell, per_seat })}
					/>
					<span className="text-xs text-muted-foreground">Per seat</span>
				</div>
			) : null}
			{labelEditor}
			{error ? (
				<p className="mt-1 text-[11px] text-destructive">{error}</p>
			) : null}
		</div>
	);
}
