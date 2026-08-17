import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/**
 * The identity strip that sits above a project workspace surface: an icon tile,
 * the page name, and one line saying what the page answers. Extracted from the
 * Board so every canvas-style page introduces itself the same way.
 */
export function ProjectPageHeader({
	icon: Icon,
	title,
	subtitle,
	actions,
}: {
	icon: LucideIcon;
	title: string;
	subtitle?: string;
	actions?: ReactNode;
}) {
	return (
		<div className="shrink-0 border-b border-border bg-card px-3 py-2 text-card-foreground md:px-6 md:py-2.5">
			<div className="flex items-center justify-between gap-4">
				<div className="flex items-center gap-2.5">
					<div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted md:h-8 md:w-8">
						<Icon className="h-4 w-4 text-foreground" />
					</div>
					<div className="leading-tight">
						<h1 className="text-sm font-semibold text-foreground">{title}</h1>
						{subtitle && (
							<p className="hidden text-[11px] text-muted-foreground md:block">
								{subtitle}
							</p>
						)}
					</div>
				</div>

				{actions && (
					<div className="flex shrink-0 items-center gap-2">{actions}</div>
				)}
			</div>
		</div>
	);
}
