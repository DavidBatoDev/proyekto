/**
 * Floating "?" launcher for the current surface's tour.
 *
 * Shown only while the tour is genuinely unseen. Once the user has taken it the
 * button disappears for good — the tour stops being an unanswered invitation,
 * and a permanently glowing badge on a page you use every day is noise. Going
 * back through it stays possible from the profile menu's "Replay product tour".
 */

import { HelpCircle } from "lucide-react";

export interface TourLauncherProps {
	/** null while the lookup is in flight; true once the tour has been taken. */
	hasSeen: boolean | null;
	onStart: () => void;
}

export function TourLauncher({ hasSeen, onStart }: TourLauncherProps) {
	// Render only on a definite "not seen". `null` means the lookup is still in
	// flight, and flashing a glowing button at someone who has already taken the
	// tour reads as a glitch.
	if (hasSeen !== false) return null;

	return (
		<button
			type="button"
			onClick={onStart}
			aria-label="Take the product tour"
			title="Take the product tour"
			// Clears the mobile bottom nav (h-app-nav, <768px) so it never sits on
			// top of the tab bar.
			className="tour-launcher-glow fixed bottom-24 right-6 z-40 inline-flex h-12 w-12 cursor-pointer items-center justify-center rounded-full border border-primary/30 bg-card text-primary shadow-lg transition-colors hover:bg-primary hover:text-primary-foreground md:bottom-6"
		>
			<HelpCircle className="h-6 w-6" />
		</button>
	);
}
