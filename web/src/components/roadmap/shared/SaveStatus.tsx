import { Check, Loader2, TriangleAlert } from "lucide-react";
import type { AutosaveStatus } from "@/hooks/useAutosave";

/**
 * Compact "Saving… / Saved" line for the epic, feature and task editors,
 * which save as you edit. Renders nothing until the first save starts.
 */
export function SaveStatus({
	status,
	className = "",
}: {
	status: AutosaveStatus;
	className?: string;
}) {
	if (status === "idle") return null;
	const { icon, text, tone } = {
		saving: {
			icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />,
			text: "Saving…",
			tone: "text-muted-foreground",
		},
		saved: {
			icon: <Check className="h-3.5 w-3.5" />,
			text: "Saved",
			tone: "text-muted-foreground",
		},
		error: {
			icon: <TriangleAlert className="h-3.5 w-3.5" />,
			text: "Couldn't save",
			tone: "text-destructive",
		},
	}[status];
	return (
		<span
			role="status"
			aria-live="polite"
			className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-xs font-medium ${tone} ${className}`}
		>
			{icon}
			{text}
		</span>
	);
}
