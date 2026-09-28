import { createFileRoute, Link } from "@tanstack/react-router";
import { Store, Wallet } from "lucide-react";

/**
 * Where the installed app sends a page it does not carry.
 *
 * The mobile app is free on both stores and the SaaS is paid on the web, so the
 * shell holds no commerce surface; the marketplace is out too, because the app
 * is the SaaS half of the product only. Those paths are still reachable — an
 * old push payload, a notification row written months ago, a link in an email —
 * and they must never 404, so the root gate lands them here.
 *
 * The copy states an absence and stops. No price, no plan name, no domain, no
 * outbound link: a link out of a commerce screen is the purchase-steering that
 * store review looks for, and there is nothing the reader could do with it from
 * the phone anyway.
 */

type Surface = "commerce" | "marketplace" | "unavailable";

const SURFACES = new Set<Surface>(["commerce", "marketplace", "unavailable"]);

interface Copy {
	icon: typeof Wallet;
	title: string;
	body: string;
}

const COPY: Record<Surface, Copy> = {
	commerce: {
		icon: Wallet,
		title: "Plans and billing aren't available in the app",
		body: "Your workspace's plan applies here in full — it just isn't managed from your phone. Plan changes are made from a browser.",
	},
	marketplace: {
		icon: Store,
		title: "The Proyekto marketplace isn't available in the app",
		body: "Finding consultants, briefs, contracts and invoices live on the web. The app carries your workspace and the work in it.",
	},
	unavailable: {
		icon: Store,
		title: "This page isn't available in the app",
		body: "Open Proyekto in a browser to reach it. Everything in your workspace is here.",
	},
};

export const Route = createFileRoute("/not-available")({
	validateSearch: (search: Record<string, unknown>) => {
		const raw = search.surface;
		return {
			surface:
				typeof raw === "string" && SURFACES.has(raw as Surface)
					? (raw as Surface)
					: ("unavailable" as Surface),
		};
	},
	component: NotAvailablePage,
});

function NotAvailablePage() {
	const { surface } = Route.useSearch();
	const { icon: Icon, title, body } = COPY[surface];

	return (
		<div className="flex min-h-[100dvh] flex-col bg-background px-6 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]">
			<section className="flex flex-1 flex-col items-center justify-center">
				<div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted">
					<Icon size={26} className="text-muted-foreground" aria-hidden />
				</div>

				<h1 className="mt-6 max-w-[320px] text-center text-xl font-semibold text-foreground">
					{title}
				</h1>
				<p className="mt-3 max-w-[320px] text-center text-sm leading-relaxed text-muted-foreground">
					{body}
				</p>
			</section>

			<footer className="pt-8">
				<Link
					to="/dashboard"
					replace
					className="flex h-13 items-center justify-center rounded-xl bg-primary text-base font-semibold text-primary-foreground active:opacity-90"
				>
					Back to Proyekto
				</Link>
			</footer>
		</div>
	);
}
