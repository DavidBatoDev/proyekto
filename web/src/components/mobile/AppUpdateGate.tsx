import { ArrowUpCircle } from "lucide-react";
import { AppDialog } from "@/components/common/AppDialog";
import { useAppUpdateGate } from "@/hooks/useAppUpdateGate";

const REQUIRED_COPY =
	"This version of Proyekto can no longer receive updates. Update from the store to keep working.";
const OPTIONAL_COPY = "A new version of Proyekto is available.";

/**
 * Prompts the user to update the native app.
 *
 * Two levels, both driven by the server so a release can be escalated from
 * nudge to block without shipping anything:
 *
 *  - **required** — a shell below `min_supported_build`. `resolveUpdate` has
 *    already stopped serving these devices OTA bundles, so they cannot be fixed
 *    remotely and the dialog does not close. This is the one case where
 *    blocking is a kindness rather than an annoyance.
 *  - **optional** — a newer store build exists; a dismissible sheet, snoozed for
 *    a week.
 *
 * Renders nothing on web, and nothing at all unless the server says so — the
 * whole path fails open.
 */
export function AppUpdateGate() {
	const { requirement, isBlocking, isNudging, snooze } = useAppUpdateGate();

	if (!requirement?.storeUrl || (!isBlocking && !isNudging)) return null;

	const { storeUrl, latestVersion, message } = requirement;
	const openStore = () => {
		window.open(storeUrl, "_system");
	};

	const versionLine = latestVersion ? `Version ${latestVersion}` : null;

	if (isBlocking) {
		return (
			<AppDialog
				open
				// No-op: a required update has nowhere to dismiss to. AppDialog routes
				// Escape and backdrop clicks here, so swallowing it is what makes the
				// dialog unclosable.
				onClose={() => {}}
				hideCloseButton
				size="sm"
				zIndex={2000}
				footer={
					<button
						type="button"
						onClick={openStore}
						className="w-full rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground"
					>
						Update now
					</button>
				}
			>
				<div className="px-6 py-6 text-center">
					<ArrowUpCircle className="mx-auto mb-3 h-10 w-10 text-primary" />
					<h2 className="text-base font-semibold text-card-foreground">
						Update required
					</h2>
					<p className="mt-2 text-sm leading-relaxed text-muted-foreground">
						{message ?? REQUIRED_COPY}
					</p>
					{versionLine && (
						<p className="mt-3 text-xs text-muted-foreground">{versionLine}</p>
					)}
				</div>
			</AppDialog>
		);
	}

	return (
		<AppDialog
			open
			onClose={snooze}
			variant="bottom-sheet"
			hideCloseButton
			zIndex={2000}
			footer={
				<div className="flex items-center gap-3">
					<button
						type="button"
						onClick={snooze}
						className="flex-1 rounded-lg px-4 py-2.5 text-sm font-medium text-muted-foreground"
					>
						Not now
					</button>
					<button
						type="button"
						onClick={openStore}
						className="flex-1 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground"
					>
						Update
					</button>
				</div>
			}
		>
			<div className="flex items-start gap-3 px-5 py-4">
				<ArrowUpCircle className="mt-0.5 h-6 w-6 shrink-0 text-primary" />
				<div className="min-w-0">
					<h2 className="text-sm font-semibold text-card-foreground">
						Update available
					</h2>
					<p className="mt-1 text-sm leading-relaxed text-muted-foreground">
						{message ?? OPTIONAL_COPY}
					</p>
					{versionLine && (
						<p className="mt-1.5 text-xs text-muted-foreground">
							{versionLine}
						</p>
					)}
				</div>
			</div>
		</AppDialog>
	);
}
