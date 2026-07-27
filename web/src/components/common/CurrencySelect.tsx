import { useId } from "react";
import { CURRENCIES } from "@/lib/currency";

interface CurrencySelectProps {
	value: string;
	onChange: (code: string) => void;
	disabled?: boolean;
	/** Optional visible label; omit to render just the select. */
	label?: string;
	className?: string;
	id?: string;
}

/**
 * The single currency dropdown, backed by the shared `CURRENCIES` list. Replaces
 * ad-hoc `<select>`s (CommercialTermsCard) and the free-text currency `<input>`
 * in the rate modals, so every currency picker offers the same set.
 */
export function CurrencySelect({
	value,
	onChange,
	disabled,
	label,
	className,
	id,
}: CurrencySelectProps) {
	const generatedId = useId();
	const selectId = id ?? generatedId;
	// A value outside the known list (e.g. an old free-text rate currency) is
	// still shown so it isn't silently rewritten on the next save.
	const hasKnown = CURRENCIES.some((c) => c.code === value);

	return (
		<div className={className}>
			{label && (
				<label
					htmlFor={selectId}
					className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500"
				>
					{label}
				</label>
			)}
			<select
				id={selectId}
				value={value}
				disabled={disabled}
				onChange={(e) => onChange(e.target.value)}
				className="w-full rounded-lg border border-input bg-card px-3 py-2 text-sm text-card-foreground shadow-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/25 disabled:opacity-70"
			>
				{!hasKnown && value && <option value={value}>{value}</option>}
				{CURRENCIES.map((c) => (
					<option key={c.code} value={c.code}>
						{c.label}
					</option>
				))}
			</select>
		</div>
	);
}
