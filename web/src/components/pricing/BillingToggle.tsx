interface BillingToggleProps {
	yearly: boolean;
	onChange: (yearly: boolean) => void;
	/** Ties the switch to the price it controls, for screen readers. */
	id: string;
}

/**
 * The "Billed yearly" switch that sits inside each paid card.
 *
 * One piece of state lives on the page and every card renders it, so flipping
 * any switch moves all the prices at once — comparing plans on mixed billing
 * periods is not a thing anyone wants to do.
 */
export function BillingToggle({ yearly, onChange, id }: BillingToggleProps) {
	return (
		<div className="flex items-center gap-3">
			<button
				type="button"
				id={id}
				role="switch"
				aria-checked={yearly}
				onClick={() => onChange(!yearly)}
				className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
					yearly ? "bg-primary" : "bg-muted-foreground/30"
				}`}
			>
				<span
					className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
						yearly ? "translate-x-4" : "translate-x-0"
					}`}
				/>
			</button>
			<label
				htmlFor={id}
				className="cursor-pointer text-sm text-muted-foreground"
			>
				Billed yearly
			</label>
		</div>
	);
}
