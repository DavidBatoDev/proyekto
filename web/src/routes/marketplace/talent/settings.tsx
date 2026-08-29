import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import {
	ArrowRight,
	Loader2,
	Pause,
	Play,
	Radio,
	UserRound,
	Wallet,
} from "lucide-react";
import type { ReactNode } from "react";
import { formatPrice } from "@/components/marketplace/consultant/ConsultantServices";
import { MarketplaceFooter } from "@/components/marketplace/MarketplaceFooter";
import { readError } from "@/components/marketplace/wizard/helpers";
import { useToast } from "@/hooks/useToast";
import { profileService } from "@/services/profile.service";
import { useAuthStore } from "@/stores/authStore";

/**
 * Talent settings — a card hub in the marketplace style: page title with the
 * account line under it, then one card per settings area showing its CURRENT
 * state. Cards navigate to where the thing is actually edited (the profile
 * page owns profile content and the rate card); only the listing status acts
 * in place, because pause/resume is one click, not a form.
 */
export const Route = createFileRoute("/marketplace/talent/settings")({
	beforeLoad: () => {
		const { isAuthenticated } = useAuthStore.getState();
		if (!isAuthenticated) throw redirect({ to: "/auth/login" });
	},
	component: TalentSettingsPage,
});

const profileKeys = { full: (id: string) => ["full-profile", id] as const };

const AVAILABILITY_LABELS: Record<string, string> = {
	available: "Available",
	partially_available: "Partially available",
	unavailable: "Unavailable",
};

function TalentSettingsPage() {
	const { user } = useAuthStore();
	const toast = useToast();
	const queryClient = useQueryClient();

	const profileQuery = useQuery({
		queryKey: profileKeys.full(user?.id ?? ""),
		queryFn: () => profileService.getProfile(user!.id),
		enabled: !!user?.id,
	});
	const profile = profileQuery.data;

	const statusMutation = useMutation({
		mutationFn: (
			nextActive: boolean,
		): Promise<{ is_public: boolean; status: "active" | "paused" }> =>
			nextActive ? profileService.goLive() : profileService.pause(),
		onSuccess: (result) => {
			toast.success(
				result.status === "active"
					? "Your listing is live again."
					: "Your listing is paused.",
			);
			void queryClient.invalidateQueries({
				queryKey: profileKeys.full(user?.id ?? ""),
			});
		},
		onError: (cause) => toast.error(readError(cause)),
	});

	if (profileQuery.isLoading) {
		return (
			<div className="flex min-h-screen items-center justify-center bg-background pt-app-header">
				<Loader2 className="h-8 w-8 animate-spin text-primary" />
			</div>
		);
	}

	const talentStatus = profile?.talent_status ?? null;

	if (!profile || !talentStatus) {
		return (
			<div className="flex min-h-screen flex-col bg-background pt-app-header">
				<div className="flex flex-1 items-center justify-center px-4">
					<div className="max-w-md rounded-2xl border border-border bg-card p-8 text-center">
						<h1 className="text-lg font-semibold text-foreground">
							No talent listing yet
						</h1>
						<p className="mt-1 text-sm leading-relaxed text-muted-foreground">
							These settings control a live talent listing. Go live first and
							they unlock.
						</p>
						<Link
							to="/marketplace/talent/go-live"
							className="mt-5 inline-block rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
						>
							Go live
						</Link>
					</div>
				</div>
				<MarketplaceFooter />
			</div>
		);
	}

	const isActive = talentStatus === "active";
	const name =
		profile.display_name ??
		[profile.first_name, profile.last_name].filter(Boolean).join(" ") ??
		"You";
	const rate = profile.rate_settings;
	const rateSummary = rate?.hourly_rate
		? `${formatPrice(Number(rate.hourly_rate), rate.currency ?? "USD")}/hr${
				rate.weekly_hours ? ` · ${rate.weekly_hours}h a week` : ""
			} · ${AVAILABILITY_LABELS[rate.availability ?? ""] ?? "Available"}`
		: "No rate set yet — clients see nothing until you set one.";

	return (
		<div className="flex min-h-screen flex-col bg-background pt-app-header">
			<div className="mx-auto w-full max-w-7xl flex-1 px-4 py-10 sm:px-6 lg:px-10">
				<h1 className="text-2xl font-semibold tracking-tight text-foreground">
					Talent settings
				</h1>
				<p className="mt-1 text-sm text-muted-foreground">
					{name} ({profile.email})
				</p>

				<div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
					<SettingsCard
						icon={<UserRound className="h-6 w-6" />}
						title="Personal information"
						body="Update your name, headline, bio, portfolio, skills and online visibility."
						footer={
							<CardLinkLabel
								label="Edit profile"
								to="/marketplace/talent/$profileId"
								params={{ profileId: profile.id }}
							/>
						}
					/>

					<SettingsCard
						icon={<Wallet className="h-6 w-6" />}
						title="Rate & availability"
						body={rateSummary}
						footer={
							<CardLinkLabel
								label="Update rate"
								to="/marketplace/talent/$profileId"
								params={{ profileId: profile.id }}
							/>
						}
					/>

					<SettingsCard
						icon={<Radio className="h-6 w-6" />}
						title="Listing status"
						body={
							isActive
								? "Open to work — you are discoverable in the talent pool and can be invited to projects."
								: "Paused — hidden from the talent pool until you resume."
						}
						footer={
							<button
								type="button"
								onClick={() => statusMutation.mutate(!isActive)}
								disabled={statusMutation.isPending}
								className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-border px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted disabled:opacity-50"
							>
								{statusMutation.isPending ? (
									<Loader2 className="h-4 w-4 animate-spin" />
								) : isActive ? (
									<Pause className="h-4 w-4" />
								) : (
									<Play className="h-4 w-4" />
								)}
								{isActive ? "Pause listing" : "Resume listing"}
							</button>
						}
					/>
				</div>
			</div>
			<MarketplaceFooter />
		</div>
	);
}

/** One settings area: icon up top, title, current-state description, action. */
function SettingsCard({
	icon,
	title,
	body,
	footer,
}: {
	icon: ReactNode;
	title: string;
	body: string;
	footer: ReactNode;
}) {
	return (
		<div className="flex flex-col rounded-2xl border border-border bg-card p-6">
			<span className="text-primary">{icon}</span>
			<h2 className="mt-4 text-[17px] font-semibold text-foreground">
				{title}
			</h2>
			<p className="mt-2 text-[13.5px] leading-relaxed text-muted-foreground">
				{body}
			</p>
			<div className="mt-auto pt-5">{footer}</div>
		</div>
	);
}

function CardLinkLabel({
	label,
	to,
	params,
}: {
	label: string;
	to: string;
	params?: Record<string, string>;
}) {
	return (
		<Link
			// Same typed-router escape hatch as the hub cards.
			to={to as never}
			params={params as never}
			className="group inline-flex items-center gap-1.5 rounded-xl border border-border px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
		>
			{label}
			<ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
		</Link>
	);
}
