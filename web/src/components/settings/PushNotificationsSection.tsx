import {
	AlertTriangle,
	BellRing,
	Check,
	ClipboardCopy,
	ExternalLink,
	Loader2,
	RefreshCw,
} from "lucide-react";
import { useEffect, useState } from "react";
import { usePushStatus } from "@/hooks/usePushStatus";
import { useToast } from "@/hooks/useToast";
import { isNativePlatform } from "@/services/pushNotifications";
import type { PushPermission, PushStatus } from "@/services/pushStatus";

const PERMISSION_COPY: Record<PushPermission, string> = {
	granted: "Granted",
	denied: "Blocked",
	prompt: "Not asked yet",
	"prompt-with-rationale": "Not asked yet",
	unavailable: "Unavailable",
};

const relative = (iso: string | null): string => {
	if (!iso) return "never";
	const ms = Date.now() - new Date(iso).getTime();
	if (Number.isNaN(ms)) return "unknown";
	const mins = Math.round(ms / 60000);
	if (mins < 1) return "just now";
	if (mins < 60) return `${mins}m ago`;
	const hours = Math.round(mins / 60);
	if (hours < 24) return `${hours}h ago`;
	return `${Math.round(hours / 24)}d ago`;
};

function Row({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex items-baseline justify-between gap-4 py-1">
			<dt className="text-xs text-muted-foreground">{label}</dt>
			<dd className="text-right text-xs font-medium text-foreground">
				{value}
			</dd>
		</div>
	);
}

/**
 * Live diagnostics for native push registration.
 *
 * The app has no error reporting of any kind, so this card is the only place a
 * push failure is ever visible — which is why it prints the raw permission
 * state and the verbatim error rather than a friendly summary. Push was broken
 * in production for two months precisely because every failure was silent.
 *
 * Rendered outside the email-preferences loading gate on purpose: if that
 * unrelated API is down, the diagnostics must still be readable.
 */
export function PushNotificationsSection() {
	const {
		status,
		isWorking,
		isBlocked,
		canOpenSettings,
		enable,
		retry,
		refresh,
		openSettings,
	} = usePushStatus();
	const toast = useToast();
	const [busy, setBusy] = useState(false);

	// Read the live permission whenever the page opens — the user may have just
	// come back from system settings.
	useEffect(() => {
		if (isNativePlatform()) void refresh();
	}, [refresh]);

	if (!isNativePlatform()) {
		return (
			<section className="rounded-xl border border-border bg-card p-4 sm:p-5">
				<div className="mb-1 flex items-center gap-2">
					<BellRing className="h-4 w-4 text-muted-foreground" />
					<h2 className="text-sm font-semibold text-foreground">
						Push notifications
					</h2>
				</div>
				<p className="text-sm text-muted-foreground">
					Push notifications are delivered by the Proyekto mobile app. Install
					it to get messages while Proyekto is closed.
				</p>
			</section>
		);
	}

	const run = async (action: () => Promise<unknown>, okMessage: string) => {
		setBusy(true);
		try {
			await action();
			toast.success(okMessage);
		} catch {
			toast.error("Could not update push notifications.");
		} finally {
			setBusy(false);
		}
	};

	const copyDiagnostics = async () => {
		try {
			await navigator.clipboard.writeText(JSON.stringify(status, null, 2));
			toast.success("Diagnostics copied.");
		} catch {
			toast.error("Could not copy diagnostics.");
		}
	};

	return (
		<section className="rounded-xl border border-border bg-card p-4 sm:p-5">
			<div className="mb-1 flex items-center gap-2">
				<BellRing className="h-4 w-4 text-muted-foreground" />
				<h2 className="text-sm font-semibold text-foreground">
					Push notifications
				</h2>
			</div>

			<p className="mb-4 flex items-center gap-2 text-sm">
				{isWorking ? (
					<>
						<Check className="h-4 w-4 text-green-600" />
						<span className="text-foreground">
							Push notifications are on for this device.
						</span>
					</>
				) : (
					<>
						<AlertTriangle className="h-4 w-4 text-amber-500" />
						<span className="text-foreground">
							{isBlocked
								? "Blocked in system settings."
								: status.permission === "unavailable"
									? "Push is not available on this device."
									: status.registered
										? "Registered, but notifications are not allowed yet."
										: "This device is not receiving notifications."}
						</span>
					</>
				)}
			</p>

			{isBlocked && (
				<p className="mb-4 rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
					Android only asks once, so Proyekto cannot request permission again.
					{canOpenSettings
						? " Open your notification settings to turn it back on."
						: " Turn it on under Settings → Apps → Proyekto → Notifications."}
				</p>
			)}

			<dl className="mb-4 divide-y divide-border border-y border-border">
				<Row
					label="App"
					value={
						status.appVersion
							? `${status.platform} ${status.appVersion}${status.appBuild ? ` (${status.appBuild})` : ""}`
							: status.platform
					}
				/>
				<Row
					label="Messaging supported"
					value={status.supported ? "Yes" : "No"}
				/>
				<Row
					label="System permission"
					value={`${PERMISSION_COPY[status.permission]} (${status.permission})`}
				/>
				<Row
					label="Device token"
					value={
						status.registered && status.tokenTail
							? `Registered ·····${status.tokenTail} · ${relative(status.registeredAt)}`
							: "Not registered"
					}
				/>
				<Row
					label="Notification channels"
					value={
						status.channels.length ? status.channels.join(", ") : "None created"
					}
				/>
				<Row
					label="Last checked"
					value={`${relative(status.checkedAt)}${status.trigger ? ` · ${status.trigger}` : ""}`}
				/>
				{status.lastError && (
					<Row label="Last error" value={status.lastError} />
				)}
			</dl>

			<div className="flex flex-wrap items-center gap-2">
				{(status.permission === "prompt" ||
					status.permission === "prompt-with-rationale") && (
					<button
						type="button"
						disabled={busy}
						onClick={() => run(enable, "Notifications enabled.")}
						className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
					>
						Enable notifications
					</button>
				)}

				{canOpenSettings && status.permission !== "prompt" && (
					<button
						type="button"
						disabled={busy}
						onClick={() => void openSettings()}
						className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground disabled:opacity-50"
					>
						<ExternalLink className="h-3.5 w-3.5" />
						Open system settings
					</button>
				)}

				<button
					type="button"
					disabled={busy}
					onClick={() => run(retry, "Registration retried.")}
					className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground disabled:opacity-50"
				>
					{busy ? (
						<Loader2 className="h-3.5 w-3.5 animate-spin" />
					) : (
						<RefreshCw className="h-3.5 w-3.5" />
					)}
					Retry registration
				</button>

				<button
					type="button"
					onClick={() => void copyDiagnostics()}
					className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground"
				>
					<ClipboardCopy className="h-3.5 w-3.5" />
					Copy diagnostics
				</button>
			</div>
		</section>
	);
}

export type { PushStatus };
