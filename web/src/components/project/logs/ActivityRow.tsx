import { formatDistanceToNowStrict } from "date-fns";
import { Avatar, displayNameOf } from "@/components/common/Avatar";
import type { ProfileSummary } from "@/services/teams.service";
import type { ActivityEntry } from "@/services/activity.service";
import { activityCopyFor, type ActivityTone } from "./activityCatalog";

/** Theme tokens only — never hardcoded hex. */
const TONE_CLASS: Record<ActivityTone, string> = {
	neutral: "bg-muted text-muted-foreground",
	create: "bg-primary/10 text-primary",
	destroy: "bg-destructive/10 text-destructive",
	sensitive: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
	ai: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
};

export function ActivityRow({ entry }: { entry: ActivityEntry }) {
	const copy = activityCopyFor(entry.action);
	const Icon = copy.icon;

	// `object` is contractually total — it must not throw on absent metadata —
	// but a bad row must not take the whole audit page down with it either.
	let object = "";
	try {
		object = copy.object(entry);
	} catch {
		object = "";
	}

	const actor = entry.actor as ProfileSummary | null;
	const actorName = entry.actor
		? displayNameOf(actor, entry.actor_id ?? undefined)
		: "Someone";

	const at = new Date(entry.created_at);
	const valid = !Number.isNaN(at.getTime());

	return (
		<li
			data-testid="activity-row"
			data-action={entry.action}
			className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/40"
		>
			<span
				className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${TONE_CLASS[copy.tone]}`}
				aria-hidden="true"
			>
				<Icon className="h-3.5 w-3.5" />
			</span>

			<Avatar user={actor} fallbackId={entry.actor_id ?? undefined} size="sm" />

			<p className="min-w-0 flex-1 text-sm leading-6 text-foreground">
				<span className="font-medium">{actorName}</span>{" "}
				<span className="text-muted-foreground">{copy.verb}</span>
				{object ? <span> {object}</span> : null}
				{entry.is_sensitive ? (
					<span className="ml-2 rounded px-1.5 py-0.5 align-middle text-[10px] font-medium uppercase tracking-wide bg-amber-500/10 text-amber-600 dark:text-amber-400">
						Sensitive
					</span>
				) : null}
			</p>

			{valid ? (
				<time
					dateTime={at.toISOString()}
					title={at.toLocaleString()}
					className="shrink-0 whitespace-nowrap text-xs text-muted-foreground"
				>
					{formatDistanceToNowStrict(at, { addSuffix: true })}
				</time>
			) : null}
		</li>
	);
}
