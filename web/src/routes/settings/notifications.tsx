import { createFileRoute, redirect } from "@tanstack/react-router";
import { Bell, Loader2, Mail } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { useToast } from "@/hooks/useToast";
import {
	type NotificationPreferences,
	notificationsService,
} from "@/services/notifications.service";
import { useAuthStore } from "@/stores/authStore";

export const Route = createFileRoute("/settings/notifications")({
	beforeLoad: () => {
		if (!useAuthStore.getState().isAuthenticated) {
			throw redirect({ to: "/auth/login" });
		}
	},
	component: NotificationSettingsPage,
});

/**
 * Human labels for the types the backend can email about. Falls back to the raw
 * name so a type added server-side still renders something honest rather than
 * disappearing from the list.
 */
const TYPE_COPY: Record<string, { label: string; hint: string }> = {
	task_comment_mention: {
		label: "Mentioned in a task comment",
		hint: "Someone @mentions you on a task.",
	},
	feature_comment_mention: {
		label: "Mentioned in a feature comment",
		hint: "Someone @mentions you on a feature.",
	},
	epic_comment_mention: {
		label: "Mentioned in an epic comment",
		hint: "Someone @mentions you on an epic.",
	},
	chat_mention: {
		label: "Mentioned in chat",
		hint: "Someone @mentions you in a channel or direct message.",
	},
	chat_dm_received: {
		label: "New direct message",
		hint: "Someone sends you a direct message.",
	},
};

function Toggle({
	checked,
	onChange,
	label,
	hint,
	disabled,
}: {
	checked: boolean;
	onChange: (next: boolean) => void;
	label: string;
	hint?: string;
	disabled?: boolean;
}) {
	const id = useId();
	return (
		<div className="flex items-start justify-between gap-4 py-3">
			<div className="min-w-0">
				<label
					htmlFor={id}
					className={`block text-sm font-medium ${
						disabled ? "text-muted-foreground" : "text-foreground"
					}`}
				>
					{label}
				</label>
				{hint ? (
					<p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
				) : null}
			</div>
			<button
				id={id}
				type="button"
				role="switch"
				aria-checked={checked}
				aria-label={label}
				disabled={disabled}
				onClick={() => onChange(!checked)}
				className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
					checked ? "bg-primary" : "bg-muted"
				}`}
			>
				<span
					className={`inline-block h-4 w-4 transform rounded-full bg-background transition-transform ${
						checked ? "translate-x-6" : "translate-x-1"
					}`}
				/>
			</button>
		</div>
	);
}

function NotificationSettingsPage() {
	const { error: toastError } = useToast();
	const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);

	useEffect(() => {
		let cancelled = false;
		notificationsService
			.getPreferences()
			.then((data) => {
				if (!cancelled) setPrefs(data);
			})
			.catch(() => {
				if (!cancelled) {
					toastError("Could not load your notification settings.");
				}
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [toastError]);

	/**
	 * Optimistic, with rollback. These toggles are cheap and reversible, and a
	 * switch that visibly lags feels broken.
	 */
	const save = async (next: NotificationPreferences) => {
		const previous = prefs;
		setPrefs(next);
		setSaving(true);
		try {
			const saved = await notificationsService.updatePreferences({
				all_email_enabled: next.all_email_enabled,
				types: next.types,
			});
			setPrefs(saved);
		} catch {
			setPrefs(previous);
			toastError("Could not save that change.");
		} finally {
			setSaving(false);
		}
	};

	return (
		<DashboardShell>
			<div className="mx-auto w-full max-w-2xl px-4 py-8">
				<header className="mb-6 flex items-center gap-3">
					<Bell className="h-6 w-6 text-primary" />
					<div>
						<h1 className="text-xl font-semibold text-foreground">
							Notifications
						</h1>
						<p className="text-sm text-muted-foreground">
							Choose what Proyekto emails you about. In-app notifications are
							unaffected.
						</p>
					</div>
				</header>

				{loading ? (
					<div className="flex items-center gap-2 py-12 text-muted-foreground">
						<Loader2 className="h-4 w-4 animate-spin" />
						<span className="text-sm">Loading your settings…</span>
					</div>
				) : !prefs ? (
					<p className="py-12 text-sm text-muted-foreground">
						Your notification settings are unavailable right now.
					</p>
				) : (
					<div className="space-y-6">
						<section className="rounded-xl border border-border bg-card p-4">
							<div className="mb-1 flex items-center gap-2">
								<Mail className="h-4 w-4 text-muted-foreground" />
								<h2 className="text-sm font-semibold text-foreground">Email</h2>
							</div>
							<Toggle
								label="Send me email notifications"
								hint="Turn this off to stop all notification email. You will still see everything in the app."
								checked={prefs.all_email_enabled}
								onChange={(value) =>
									save({ ...prefs, all_email_enabled: value })
								}
							/>
						</section>

						<section className="rounded-xl border border-border bg-card p-4">
							<h2 className="mb-1 text-sm font-semibold text-foreground">
								What to email me about
							</h2>
							<p className="mb-2 text-xs text-muted-foreground">
								You are only emailed when you have not already seen the
								notification in the app.
							</p>
							<div className="divide-y divide-border">
								{prefs.types.map((type) => {
									const copy = TYPE_COPY[type.type_name];
									return (
										<Toggle
											key={type.type_name}
											label={copy?.label ?? type.type_name}
											hint={copy?.hint}
											checked={type.email_enabled}
											disabled={!prefs.all_email_enabled}
											onChange={(value) =>
												save({
													...prefs,
													types: prefs.types.map((t) =>
														t.type_name === type.type_name
															? { ...t, email_enabled: value }
															: t,
													),
												})
											}
										/>
									);
								})}
							</div>
						</section>

						{saving ? (
							<p className="text-xs text-muted-foreground">Saving…</p>
						) : null}
					</div>
				)}
			</div>
		</DashboardShell>
	);
}
