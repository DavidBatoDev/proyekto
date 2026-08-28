import { createFileRoute, Link } from "@tanstack/react-router";
import {
	ArrowRight,
	Bell,
	KeyRound,
	type LucideIcon,
	Palette,
} from "lucide-react";
import { featureFlags } from "@/config/featureFlags";
import { useProfileQuery } from "@/hooks/useProfileQuery";
import { isActiveConsultant } from "@/lib/auth-utils";
import { useUser } from "@/stores/authStore";

export const Route = createFileRoute("/settings/")({
	component: SettingsOverviewPage,
});

interface SettingsSection {
	label: string;
	description: string;
	to: string;
	icon: LucideIcon;
}

function SectionCard({ section }: { section: SettingsSection }) {
	const Icon = section.icon;
	return (
		<Link
			to={section.to}
			className="group flex items-start gap-4 rounded-2xl border border-border bg-card p-5 text-card-foreground shadow-(--app-shadow-sm) transition-colors hover:border-primary/40 hover:bg-muted/50"
		>
			<span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-primary/30 bg-primary/10 text-primary">
				<Icon className="h-5 w-5" />
			</span>
			<span className="min-w-0 flex-1">
				<span className="flex items-center gap-2 text-sm font-semibold text-foreground">
					{section.label}
					<ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
				</span>
				<span className="mt-1 block text-sm text-muted-foreground">
					{section.description}
				</span>
			</span>
		</Link>
	);
}

function SettingsOverviewPage() {
	const { data: profile } = useProfileQuery();
	const user = useUser();

	const displayName = profile?.display_name
		? profile.display_name
		: profile?.first_name
			? `${profile.first_name} ${profile.last_name || ""}`.trim()
			: profile?.email?.split("@")[0] || "User";

	const accountLabel = isActiveConsultant(profile)
		? "Verified consultant"
		: "Member";

	const sections: SettingsSection[] = [
		...(featureFlags.themeSystem
			? [
					{
						label: "Appearance",
						description:
							"Theme, accent colors and sidebar layout, synced across your devices.",
						to: "/settings/appearance",
						icon: Palette,
					},
				]
			: []),
		{
			label: "Notifications",
			description:
				"Choose what Proyekto emails you about. In-app notifications are unaffected.",
			to: "/settings/notifications",
			icon: Bell,
		},
		{
			label: "MCP Access",
			description:
				"Connect MCP hosts like Claude to your Proyekto data with scoped, revocable access.",
			to: "/settings/mcp-tokens",
			icon: KeyRound,
		},
	];

	return (
		<div className="app-fade-in">
			<div className="mb-8">
				<h1 className="text-3xl font-semibold tracking-tight text-foreground">
					My Settings
				</h1>
				<p className="mt-2 max-w-2xl text-sm text-muted-foreground">
					Everything that belongs to your account rather than to a single
					project.
				</p>
			</div>

			<section className="mb-8 flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 text-card-foreground shadow-(--app-shadow-sm) sm:flex-row sm:items-center sm:justify-between sm:p-6">
				<div className="flex min-w-0 items-center gap-4">
					{profile?.avatar_url ? (
						<img
							src={profile.avatar_url}
							alt={displayName}
							className="h-14 w-14 rounded-full border border-border object-cover"
						/>
					) : (
						<div className="flex h-14 w-14 items-center justify-center rounded-full border border-border bg-muted text-lg font-semibold text-foreground">
							{displayName.charAt(0).toUpperCase()}
						</div>
					)}
					<div className="min-w-0">
						<p className="truncate text-lg font-semibold text-foreground">
							{displayName}
						</p>
						<p className="truncate text-sm text-muted-foreground">
							{profile?.email}
						</p>
						<p className="mt-1 text-xs font-semibold uppercase tracking-[0.12em] text-primary">
							{accountLabel}
						</p>
					</div>
				</div>

				<Link
					to="/profile/$profileId"
					params={{ profileId: user?.id || "" }}
					className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
				>
					View profile
					<ArrowRight className="h-4 w-4" />
				</Link>
			</section>

			<div className="grid gap-4 sm:grid-cols-2">
				{sections.map((section) => (
					<SectionCard key={section.label} section={section} />
				))}
			</div>
		</div>
	);
}
