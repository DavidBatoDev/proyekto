interface TileOptionProps {
	name: string;
	value: string;
	label: string;
	description?: string;
	checked: boolean;
	onChange: () => void;
	compact?: boolean; // Support both modal and full-page sizing
}

export function TileOption({
	name,
	value,
	label,
	description,
	checked,
	onChange,
	compact = false,
}: TileOptionProps) {
	const padding = compact ? "p-3" : "p-4";
	const borderRadius = compact ? "rounded-lg" : "rounded-xl";
	const radioSize = compact ? "w-4 h-4" : "w-5 h-5";
	const margin = compact ? "ml-2.5" : "ml-3";
	const descriptionSize = compact ? "text-[11px]" : "text-xs";
	const descriptionMargin = compact ? "mt-0.5" : "mt-1";

	return (
		<label
			className={`relative flex items-start ${padding} ${borderRadius} border-2 transition-all cursor-pointer ${
				checked
					? "border-primary bg-primary/10 shadow-md"
					: "border-border bg-card shadow-sm hover:border-primary/50 hover:bg-muted/60"
			}`}
		>
			<div className="flex items-center h-5">
				<input
					type="radio"
					name={name}
					value={value}
					checked={checked}
					onChange={onChange}
					className={`${radioSize} accent-primary focus:ring-primary`}
				/>
			</div>
			<div className={`${margin} text-sm`}>
				<span
					className={`block font-semibold ${checked ? "text-foreground" : "text-muted-foreground"}`}
				>
					{label}
				</span>
				{description && (
					<span
						className={`${descriptionSize} text-muted-foreground ${descriptionMargin} block`}
					>
						{description}
					</span>
				)}
			</div>
		</label>
	);
}
