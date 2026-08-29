import { Link } from "@tanstack/react-router";
import { Layers, Pencil } from "lucide-react";
import { formatPrice } from "@/components/marketplace/consultant/ConsultantServices";
import { cn } from "@/lib/utils";
import type { ServiceOffering } from "@/queries/serviceOfferings";

const STATUS_STYLES: Record<ServiceOffering["status"], string> = {
	draft: "bg-muted text-muted-foreground",
	published:
		"bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 font-medium",
	archived: "bg-muted text-muted-foreground",
};

/** One row of the seller's own catalog — status, from-price, edit/view. */
export function ServiceMineCard({ service }: { service: ServiceOffering }) {
	const packageCount = service.packages?.length ?? 0;

	return (
		<div className="flex items-center gap-4 rounded-2xl border border-border bg-card p-4">
			{service.cover_url ? (
				<img
					src={service.cover_url}
					alt=""
					className="h-16 w-28 shrink-0 rounded-lg object-cover"
					loading="lazy"
				/>
			) : (
				<div className="flex h-16 w-28 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
					<Layers className="h-5 w-5" />
				</div>
			)}

			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-2">
					<h3 className="min-w-0 truncate text-sm font-semibold text-foreground">
						{service.title}
					</h3>
					<span
						className={cn(
							"shrink-0 rounded-full px-2 py-0.5 text-[11px] capitalize",
							STATUS_STYLES[service.status],
						)}
					>
						{service.status}
					</span>
				</div>
				<p className="mt-1 text-xs text-muted-foreground">
					{packageCount
						? `${packageCount} package${packageCount === 1 ? "" : "s"} · from ${formatPrice(service.starting_price, service.currency)}`
						: "No packages yet — add one to publish"}
				</p>
			</div>

			<div className="flex shrink-0 items-center gap-2">
				{service.status === "published" && (
					<Link
						to="/marketplace/services/$serviceId"
						params={{ serviceId: service.id }}
						className="rounded-xl border border-border px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-muted"
					>
						View
					</Link>
				)}
				<Link
					to="/marketplace/services/$serviceId/edit"
					params={{ serviceId: service.id }}
					className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90"
				>
					<Pencil className="h-3.5 w-3.5" />
					Edit
				</Link>
			</div>
		</div>
	);
}
