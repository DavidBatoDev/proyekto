import type { ServiceDescriptionSection } from "@/queries/serviceOfferings";
import { ServiceRichBody } from "./ServiceRichBody";

/**
 * How a section reads to a buyer. Shared by the public page and the editor's
 * preview so "what you see" is literally the same component, not a lookalike.
 *
 * `prose` is a heading over a rich-text body — HTML from the editor, or
 * markdown for sections written before it. `columns` is a spec strip: a
 * rule, then up to three labelled columns of short text — the shape used for
 * "Website type / Programming language / Features"-style facts, where a
 * paragraph would bury them.
 */
export function ServiceSectionView({
	section,
}: {
	section: ServiceDescriptionSection;
}) {
	if (section.layout === "columns") {
		const columns = (section.columns ?? []).filter(
			(column) => column.label.trim() || column.body.trim(),
		);
		if (columns.length === 0) return null;

		return (
			<section className="border-t border-border pt-6">
				{section.heading?.trim() && (
					<h2 className="mb-4 text-lg font-semibold text-foreground">
						{section.heading}
					</h2>
				)}
				<div className={gridFor(columns.length)}>
					{columns.map((column) => (
						<div key={column.label}>
							<p className="text-[13px] text-muted-foreground">
								{column.label}
							</p>
							<p className="mt-1 text-[15px] leading-relaxed text-foreground">
								{column.body}
							</p>
						</div>
					))}
				</div>
			</section>
		);
	}

	if (!section.body?.trim()) return null;

	return (
		<section>
			{section.heading?.trim() && (
				<h2 className="text-lg font-semibold text-foreground">
					{section.heading}
				</h2>
			)}
			<ServiceRichBody body={section.body} className="mt-3" />
		</section>
	);
}

/** One, two or three columns — never a lone stretched column on desktop. */
export function gridFor(count: number): string {
	if (count >= 3) return "grid gap-6 sm:grid-cols-2 lg:grid-cols-3";
	if (count === 2) return "grid gap-6 sm:grid-cols-2";
	return "grid gap-6";
}
