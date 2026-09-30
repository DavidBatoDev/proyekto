import {
	BellOff,
	EyeOff,
	Loader2,
	MessageSquareOff,
	ShieldBan,
} from "lucide-react";
import { AppDialog } from "@/components/common/AppDialog";
import { useIsMobile } from "@/hooks/useIsMobile";
import { isNativeApp } from "@/lib/platform";
import type { PersonRef } from "@/queries/safety";
import { PersonAvatar } from "./PersonAvatar";
import { firstName } from "./safetyCopy";

const EFFECTS = [
	{ icon: EyeOff, text: "Their messages and comments are hidden from you" },
	{
		icon: MessageSquareOff,
		text: "Neither of you can send the other a direct message",
	},
	{ icon: BellOff, text: "They won't be notified that you blocked them" },
];

/**
 * "Block {name}?" — says exactly what blocking does before it happens, so the
 * action is never a surprise. Undoable from Settings → Blocked people.
 */
export function BlockConfirmDialog({
	person,
	busy,
	onConfirm,
	onClose,
}: {
	person: PersonRef | null;
	busy: boolean;
	onConfirm: () => void;
	onClose: () => void;
}) {
	const isMobile = useIsMobile();
	if (!person) return null;
	const first = firstName(person.name);

	return (
		<AppDialog
			open
			onClose={onClose}
			variant={isMobile || isNativeApp() ? "bottom-sheet" : "center"}
			size="sm"
			busy={busy}
			hideCloseButton
			bare
			zIndex={1300}
		>
			<div className="flex flex-col items-center px-6 pb-2 pt-7 text-center">
				<div className="relative">
					<PersonAvatar
						name={person.name}
						avatarUrl={person.avatarUrl}
						size="lg"
					/>
					<span className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full bg-destructive text-destructive-foreground ring-2 ring-card">
						<ShieldBan className="h-3.5 w-3.5" />
					</span>
				</div>
				<h2 className="mt-4 text-lg font-bold text-card-foreground">
					Block {person.name}?
				</h2>
				<p className="mt-1 text-xs text-muted-foreground">
					You can unblock {first} any time in Settings.
				</p>
			</div>

			<ul className="mx-5 mt-4 space-y-3 rounded-2xl bg-muted/50 p-4">
				{EFFECTS.map(({ icon: Icon, text }) => (
					<li
						key={text}
						className="flex items-start gap-3 text-sm text-foreground"
					>
						<span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-card text-muted-foreground shadow-sm">
							<Icon className="h-3.5 w-3.5" />
						</span>
						<span className="pt-1 leading-snug">{text}</span>
					</li>
				))}
			</ul>

			<div className="flex flex-col-reverse gap-2 px-5 py-5 sm:flex-row sm:justify-end">
				<button
					type="button"
					onClick={onClose}
					disabled={busy}
					className="inline-flex h-11 items-center justify-center rounded-xl border border-border px-5 text-sm font-semibold text-foreground transition-colors hover:bg-muted disabled:opacity-50 sm:h-10"
				>
					Cancel
				</button>
				<button
					type="button"
					onClick={onConfirm}
					disabled={busy}
					className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-destructive px-5 text-sm font-semibold text-destructive-foreground transition-opacity hover:opacity-90 disabled:opacity-60 sm:h-10"
				>
					{busy ? (
						<Loader2 className="h-4 w-4 animate-spin" />
					) : (
						<ShieldBan className="h-4 w-4" />
					)}
					Block {first}
				</button>
			</div>
		</AppDialog>
	);
}
