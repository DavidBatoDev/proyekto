import { Link } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

export function SidebarSectionHeader({ children }: { children: ReactNode }) {
	return (
		<div className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
			{children}
		</div>
	);
}

export function SidebarNavLink({
	to,
	icon: Icon,
	label,
	active,
	params,
}: {
	to: string;
	icon: React.ElementType;
	label: string;
	active: boolean;
	params?: Record<string, string>;
}) {
	return (
		<Link
			to={to}
			params={params}
			className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
				active
					? "bg-primary text-white shadow-sm"
					: "text-slate-700 hover:bg-slate-100 hover:text-slate-900"
			}`}
		>
			<Icon className="h-5 w-5 shrink-0" />
			<span className="truncate">{label}</span>
		</Link>
	);
}

export function SidebarSubLink({
	to,
	icon: Icon,
	label,
	active,
	params,
}: {
	to: string;
	icon: React.ElementType;
	label: string;
	active: boolean;
	params?: Record<string, string>;
}) {
	return (
		<Link
			to={to}
			params={params}
			className={`flex items-center gap-3 rounded-md px-2.5 py-2 text-sm transition-colors ${
				active
					? "bg-primary text-white"
					: "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
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
					headerActive && !isExpanded ? "bg-slate-100" : "hover:bg-slate-50"
				}`}
			>
				<button
					type="button"
					onClick={onToggle}
					aria-label={isExpanded ? "Collapse" : "Expand"}
					className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-slate-200 hover:text-slate-700"
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
							className="ml-8 mt-1 space-y-0.5 border-l border-slate-200 pl-2"
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
