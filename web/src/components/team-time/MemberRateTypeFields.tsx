import { useId } from "react";
import type { FixedRatePeriod, MemberRateType } from "@/services/teams.service";

export interface RateTypeDraft {
	rateType: MemberRateType;
	fixedAmount: string;
	fixedPeriod: FixedRatePeriod;
}

export const DEFAULT_RATE_TYPE_DRAFT: RateTypeDraft = {
	rateType: "hourly",
	fixedAmount: "",
	fixedPeriod: "month",
};

/** True when the draft is complete enough to save. */
export function isRateTypeDraftValid(draft: RateTypeDraft): boolean {
	if (draft.rateType !== "fixed") return true;
	const amount = Number(draft.fixedAmount);
	return Number.isFinite(amount) && amount > 0;
}

/** Maps the draft onto the create/update rate payload fields. */
export function toRateTypePayload(draft: RateTypeDraft) {
	if (draft.rateType !== "fixed") {
		// Explicit null clears any previous fixed amount when switching back.
		return { rate_type: "hourly" as const, fixed_amount: null };
	}
	return {
		rate_type: "fixed" as const,
		fixed_amount: Number(draft.fixedAmount),
		fixed_period: draft.fixedPeriod,
	};
}

interface Props {
	draft: RateTypeDraft;
	onChange: (updates: Partial<RateTypeDraft>) => void;
	disabled?: boolean;
}

/**
 * Whether a member is paid by the hour or a flat amount per period.
 *
 * A fixed member still logs time — the hours drive client billing, hour caps,
 * and delivery visibility — but their cost is the fixed amount rather than
 * duration × rate. The hourly and training rates stay visible either way so a
 * member can be switched back without re-entering them.
 */
export function MemberRateTypeFields({ draft, onChange, disabled }: Props) {
	const amountId = useId();
	const periodId = useId();
	const isFixed = draft.rateType === "fixed";

	return (
		<div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
			<div className="space-y-1.5">
				<span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
					Pay type
				</span>
				<div className="flex gap-2">
					<TypeButton
						label="Hourly"
						hint="Logged hours × rate"
						active={!isFixed}
						disabled={disabled}
						onClick={() => onChange({ rateType: "hourly" })}
					/>
					<TypeButton
						label="Fixed"
						hint="Flat amount per period"
						active={isFixed}
						disabled={disabled}
						onClick={() => onChange({ rateType: "fixed" })}
					/>
				</div>
			</div>

			{isFixed && (
				<div className="grid grid-cols-2 gap-3">
					<div className="space-y-1.5">
						<label
							htmlFor={amountId}
							className="block text-xs font-semibold uppercase tracking-wide text-slate-500"
						>
							Fixed amount <span className="text-rose-500">*</span>
						</label>
						<input
							id={amountId}
							type="number"
							min={0}
							step="0.01"
							value={draft.fixedAmount}
							disabled={disabled}
							onChange={(e) => onChange({ fixedAmount: e.target.value })}
							placeholder="e.g. 20000"
							className={`w-full rounded-lg border px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300 ${
								draft.fixedAmount ? "border-slate-300" : "border-rose-300"
							}`}
						/>
					</div>
					<div className="space-y-1.5">
						<label
							htmlFor={periodId}
							className="block text-xs font-semibold uppercase tracking-wide text-slate-500"
						>
							Per
						</label>
						<select
							id={periodId}
							value={draft.fixedPeriod}
							disabled={disabled}
							onChange={(e) =>
								onChange({ fixedPeriod: e.target.value as FixedRatePeriod })
							}
							className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
						>
							<option value="month">Month</option>
							<option value="semi_month">Cut-off (half month)</option>
						</select>
					</div>
					<p className="col-span-2 text-[11px] text-slate-500">
						This member is paid {draft.fixedAmount || "—"} per{" "}
						{draft.fixedPeriod === "month" ? "month" : "cut-off"} regardless of
						hours. They still log time, and hour limits still apply.
					</p>
				</div>
			)}
		</div>
	);
}

function TypeButton({
	label,
	hint,
	active,
	disabled,
	onClick,
}: {
	label: string;
	hint: string;
	active: boolean;
	disabled?: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			className={`flex-1 rounded-lg border px-3 py-2 text-left transition-colors disabled:opacity-50 ${
				active
					? "border-slate-900 bg-white shadow-sm"
					: "border-slate-200 bg-white hover:border-slate-400"
			}`}
		>
			<span
				className={`block text-sm font-semibold ${active ? "text-slate-900" : "text-slate-600"}`}
			>
				{label}
			</span>
			<span className="mt-0.5 block text-[11px] text-slate-500">{hint}</span>
		</button>
	);
}
