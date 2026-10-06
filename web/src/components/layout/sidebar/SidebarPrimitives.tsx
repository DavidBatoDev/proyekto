import { Link } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

export function SidebarSectionHeader({ children }: { children: ReactNode }) {
	return (
		<div className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-sidebar-foreground/60">
			{children}
		</div>
	);
}

/** Counts above this read "99+", so a pill never outgrows the rail. */
const BADGE_CAP = 99;

export function SidebarNavLink({
	to,
	icon: Icon,
	label,
	active,
	params,
	tone = "solid",
	badge,
	badgeLabel,
}: {
	to: string;
	icon: React.ElementType;
	label: string;
	active: boolean;
	params?: Record<string, string>;
	/**
	 * `solid` fills the active item; `tint` washes it in the accent and colours
	 * the label. Tint is for navs that list PLACES (a tree the eye scans down)
	 * rather than modes, where a solid bar on every level is too heavy.
	 */
	tone?: "solid" | "tint";
	/**
	 * A count pill at the row's end (Time's "approvals waiting"). Hidden at
	 * zero, null or undefined, so callers can pass the raw number.
	 */
	badge?: number | null;
	/**
	 * What the count means, for screen readers ("3 timesheets waiting").
	 * Defaults to the bare number.
	 */
	badgeLabel?: string;
}) {
	const activeClass =
		tone === "tint"
			? "bg-primary/10 font-semibold text-primary"
			: "bg-sidebar-primary text-sidebar-primary-foreground shadow-sm";
	const count =
		typeof badge === "number" && Number.isFinite(badge) && badge > 0
			? Math.floor(badge)
			: 0;
	// On the solid active row the pill inverts, so it stays visible against
	// the filled background; everywhere else it is the primary accent.
	const badgeClass =
		active && tone === "solid"
			? "bg-sidebar-primary-foreground text-sidebar-primary"
			: "bg-primary text-primary-foreground";
	return (
		<Link
			to={to}
			params={params}
			className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
				active
					? activeClass
					: "text-sidebar-foreground/85 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
			}`}
		>
			<Icon className="h-5 w-5 shrink-0" />
			<span className="truncate">{label}</span>
			{count > 0 ? (
				<span
					data-testid="sidebar-nav-badge"
					className={`ml-auto inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold tabular-nums ${badgeClass}`}
				>
					<span aria-hidden="true">
						{count > BADGE_CAP ? `${BADGE_CAP}+` : count}
					</span>
					<span className="sr-only">{badgeLabel ?? String(count)}</span>
				</span>
			) : null}
		</Link>
	);
}

export function SidebarSubLink({
	to,
	icon: Icon,
	label,
	active,
	params,
	search,
	tone = "solid",
}: {
	to: string;
	icon: React.ElementType;
	label: string;
	active: boolean;
	params?: Record<string, string>;
	search?: Record<string, unknown>;
	tone?: "solid" | "tint";
}) {
	return (
		<Link
			to={to}
			params={params}
			search={search as never}
			className={`flex items-center gap-3 rounded-md px-2.5 py-2 text-sm transition-colors ${
				active
					? tone === "tint"
						? "font-semibold text-primary"
						: "bg-sidebar-primary text-sidebar-primary-foreground"
					: "text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
			}`}
		>
			<Icon className="h-4 w-4 shrink-0" />
			<span className="truncate">{label}</span>
		</Link>
	);
}

export function CollapsibleNavGroup({
	isExpanded,
	onToggle,
	header,
	headerActive,
	children,
}: {
	isExpanded: boolean;
	onToggle: () => void;
	header: ReactNode;
	headerActive?: boolean;
	children: ReactNode;
}) {
	return (
		<div>
			<div
				className={`group flex items-center gap-1 rounded-lg pr-1 transition-colors ${
					headerActive && !isExpanded
						? "bg-sidebar-accent"
						: "hover:bg-sidebar-accent"
				}`}
			>
				<button
					type="button"
					onClick={onToggle}
					aria-label={isExpanded ? "Collapse" : "Expand"}
					className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-sidebar-foreground/55 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
				>
					<motion.span
						initial={false}
						animate={{ rotate: isExpanded ? 90 : 0 }}
						transition={{ duration: 0.18, ease: "easeOut" }}
						className="flex"
					>
						<ChevronRight className="h-4 w-4" />
					</motion.span>
				</button>
				{header}
			</div>

			<AnimatePresence initial={false}>
				{isExpanded && (
					<motion.div
						key="subitems"
						initial={{ height: 0, opacity: 0 }}
						animate={{ height: "auto", opacity: 1 }}
						exit={{ height: 0, opacity: 0 }}
						transition={{
							height: { duration: 0.24, ease: [0.22, 1, 0.36, 1] },
							opacity: { duration: 0.18, ease: "easeOut" },
						}}
						className="overflow-hidden"
					>
						<motion.div
							initial={{ y: -4 }}
							animate={{ y: 0 }}
							exit={{ y: -4 }}
							transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
							className="ml-8 mt-1 space-y-0.5 border-l border-sidebar-border pl-2"
						>
							{children}
						</motion.div>
					</motion.div>
				)}
			</AnimatePresence>
		</div>
	);
}

export function useSidebarExpansion(storageKey: string) {
	const load = (): Record<string, boolean> => {
		if (typeof window === "undefined") return {};
		try {
			const raw = sessionStorage.getItem(storageKey);
			return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
		} catch {
			return {};
		}
	};
	const save = (state: Record<string, boolean>) => {
		if (typeof window === "undefined") return;
		try {
			sessionStorage.setItem(storageKey, JSON.stringify(state));
		} catch {
			/* non-fatal */
		}
	};
	return { load, save };
}
