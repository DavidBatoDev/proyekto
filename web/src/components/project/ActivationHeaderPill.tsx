import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, Circle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useActivationChecklist } from "@/hooks/useActivationChecklist";
import type { Project } from "@/services/project.service";
import { useUser } from "@/stores/authStore";
import { ActivationGuide, checklistProgress } from "./ActivationGuide";

/**
 * A "Setup N/7" pill + dropdown in the project header. Because the header is the
 * one element on screen in EVERY project section, this makes activation
 * progress glanceable from anywhere — a consultant in Roadmap or Time can see
 * what's left and jump straight to the fix. Hidden once the project is active or
 * for anyone who can't manage it.
 */
export function ActivationHeaderPill({
	projectId,
	project,
}: {
	projectId: string;
	project: Project | null;
}) {
	const user = useUser();
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);

	// Owner/consultant of record only, and only while not yet active.
	const canManage = Boolean(
		user?.id &&
			project &&
			(project.owner_id === user.id || project.consultant_id === user.id),
	);
	const active = project?.status === "active";
	const enabled = canManage && !active && Boolean(projectId);

	const checklistQuery = useActivationChecklist(projectId, { enabled });

	useEffect(() => {
		if (!open) return;
		const onDown = (e: MouseEvent) => {
			if (!ref.current?.contains(e.target as Node)) setOpen(false);
		};
		document.addEventListener("mousedown", onDown);
		return () => document.removeEventListener("mousedown", onDown);
	}, [open]);

	if (!enabled || !checklistQuery.data) return null;

	const { done, total } = checklistProgress(checklistQuery.data);
	const complete = done === total;

	return (
		<div ref={ref} className="relative hidden sm:block">
			<button
				type="button"
				onClick={() => setOpen((v) => !v)}
				className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
					complete
						? "border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
						: "border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100"
				}`}
			>
				<Circle
					className={`h-2 w-2 ${complete ? "fill-emerald-500 text-emerald-500" : "fill-amber-500 text-amber-500"}`}
				/>
				Setup {done}/{total}
				<ChevronDown className="h-3.5 w-3.5" />
			</button>

			<AnimatePresence>
				{open && (
					<motion.div
						initial={{ opacity: 0, y: -6, scale: 0.98 }}
						animate={{ opacity: 1, y: 0, scale: 1 }}
						exit={{ opacity: 0, y: -6, scale: 0.98 }}
						transition={{ duration: 0.15, ease: "easeOut" }}
						className="absolute right-0 z-50 mt-2 w-80 rounded-2xl border border-slate-200 bg-white p-4 shadow-xl"
					>
						<div className="mb-2 flex items-center justify-between">
							<p className="text-sm font-semibold text-slate-900">
								Make this project live
							</p>
							<span className="text-xs font-semibold text-slate-500">
								{done}/{total}
							</span>
						</div>
						<ActivationGuide
							projectId={projectId}
							checklist={checklistQuery.data}
							isLoading={false}
							projectStatus={project?.status ?? null}
							mode="compact"
							onActivated={() => setOpen(false)}
						/>
					</motion.div>
				)}
			</AnimatePresence>
		</div>
	);
}
