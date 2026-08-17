import { Tag } from "lucide-react";
import type { DecisionCategory } from "@/services/delivery.service";
import { CATEGORY_ACCENT, CATEGORY_ICON } from "./decisionModel";

/**
 * A category, rendered as its own icon and colour.
 *
 * Both come from stored KEYS resolved through maps in `decisionModel.ts`, never
 * from a stored hex value — that indirection is what keeps a user-defined
 * category inside the theme and working in dark mode.
 */
export function CategoryChip({
	category,
	size = "md",
}: {
	category: DecisionCategory | null | undefined;
	size?: "sm" | "md";
}) {
	const Icon = category ? (CATEGORY_ICON[category.icon] ?? Tag) : Tag;
	const accent = category
		? (CATEGORY_ACCENT[category.color] ?? CATEGORY_ACCENT.slate)
		: "bg-muted text-muted-foreground";

	const padding =
		size === "sm" ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-[11px]";
	const glyph = size === "sm" ? "h-2.5 w-2.5" : "h-3 w-3";

	return (
		<span
			className={`inline-flex shrink-0 items-center gap-1 rounded-full font-semibold ${padding} ${accent}`}
		>
			<Icon className={glyph} />
			{/* An uncategorised decision still gets a chip: a gap in the row reads as
			    a rendering bug, where "Uncategorised" reads as a fact. */}
			{category?.name ?? "Uncategorised"}
		</span>
	);
}
