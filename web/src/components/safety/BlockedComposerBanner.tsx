import { ShieldBan } from "lucide-react";
import type { PersonRef } from "@/queries/safety";
import { useSafety } from "./SafetyProvider";
import { firstName } from "./safetyCopy";

/**
 * Takes the composer's place in a DM with someone you blocked: sending would
 * fail anyway (the backend closes blocked DMs both ways), so say why and offer
 * the way back instead of a box that errors.
 */
export function BlockedComposerBanner({ person }: { person: PersonRef }) {
	const safety = useSafety();
	return (
		<div className="border-t border-border bg-card px-4 py-3 sm:px-6">
			<div className="flex items-center gap-3 rounded-2xl border border-border bg-muted/40 px-4 py-3">
				<span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
					<ShieldBan className="h-4 w-4" />
				</span>
				<div className="min-w-0 flex-1">
					<p className="text-sm font-semibold text-foreground">
						You blocked {person.name}
					</p>
					<p className="text-xs text-muted-foreground">
						You can't message each other while {firstName(person.name)} is
						blocked.
					</p>
				</div>
				<button
					type="button"
					onClick={() => void safety.unblock(person)}
					className="shrink-0 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted"
				>
					Unblock
				</button>
			</div>
		</div>
	);
}
