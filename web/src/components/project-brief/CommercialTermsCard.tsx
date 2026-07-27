import { useId } from "react";
import {
	type BillingMode,
	billingPeriodsForRange,
	type ContractTermUnit,
	computeContractTerm,
	configForCadence,
	formatContractDate,
	formatPeriodRange,
	type InvoiceCadence,
} from "@/lib/contract-term";
import type { PayPeriodConfig } from "@/services/teams.service";

export interface CommercialTerms {
	enabled: boolean;
	currency: string;
	billingMode: BillingMode;
	recurringFee: string;
	clientHourlyRate: string;
	includedHours: string;
	invoiceCadence: InvoiceCadence;
	termCount: string;
	termUnit: ContractTermUnit;
	serviceStartDate: string;
	serviceDescription: string;
}

export const DEFAULT_COMMERCIAL_TERMS: CommercialTerms = {
	enabled: false,
	currency: "USD",
	billingMode: "retainer",
	recurringFee: "",
	clientHourlyRate: "",
	includedHours: "",
	invoiceCadence: "semi_monthly",
	termCount: "12",
	termUnit: "month",
	serviceStartDate: "",
	serviceDescription: "",
};

const CURRENCIES = ["USD", "PHP", "EUR", "GBP", "AUD", "SGD", "CAD"];

/**
 * Converts the form's string fields into the API payload, dropping anything
 * the chosen billing mode does not use so a stale hourly rate can't linger on a
 * retainer contract.
 */
export function toContractPayload(terms: CommercialTerms) {
	if (!terms.enabled) return undefined;

	const fee = Number(terms.recurringFee);
	const rate = Number(terms.clientHourlyRate);
	const included = Number(terms.includedHours);
	const termCount = Number(terms.termCount);
	const usesFee =
		terms.billingMode === "retainer" || terms.billingMode === "hybrid";
	const usesRate =
		terms.billingMode === "time_based" || terms.billingMode === "hybrid";

	return {
		currency: terms.currency,
		billing_mode: terms.billingMode,
		recurring_fee: usesFee && fee > 0 ? fee : undefined,
		client_hourly_rate: usesRate && rate > 0 ? rate : undefined,
		included_hours:
			terms.billingMode === "hybrid" && included > 0 ? included : undefined,
		invoice_cadence: terms.invoiceCadence,
		service_start_date: terms.serviceStartDate || undefined,
		term_count:
			Number.isInteger(termCount) && termCount > 0 ? termCount : undefined,
		term_unit: terms.termUnit,
		service_description: terms.serviceDescription.trim() || undefined,
	};
}

interface Props {
	terms: CommercialTerms;
	onChange: (updates: Partial<CommercialTerms>) => void;
	/** The primary team's cut-offs, so the preview matches real payout periods. */
	payPeriodConfig?: PayPeriodConfig | null;
}

/**
 * Step 3 commercial terms (consultant mode).
 *
 * Everything here is optional — a consultant can skip it and complete the
 * contract later from the Contract tab. What it buys is the derived preview:
 * exact service/contract end dates and the real billing periods, computed from
 * the same rules the backend stores, so the numbers shown before saving are the
 * numbers that get saved.
 */
export function CommercialTermsCard({
	terms,
	onChange,
	payPeriodConfig,
}: Props) {
	const enabledId = useId();
	const feeId = useId();
	const rateId = useId();
	const includedId = useId();
	const termId = useId();
	const startId = useId();
	const descriptionId = useId();

	const usesFee =
		terms.billingMode === "retainer" || terms.billingMode === "hybrid";
	const usesRate =
		terms.billingMode === "time_based" || terms.billingMode === "hybrid";

	const term = terms.serviceStartDate
		? computeContractTerm({
				serviceStartDate: terms.serviceStartDate,
				termCount: Number(terms.termCount),
				termUnit: terms.termUnit,
			})
		: null;

	const periods = term
		? billingPeriodsForRange(
				configForCadence(terms.invoiceCadence, payPeriodConfig),
				term.serviceStartDate,
				term.serviceEndDate,
			)
		: [];

	return (
		<div className="rounded-2xl border border-border bg-card p-6 text-card-foreground shadow-sm">
			<label
				htmlFor={enabledId}
				className="flex cursor-pointer items-start gap-3"
			>
				<input
					id={enabledId}
					type="checkbox"
					checked={terms.enabled}
					onChange={(e) => onChange({ enabled: e.target.checked })}
					className="mt-1 h-4 w-4 accent-primary"
				/>
				<span>
					<span className="block text-sm font-semibold text-foreground">
						Set commercial terms now
					</span>
					<span className="mt-0.5 block text-xs text-muted-foreground">
						What the client pays and for how long. This creates a draft contract
						you can finish and sign in the project's Contract tab — you can skip
						it and do all of it later.
					</span>
				</span>
			</label>

			{terms.enabled && (
				<div className="mt-6 space-y-5">
					{/* Billing mode */}
					<div>
						<p className="mb-2 block text-sm font-semibold text-foreground">
							How is the client billed?
						</p>
						<div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
							<BillingModeOption
								label="Monthly retainer"
								hint="Flat fee each period"
								value="retainer"
								checked={terms.billingMode === "retainer"}
								onSelect={() => onChange({ billingMode: "retainer" })}
							/>
							<BillingModeOption
								label="Hourly"
								hint="Approved hours × rate"
								value="time_based"
								checked={terms.billingMode === "time_based"}
								onSelect={() => onChange({ billingMode: "time_based" })}
							/>
							<BillingModeOption
								label="Retainer + overage"
								hint="Fee plus extra hours"
								value="hybrid"
								checked={terms.billingMode === "hybrid"}
								onSelect={() => onChange({ billingMode: "hybrid" })}
							/>
						</div>
					</div>

					{/* Money */}
					<div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
						<Field label="Currency">
							<select
								value={terms.currency}
								onChange={(e) => onChange({ currency: e.target.value })}
								className={inputClass}
							>
								{CURRENCIES.map((code) => (
									<option key={code} value={code}>
										{code}
									</option>
								))}
							</select>
						</Field>

						{usesFee && (
							<Field label="Recurring fee" htmlFor={feeId}>
								<input
									id={feeId}
									type="number"
									min={0}
									step="0.01"
									inputMode="decimal"
									placeholder="15000"
									value={terms.recurringFee}
									onChange={(e) => onChange({ recurringFee: e.target.value })}
									className={inputClass}
								/>
							</Field>
						)}

						{usesRate && (
							<Field label="Client hourly rate" htmlFor={rateId}>
								<input
									id={rateId}
									type="number"
									min={0}
									step="0.01"
									inputMode="decimal"
									placeholder="15"
									value={terms.clientHourlyRate}
									onChange={(e) =>
										onChange({ clientHourlyRate: e.target.value })
									}
									className={inputClass}
								/>
							</Field>
						)}

						{terms.billingMode === "hybrid" && (
							<Field label="Hours included in the fee" htmlFor={includedId}>
								<input
									id={includedId}
									type="number"
									min={0}
									step="0.5"
									inputMode="decimal"
									placeholder="20"
									value={terms.includedHours}
									onChange={(e) => onChange({ includedHours: e.target.value })}
									className={inputClass}
								/>
							</Field>
						)}
					</div>

					{usesRate && (
						<p className="text-xs text-muted-foreground">
							This is the rate the <span className="font-semibold">client</span>{" "}
							pays. What you pay each team member is separate and stays
							internal.
						</p>
					)}

					{/* Cadence + term */}
					<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
						<Field label="Invoice every">
							<select
								value={terms.invoiceCadence}
								onChange={(e) =>
									onChange({ invoiceCadence: e.target.value as InvoiceCadence })
								}
								className={inputClass}
							>
								<option value="semi_monthly">
									Cut-off (twice a month, matches your team's periods)
								</option>
								<option value="monthly">Month</option>
							</select>
						</Field>

						<Field label="Service starts" htmlFor={startId}>
							<input
								id={startId}
								type="date"
								value={terms.serviceStartDate}
								onChange={(e) => onChange({ serviceStartDate: e.target.value })}
								className={`${inputClass} [color-scheme:light] dark:[color-scheme:dark]`}
							/>
						</Field>

						<Field label="Contract term" htmlFor={termId}>
							<div className="flex gap-2">
								<input
									id={termId}
									type="number"
									min={1}
									step="1"
									inputMode="numeric"
									value={terms.termCount}
									onChange={(e) => onChange({ termCount: e.target.value })}
									className={`${inputClass} w-24`}
								/>
								<select
									value={terms.termUnit}
									onChange={(e) =>
										onChange({ termUnit: e.target.value as ContractTermUnit })
									}
									className={inputClass}
								>
									<option value="month">months</option>
									<option value="year">years</option>
								</select>
							</div>
						</Field>

						<Field
							label="Service description (shown on invoices)"
							htmlFor={descriptionId}
						>
							<input
								id={descriptionId}
								type="text"
								placeholder="Digital marketing services"
								value={terms.serviceDescription}
								onChange={(e) =>
									onChange({ serviceDescription: e.target.value })
								}
								className={inputClass}
							/>
						</Field>
					</div>

					{/* Derived preview — the whole reason to capture terms here. */}
					{term ? (
						<div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
							<p className="text-sm font-semibold text-foreground">
								Service ends {formatContractDate(term.serviceEndDate)}
							</p>
							<p className="mt-1 text-xs text-muted-foreground">
								Contract ends {formatContractDate(term.contractEndDate)} ·{" "}
								{periods.length} invoice{periods.length === 1 ? "" : "s"} over
								the term
							</p>
							{periods.length > 0 && (
								<p className="mt-2 text-xs text-muted-foreground">
									First invoice covers {formatPeriodRange(periods[0])}, issued{" "}
									{formatContractDate(periods[0].invoiceDate)}
								</p>
							)}
						</div>
					) : (
						<p className="text-xs text-muted-foreground">
							Pick a service start date to see the exact end dates and billing
							schedule.
						</p>
					)}
				</div>
			)}
		</div>
	);
}

const inputClass =
	"w-full rounded-lg border border-input bg-card px-3 py-2 text-sm text-card-foreground shadow-sm outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/25";

function Field({
	label,
	htmlFor,
	children,
}: {
	label: string;
	htmlFor?: string;
	children: React.ReactNode;
}) {
	return (
		<div>
			<label
				htmlFor={htmlFor}
				className="mb-1.5 block text-xs font-semibold text-muted-foreground"
			>
				{label}
			</label>
			{children}
		</div>
	);
}

function BillingModeOption({
	label,
	hint,
	value,
	checked,
	onSelect,
}: {
	label: string;
	hint: string;
	value: string;
	checked: boolean;
	onSelect: () => void;
}) {
	return (
		<label
			className={`flex cursor-pointer items-start gap-2 rounded-xl border-2 p-3 transition-all ${
				checked
					? "border-primary bg-primary/10 shadow-sm"
					: "border-border bg-card hover:border-primary/50 hover:bg-muted/60"
			}`}
		>
			<input
				type="radio"
				name="billingMode"
				value={value}
				checked={checked}
				onChange={onSelect}
				className="mt-0.5 h-4 w-4 accent-primary"
			/>
			<span>
				<span
					className={`block text-sm font-semibold ${checked ? "text-foreground" : "text-muted-foreground"}`}
				>
					{label}
				</span>
				<span className="mt-0.5 block text-xs text-muted-foreground">
					{hint}
				</span>
			</span>
		</label>
	);
}
