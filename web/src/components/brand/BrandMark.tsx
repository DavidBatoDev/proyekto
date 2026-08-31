interface BrandMarkProps {
	/**
	 * `wordmark` — full "Proyekto" text (default; replaces legacy `logo1.svg`)
	 * `mark` — square icon-only variant (replaces legacy `logovector.svg`)
	 * `lockup` — the real primary lockup artwork exported from Figma
	 * `logomark` — the real icon-only mark artwork exported from Figma
	 */
	variant?: "wordmark" | "mark" | "lockup" | "logomark";
	/**
	 * Tailwind classes for sizing/positioning. Sizing is height-based to match
	 * the legacy `<img className="h-N">` usage pattern.
	 */
	className?: string;
	/**
	 * Optional accessible label override. Defaults to "Proyekto".
	 */
	ariaLabel?: string;
}

/**
 * Proyekto brand mark.
 *
 * `lockup` (logomark + "Proyekto") and `logomark` (icon only) render the real
 * artwork from `public/proyektologos/v3/` — indigo line art on transparency,
 * so both read on light and dark surfaces. `wordmark`/`mark` remain text-based
 * placeholders that inherit `currentColor`.
 *
 * Sizing: height-based (matches legacy `h-N` Tailwind classes used on the
 * old `<img>` tags). The `mark` variant is square; the `wordmark` flows to
 * the natural width of its text.
 */
export function BrandMark({
	variant = "wordmark",
	className,
	ariaLabel = "Proyekto",
}: BrandMarkProps) {
	if (variant === "lockup") {
		return (
			<img
				src="/proyektologos/v3/logo-primary.png"
				alt={ariaLabel}
				className={`w-auto object-contain ${className ?? ""}`}
			/>
		);
	}

	if (variant === "logomark") {
		return (
			<img
				src="/proyektologos/v3/logomark.png"
				alt={ariaLabel}
				className={`w-auto object-contain ${className ?? ""}`}
			/>
		);
	}

	if (variant === "mark") {
		return (
			<span
				role="img"
				aria-label={ariaLabel}
				className={`inline-flex aspect-square items-center justify-center rounded-lg bg-primary font-extrabold leading-none text-white ${
					className ?? ""
				}`}
				style={{
					fontFamily: "'Sora', 'Manrope', sans-serif",
					letterSpacing: "-0.02em",
					// Letter sizes proportionally to container height. ~78% leaves a
					// small breathing margin while keeping the P visually dominant.
					fontSize: "78%",
				}}
			>
				P
			</span>
		);
	}

	return (
		<span
			role="img"
			aria-label={ariaLabel}
			className={`inline-flex items-center font-extrabold leading-none ${
				className ?? ""
			}`}
			style={{
				fontFamily: "'Sora', 'Manrope', sans-serif",
				// Wordmark text fills the container height (~95% accounts for the
				// cap-height vs em-square gap so the visible letters reach the
				// top/bottom of the allotted space).
				fontSize: "95%",
				letterSpacing: "-0.025em",
				color: "currentColor",
			}}
		>
			Proyekto
		</span>
	);
}
