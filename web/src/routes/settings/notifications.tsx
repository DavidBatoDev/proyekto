import { createFileRoute } from "@tanstack/react-router";
import { Bell, Loader2, Mail } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import { useToast } from "@/hooks/useToast";
import {
	type NotificationPreferences,
	notificationsService,
} from "@/services/notifications.service";

export const Route = createFileRoute("/settings/notifications")({
	beforeLoad: () => {},
	component: NotificationSettingsPage,
});

/**
 * Groups the toggle list into things a person recognises, in display order.
 * Anything the backend adds that this build has no copy for lands in "other",
 * so a new type is never lost - only unlabelled.
 */
const GROUPS = [
	{ key: "mentions", title: "When someone mentions you" },
	{ key: "messages", title: "Direct messages" },
	{ key: "invites", title: "Invitations" },
	{ key: "consultant", title: "Your consultant application" },
	{ key: "other", title: "Everything else" },
] as const;

type GroupKey = (typeof GROUPS)[number]["key"];

/**
 * Human labels for the types the backend can email about. The list is the
 * email registry's keys, so it grows server-side: a type with no entry here
 * still renders, with its name humanised rather than shown as a raw key.
 */
const TYPE_COPY: Record<
	string,
	{ label: string; hint: string; group: GroupKey }
> = {
	task_comment_mention: {
		label: "In a task comment",
		hint: "Someone @mentions you on a task.",
		group: "mentions",
	},
	feature_comment_mention: {
		label: "In a feature comment",
		hint: "Someone @mentions you on a feature.",
		group: "mentions",
	},
	epic_comment_mention: {
		label: "In an epic comment",
		hint: "Someone @mentions you on an epic.",
		group: "mentions",
	},
	chat_mention: {
		label: "In chat",
		hint: "Someone @mentions you in a channel or a direct message.",
		group: "mentions",
	},
	chat_dm_received: {
		label: "New direct message",
		hint: "Someone sends you a direct message.",
		group: "messages",
	},
	roadmap_mention_invite: {
		label: "Invited to a project by a mention",
		hint: "Someone @mentions your email address to bring you into a project you are not on yet.",
		group: "invites",
	},
	consultant_application_approved: {
		label: "Application approved",
		hint: "Your application to become a verified consultant is accepted.",
		group: "consultant",
	},
	consultant_application_rejected: {
		label: "Application not approved",
		hint: "A decision on your consultant application, with the reviewer's reason.",
		group: "consultant",
	},
};

/** `roadmap_mention_invite` -> "Roadmap mention invite". */
function humanizeTypeName(name: string): string {
	const words = name.replace(/_/g, " ").trim();
	return words.charAt(0).toUpperCase() + words.slice(1);
}

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
	 * Bucketed once per change rather than filtered inside the render, so the
	 * group order stays the declared one no matter what order the API returns.
	 */
	const grouped = useMemo(() => {
		const buckets = new Map<GroupKey, NotificationPreferences["types"]>();
		for (const type of prefs?.types ?? []) {
			const key = TYPE_COPY[type.type_name]?.group ?? "other";
			const bucket = buckets.get(key);
			if (bucket) bucket.push(type);
			else buckets.set(key, [type]);
		}
		return buckets;
	}, [prefs?.types]);

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
		<>
			<div className="app-fade-in">
				<header className="mb-8 flex items-start gap-4">
					<div className="hidden h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-primary/30 bg-primary/10 text-primary sm:flex">
						<Bell className="h-6 w-6" />
					</div>
					<div>
						<h1 className="text-3xl font-semibold tracking-tight text-foreground">
							Notifications
						</h1>
						<p className="mt-2 max-w-2xl text-sm text-muted-foreground">
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

						<section className="rounded-xl border border-border bg-card p-4 sm:p-5">
							<h2 className="text-sm font-semibold text-foreground">
								What to email me about
							</h2>
							<p className="mt-1 text-xs text-muted-foreground">
								You are only emailed when you have not already seen the
								notification in the app.
							</p>

							<div className="mt-4 space-y-6">
								{GROUPS.map((group) => {
									const types = grouped.get(group.key) ?? [];
									if (types.length === 0) return null;

									return (
										<div key={group.key}>
											<p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
												{group.title}
											</p>
											<div className="mt-1 divide-y divide-border">
												{types.map((type) => {
													const copy = TYPE_COPY[type.type_name];
													return (
														<Toggle
															key={type.type_name}
															label={
																copy?.label ?? humanizeTypeName(type.type_name)
															}
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
										</div>
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
		</>
	);
}
