import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { ProfileModal } from "@/components/profile/ProfileModal";
import type { ConsultantPublicRates } from "@/queries/consultants";

const CURRENCIES = ["USD", "EUR", "GBP", "PHP", "SGD", "AUD", "CAD", "INR"];

const AVAILABILITY_OPTIONS = [
	{ value: "available", label: "Available for new work" },
	{ value: "partially_available", label: "Partly available" },
	{ value: "unavailable", label: "Not taking new work" },
];

export interface RatePayload {
	hourly_rate: number | null;
	currency: string;
	availability: string;
}

const FIELD_CLASS =
	"w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary";

/**
 * The rate editor for the WYSIWYG seller profiles. The private profile page
 * edits the rate card inline in its left rail; the marketplace pages edit
 * everything through modals, so the rate gets one too — same three public
 * fields the rail displays, nothing the page cannot show back.
 */
export function RateModal({
	isOpen,
	onClose,
	onSave,
	isSaving,
	rates,
}: {
	isOpen: boolean;
	onClose: () => void;
	onSave: (payload: RatePayload) => void;
	isSaving?: boolean;
	rates: ConsultantPublicRates | null;
}) {
	const [hourlyRate, setHourlyRate] = useState("");
	const [currency, setCurrency] = useState("USD");
	const [availability, setAvailability] = useState("available");

	// Re-seed on open, not on every prop change — a cancelled edit must not
	// survive into the next one.
	useEffect(() => {
		if (!isOpen) return;
		setHourlyRate(rates?.hourlyRate != null ? String(rates.hourlyRate) : "");
		setCurrency(rates?.currency ?? "USD");
		setAvailability(rates?.availability ?? "available");
	}, [isOpen, rates]);

	const submit = (event: React.FormEvent) => {
		event.preventDefault();
		onSave({
			hourly_rate: hourlyRate.trim() === "" ? null : Number(hourlyRate),
			currency,
			availability,
		});
	};

	return (
		<ProfileModal
			isOpen={isOpen}
			onClose={onClose}
			title="Rate & availability"
			width="sm"
		>
			<form onSubmit={submit} className="space-y-4 p-6">
				<div className="grid grid-cols-[1fr_110px] gap-3">
					<label className="block">
						<span className="mb-1 block text-xs font-medium text-muted-foreground">
							Hourly rate
						</span>
						<input
							type="number"
							min={0}
							step="0.01"
							value={hourlyRate}
							onChange={(event) => setHourlyRate(event.target.value)}
							placeholder="e.g. 60"
							className={FIELD_CLASS}
						/>
					</label>
					<label className="block">
						<span className="mb-1 block text-xs font-medium text-muted-foreground">
							Currency
						</span>
						<select
							value={currency}
							onChange={(event) => setCurrency(event.target.value)}
							className={FIELD_CLASS}
						>
							{CURRENCIES.map((code) => (
								<option key={code} value={code}>
									{code}
								</option>
							))}
						</select>
					</label>
				</div>

				<label className="block">
					<span className="mb-1 block text-xs font-medium text-muted-foreground">
						Availability
					</span>
					<select
						value={availability}
						onChange={(event) => setAvailability(event.target.value)}
						className={FIELD_CLASS}
					>
						{AVAILABILITY_OPTIONS.map((option) => (
							<option key={option.value} value={option.value}>
								{option.label}
							</option>
						))}
					</select>
				</label>

				<div className="flex justify-end gap-2 pt-2">
					<button
						type="button"
						onClick={onClose}
						className="cursor-pointer rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
					>
						Cancel
					</button>
					<button
						type="submit"
						disabled={isSaving}
						className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
					>
						{isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
						Save
					</button>
				</div>
			</form>
		</ProfileModal>
	);
}
