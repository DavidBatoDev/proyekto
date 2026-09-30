import { createFileRoute } from "@tanstack/react-router";
import { Loader2, ShieldCheck, UserX } from "lucide-react";
import { AppSurfaceCard } from "@/components/common/AppPrimitives";
import { PersonAvatar } from "@/components/safety/PersonAvatar";
import { useSafety } from "@/components/safety/SafetyProvider";
import { useBlockedPeople } from "@/queries/safety";

export const Route = createFileRoute("/settings/blocked")({
	beforeLoad: () => {},
	component: BlockedPeoplePage,
});

function formatBlockedOn(iso: string): string {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return "";
	return date.toLocaleDateString([], {
		month: "short",
		day: "numeric",
		year: "numeric",
	});
}

/**
 * Everyone you blocked, with a way back (App Store guideline 1.2). Blocking
 * happens from a message, a DM or a profile; this is where it is undone.
 */
function BlockedPeoplePage() {
	const { people, isPending, isError, refetch } = useBlockedPeople();
	const safety = useSafety();

	return (
		<div className="app-fade-in">
			<header className="mb-8 flex items-start gap-4">
				<div className="hidden h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-primary/30 bg-primary/10 text-primary sm:flex">
					<UserX className="h-6 w-6" />
				</div>
				<div>
					<h1 className="text-3xl font-semibold tracking-tight text-foreground">
						Blocked people
					</h1>
					<p className="mt-2 max-w-2xl text-sm text-muted-foreground">
						People you block can't send you direct messages, and their messages
						and comments are hidden from you. They aren't told they were
						blocked.
					</p>
				</div>
			</header>

			<AppSurfaceCard className="overflow-hidden p-0">
				{isPending ? (
					<div className="flex items-center justify-center gap-2 px-6 py-16 text-sm text-muted-foreground">
						<Loader2 className="h-4 w-4 animate-spin" />
						Loading…
					</div>
				) : isError ? (
					<div className="px-6 py-14 text-center">
						<p className="text-sm text-muted-foreground">
							We couldn't load your blocked list.
						</p>
						<button
							type="button"
							onClick={() => void refetch()}
							className="mt-3 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted"
						>
							Try again
						</button>
					</div>
				) : people.length === 0 ? (
					<div className="flex flex-col items-center px-6 py-16 text-center">
						<span className="flex h-14 w-14 items-center justify-center rounded-full bg-success/15 text-success">
							<ShieldCheck className="h-7 w-7" />
						</span>
						<p className="mt-4 text-base font-semibold text-foreground">
							You haven't blocked anyone
						</p>
						<p className="mt-1 max-w-sm text-sm text-muted-foreground">
							If someone bothers you, open a message of theirs, their direct
							message or their profile and choose Block.
						</p>
					</div>
				) : (
					<ul className="divide-y divide-border">
						{people.map((person) => {
							const name = person.display_name || "Unknown member";
							return (
								<li
									key={person.user_id}
									className="flex items-center gap-3 px-5 py-4"
								>
									<PersonAvatar name={name} avatarUrl={person.avatar_url} />
									<div className="min-w-0 flex-1">
										<p className="truncate text-sm font-semibold text-foreground">
											{name}
										</p>
										<p className="text-xs text-muted-foreground">
											Blocked on {formatBlockedOn(person.blocked_at)}
										</p>
									</div>
									<button
										type="button"
										onClick={() =>
											void safety.unblock({
												id: person.user_id,
												name,
												avatarUrl: person.avatar_url,
											})
										}
										className="shrink-0 rounded-lg border border-border bg-card px-3.5 py-2 text-xs font-semibold text-foreground transition-colors hover:bg-muted"
									>
										Unblock
									</button>
								</li>
							);
						})}
					</ul>
				)}
			</AppSurfaceCard>
		</div>
	);
}
