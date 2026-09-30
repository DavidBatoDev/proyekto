import { EyeOff } from "lucide-react";
import { type ReactNode, useState } from "react";

/**
 * Stands in for a message or comment from someone you blocked. You still share
 * the project, so the content exists for everyone else; here it collapses to a
 * quiet pill you can open once if you need the context.
 */
export function BlockedContent({
	blocked,
	kind = "message",
	children,
}: {
	blocked: boolean;
	kind?: "message" | "comment";
	children: ReactNode;
}) {
	const [revealed, setRevealed] = useState(false);
	if (!blocked || revealed) return <>{children}</>;

	return (
		<div className="my-0.5 inline-flex max-w-full items-center gap-2 rounded-full border border-dashed border-border bg-muted/40 py-1 pl-2.5 pr-1 text-xs text-muted-foreground">
			<EyeOff className="h-3.5 w-3.5 shrink-0" />
			<span className="truncate">
				{kind === "comment" ? "Blocked comment" : "Blocked message"}
			</span>
			<button
				type="button"
				onClick={() => setRevealed(true)}
				className="shrink-0 rounded-full px-2 py-0.5 font-semibold text-foreground transition-colors hover:bg-muted"
			>
				Show
			</button>
		</div>
	);
}
