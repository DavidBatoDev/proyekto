import { createFileRoute, Link } from "@tanstack/react-router";
import {
	CalendarDays,
	Check,
	Eye,
	Loader2,
	PlugZap,
	Trash2,
} from "lucide-react";
import { useState } from "react";
import { AppSurfaceCard } from "@/components/common/AppPrimitives";
import { GoogleMeetLogo } from "@/components/meetings/editor/ProviderLogos";
import {
	useConnectGoogleCalendar,
	useDisconnectGoogleCalendar,
	useGoogleCalendarStatus,
	useGoogleConnectResult,
} from "@/hooks/useMeetings";
import { useToast } from "@/hooks/useToast";
import { isNativeApp } from "@/lib/platform";

export const Route = createFileRoute("/settings/integrations")({
	beforeLoad: () => {},
	component: IntegrationsPage,
});

/**
 * Third-party services connected to the user's account. Google Calendar is the
 * calendar integration: Proyekto meetings are mirrored to it (with Meet links)
 * and the user's own Google events show read-only in Meetings.
 */
function IntegrationsPage() {
	// The Google consent screen returns here when connecting from this page.
	useGoogleConnectResult();

	return (
		<div className="app-fade-in">
			<header className="mb-8 flex items-start gap-4">
				<div className="hidden h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-primary/30 bg-primary/10 text-primary sm:flex">
					<PlugZap className="h-6 w-6" />
				</div>
				<div>
					<h1 className="text-3xl font-semibold tracking-tight text-foreground">
						Integrations
					</h1>
					<p className="mt-2 max-w-2xl text-sm text-muted-foreground">
						Connect the tools you already use. Each connection is personal to
						you, and you can disconnect it at any time.
					</p>
				</div>
			</header>

			<GoogleCalendarCard />
		</div>
	);
}

function GoogleCalendarCard() {
	const toast = useToast();
	const status = useGoogleCalendarStatus();
	const connect = useConnectGoogleCalendar("/settings/integrations");
	const disconnect = useDisconnectGoogleCalendar();
	const [confirming, setConfirming] = useState(false);
	const native = isNativeApp();

	const onDisconnect = () => {
		disconnect.mutate(undefined, {
			onSuccess: () => {
				setConfirming(false);
				toast.success("Google Calendar disconnected.");
			},
			onError: (err: Error) => toast.error(err.message),
		});
	};

	return (
		<AppSurfaceCard className="overflow-hidden p-0">
			<div className="flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-start sm:justify-between sm:px-7">
				<div className="flex min-w-0 items-start gap-3">
					<span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border bg-muted text-foreground">
						<CalendarDays className="h-5 w-5" />
					</span>
					<div className="min-w-0">
						<h2 className="text-base font-semibold text-foreground">
							Google Calendar
						</h2>
						<p className="mt-1 text-sm text-muted-foreground">
							Keep your Proyekto meetings and your Google Calendar in step.
						</p>
					</div>
				</div>

				{status.isPending ? (
					<Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
				) : status.data?.connected ? (
					<span className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-full bg-success/15 px-2.5 py-1 text-xs font-medium text-success">
						<Check className="h-3.5 w-3.5" /> Connected
					</span>
				) : null}
			</div>

			<div className="border-t border-border px-5 py-5 sm:px-7">
				{status.isError ? (
					<p className="text-sm text-muted-foreground">
						We couldn't check your Google Calendar connection.{" "}
						<button
							type="button"
							onClick={() => void status.refetch()}
							className="font-medium text-primary hover:underline"
						>
							Try again
						</button>
					</p>
				) : status.data && !status.data.enabled ? (
					<p className="text-sm text-muted-foreground">
						Google Calendar isn't available right now.
					</p>
				) : (
					<>
						<ul className="space-y-3 text-sm text-foreground">
							<li className="flex items-start gap-3">
								<GoogleMeetLogo className="mt-0.5 h-5 w-5 shrink-0" />
								<span>
									Choose <strong>Google Meet</strong> when you schedule a
									meeting: Proyekto puts it on your Google Calendar with a Meet
									link and emails your guests a calendar invite. Edits and
									cancellations follow.
								</span>
							</li>
							<li className="flex items-start gap-3">
								<Eye className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
								<span>
									See your own Google Calendar events in{" "}
									<Link
										to="/meetings"
										className="font-medium text-primary hover:underline"
									>
										Meetings
									</Link>
									, so you can schedule around them. They're read live from
									Google, shown only to you, and never stored.
								</span>
							</li>
						</ul>

						<div className="mt-5">
							{status.data?.connected ? (
								<ConnectedControls
									email={status.data.googleEmail ?? null}
									confirming={confirming}
									pending={disconnect.isPending}
									onAskDisconnect={() => setConfirming(true)}
									onCancel={() => setConfirming(false)}
									onDisconnect={onDisconnect}
								/>
							) : native ? (
								<p className="text-sm text-muted-foreground">
									To connect, open proyekto.tech in a web browser and go to
									Settings, then Integrations. Google doesn't allow its sign-in
									inside apps.
								</p>
							) : (
								<div>
									<button
										type="button"
										onClick={() => void connect.connect()}
										disabled={connect.connecting || status.isPending}
										className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
									>
										{connect.connecting && (
											<Loader2 className="h-4 w-4 animate-spin" />
										)}
										Connect Google Calendar
									</button>
									<p className="mt-2 text-xs text-muted-foreground">
										Google may warn that it hasn't verified Proyekto yet. You
										can continue: choose Advanced, then go to Proyekto.
									</p>
									{connect.error && (
										<p className="mt-2 text-sm text-destructive">
											{connect.error}
										</p>
									)}
								</div>
							)}
						</div>
					</>
				)}
			</div>
		</AppSurfaceCard>
	);
}

function ConnectedControls({
	email,
	confirming,
	pending,
	onAskDisconnect,
	onCancel,
	onDisconnect,
}: {
	email: string | null;
	confirming: boolean;
	pending: boolean;
	onAskDisconnect: () => void;
	onCancel: () => void;
	onDisconnect: () => void;
}) {
	if (confirming) {
		return (
			<div className="rounded-xl border border-border bg-muted/50 p-4">
				<p className="text-sm font-medium text-foreground">
					Disconnect Google Calendar?
				</p>
				<ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
					<li>Your Proyekto meetings stay exactly as they are.</li>
					<li>
						Events already on your Google Calendar, and their Meet links, stay
						there.
					</li>
					<li>
						New meetings stop syncing, and your Google events disappear from
						Meetings.
					</li>
				</ul>
				<div className="mt-4 flex flex-wrap gap-2">
					<button
						type="button"
						onClick={onDisconnect}
						disabled={pending}
						className="inline-flex items-center gap-1.5 rounded-lg bg-destructive px-3 py-1.5 text-sm font-medium text-destructive-foreground transition-colors hover:bg-destructive/90 disabled:opacity-60"
					>
						{pending && <Loader2 className="h-4 w-4 animate-spin" />}
						Disconnect
					</button>
					<button
						type="button"
						onClick={onCancel}
						disabled={pending}
						className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-60"
					>
						Keep connected
					</button>
				</div>
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
			<p className="text-sm text-muted-foreground">
				Connected as{" "}
				<span className="font-medium text-foreground">
					{email ?? "your Google account"}
				</span>
			</p>
			<button
				type="button"
				onClick={onAskDisconnect}
				className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive sm:self-auto"
			>
				<Trash2 className="h-3.5 w-3.5" />
				Disconnect
			</button>
		</div>
	);
}
