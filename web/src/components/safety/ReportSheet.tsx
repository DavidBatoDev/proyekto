import { AnimatePresence, motion } from "framer-motion";
import { Check, Flag, LifeBuoy, Loader2, ShieldBan, X } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { AppDialog } from "@/components/common/AppDialog";
import { useIsMobile } from "@/hooks/useIsMobile";
import { extractApiErrorMessage } from "@/lib/permissionErrors";
import { isNativeApp } from "@/lib/platform";
import { useReportContent } from "@/queries/safety";
import type { ReportReason, ReportTargetType } from "@/services/safety.service";
import { PersonAvatar } from "./PersonAvatar";
import {
	DETAILS_MAX,
	firstName,
	REPORT_REASONS,
	reportTitle,
} from "./safetyCopy";

export interface ReportTarget {
	type: ReportTargetType;
	id: string;
	author: { id: string; name: string; avatarUrl?: string | null };
	/** The reported text, shown back so people know exactly what they're flagging. */
	preview?: string | null;
	/** Pre-formatted, e.g. "2:14 PM" or "Sep 30". */
	previewMeta?: string | null;
}

/**
 * Report a message, comment or person (App Store guideline 1.2).
 *
 * A bottom sheet on phones and a centred dialog on desktop. The flow is one
 * screen: see what you're reporting, pick a reason, optionally add a note and
 * block the person, submit — then a thank-you state in the same sheet, so the
 * confirmation is unmissable rather than a toast that slides away.
 */
export function ReportSheet({
	target,
	isAuthorBlocked,
	onClose,
}: {
	target: ReportTarget | null;
	isAuthorBlocked: boolean;
	onClose: () => void;
}) {
	const isMobile = useIsMobile();
	const asSheet = isMobile || isNativeApp();
	const report = useReportContent();
	const detailsId = useId();

	const [reason, setReason] = useState<ReportReason | null>(null);
	const [details, setDetails] = useState("");
	const [alsoBlock, setAlsoBlock] = useState(false);
	const [done, setDone] = useState<{ blocked: boolean } | null>(null);
	const [error, setError] = useState<string | null>(null);

	// A fresh form for every target.
	useEffect(() => {
		if (!target) return;
		setReason(null);
		setDetails("");
		setAlsoBlock(false);
		setDone(null);
		setError(null);
		report.reset();
		// Keyed on the target only: `report` is a fresh object every render.
	}, [target?.type, target?.id]);

	if (!target) return null;

	const name = target.author.name || "this person";
	const first = firstName(name);
	const canBlock = !isAuthorBlocked;
	const busy = report.isPending;

	const submit = async () => {
		if (!reason || busy) return;
		setError(null);
		try {
			const result = await report.mutateAsync({
				target_type: target.type,
				target_id: target.id,
				reason,
				details: details.trim() || undefined,
				also_block: canBlock && alsoBlock ? true : undefined,
			});
			setDone({ blocked: result.blocked });
		} catch (err) {
			const body = (err as { response?: { data?: unknown } })?.response?.data;
			setError(
				extractApiErrorMessage(
					body,
					"We couldn't send your report. Check your connection and try again.",
				),
			);
		}
	};

	return (
		<AppDialog
			open
			onClose={onClose}
			variant={asSheet ? "bottom-sheet" : "center"}
			size="md"
			busy={busy}
			hideCloseButton
			bare
			zIndex={1300}
		>
			<AnimatePresence mode="wait" initial={false}>
				{done ? (
					<motion.div
						key="done"
						initial={{ opacity: 0, y: 8 }}
						animate={{ opacity: 1, y: 0 }}
						exit={{ opacity: 0 }}
						transition={{ duration: 0.2 }}
						className="flex flex-col items-center px-6 pb-6 pt-8 text-center"
					>
						<motion.span
							initial={{ scale: 0.4, opacity: 0 }}
							animate={{ scale: 1, opacity: 1 }}
							transition={{ type: "spring", stiffness: 320, damping: 18 }}
							className="flex h-16 w-16 items-center justify-center rounded-full bg-success/15 text-success"
						>
							<motion.span
								initial={{ scale: 0 }}
								animate={{ scale: 1 }}
								transition={{ delay: 0.12, type: "spring", stiffness: 400 }}
							>
								<Check className="h-8 w-8" strokeWidth={3} />
							</motion.span>
						</motion.span>
						<h2 className="mt-5 text-lg font-bold text-card-foreground">
							Thanks for letting us know
						</h2>
						<p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
							Our team reviews every report within 24 hours and removes anything
							that breaks our rules. {first} won't know you reported this.
						</p>
						{done.blocked && (
							<span className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1.5 text-xs font-semibold text-foreground">
								<ShieldBan className="h-3.5 w-3.5 text-destructive" />
								You also blocked {first}
							</span>
						)}
						{reason === "self_harm" && (
							<p className="mt-4 flex max-w-sm items-start gap-2 rounded-xl bg-info/10 px-3.5 py-3 text-left text-xs leading-relaxed text-foreground">
								<LifeBuoy className="mt-0.5 h-4 w-4 shrink-0 text-info" />
								If someone is in immediate danger, contact your local emergency
								services right away.
							</p>
						)}
						<button
							type="button"
							onClick={onClose}
							className="app-cta mt-6 inline-flex h-11 w-full max-w-xs items-center justify-center rounded-xl text-sm font-semibold text-white"
						>
							Done
						</button>
					</motion.div>
				) : (
					<motion.div
						key="form"
						initial={{ opacity: 0 }}
						animate={{ opacity: 1 }}
						exit={{ opacity: 0 }}
						transition={{ duration: 0.15 }}
						className="flex min-h-0 flex-1 flex-col"
					>
						{/* Header */}
						<div className="flex items-start gap-3 px-5 pb-1 pt-5">
							<span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
								<Flag className="h-5 w-5" />
							</span>
							<div className="min-w-0 flex-1 pt-0.5">
								<h2 className="text-base font-bold text-card-foreground">
									{reportTitle(target.type, name)}
								</h2>
								<p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
									{first} won't know you reported this.
								</p>
							</div>
							<button
								type="button"
								onClick={onClose}
								disabled={busy}
								aria-label="Close"
								className="-mr-1 -mt-1 rounded-full p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
							>
								<X className="h-4 w-4" />
							</button>
						</div>

						<div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
							{/* What is being reported */}
							{target.type !== "user" ? (
								<div className="mt-4 rounded-2xl border border-border bg-muted/40 p-3.5">
									<div className="flex items-center gap-2.5">
										<PersonAvatar
											name={name}
											avatarUrl={target.author.avatarUrl}
											size="sm"
										/>
										<p className="min-w-0 truncate text-sm font-semibold text-foreground">
											{name}
											{target.previewMeta && (
												<span className="ml-2 text-xs font-normal text-muted-foreground">
													{target.previewMeta}
												</span>
											)}
										</p>
									</div>
									<p className="mt-2 line-clamp-4 whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground/90">
										{target.preview?.trim() || (
											<span className="italic text-muted-foreground">
												Attachment or empty message
											</span>
										)}
									</p>
								</div>
							) : (
								<div className="mt-4 flex items-center gap-3 rounded-2xl border border-border bg-muted/40 p-3.5">
									<PersonAvatar
										name={name}
										avatarUrl={target.author.avatarUrl}
									/>
									<div className="min-w-0">
										<p className="truncate text-sm font-semibold text-foreground">
											{name}
										</p>
										<p className="text-xs text-muted-foreground">
											Reporting this person's behaviour
										</p>
									</div>
								</div>
							)}

							{/* Reasons */}
							<p
								id={`${detailsId}-reasons`}
								className="mb-2 mt-5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground"
							>
								Why are you reporting this?
							</p>
							<div
								role="radiogroup"
								aria-labelledby={`${detailsId}-reasons`}
								className="grid gap-2"
							>
								{REPORT_REASONS.map((option) => {
									const selected = reason === option.value;
									const Icon = option.icon;
									return (
										<button
											key={option.value}
											type="button"
											role="radio"
											aria-checked={selected}
											onClick={() => setReason(option.value)}
											className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-all ${
												selected
													? "border-primary bg-primary/5 shadow-sm ring-1 ring-primary"
													: "border-border bg-card hover:border-primary/40 hover:bg-muted/50"
											}`}
										>
											<span
												className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors ${
													selected
														? "bg-primary text-primary-foreground"
														: "bg-muted text-muted-foreground"
												}`}
											>
												<Icon className="h-4 w-4" />
											</span>
											<span className="min-w-0 flex-1">
												<span className="block text-sm font-semibold text-foreground">
													{option.title}
												</span>
												<span className="block text-xs text-muted-foreground">
													{option.hint}
												</span>
											</span>
											<span
												className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
													selected
														? "border-primary bg-primary text-primary-foreground"
														: "border-border"
												}`}
											>
												{selected && (
													<Check className="h-3 w-3" strokeWidth={3} />
												)}
											</span>
										</button>
									);
								})}
							</div>

							{/* Details + block, once a reason is picked */}
							<AnimatePresence initial={false}>
								{reason && (
									<motion.div
										key="more"
										initial={{ height: 0, opacity: 0 }}
										animate={{ height: "auto", opacity: 1 }}
										exit={{ height: 0, opacity: 0 }}
										transition={{ duration: 0.2 }}
										className="overflow-hidden"
									>
										<label
											htmlFor={detailsId}
											className="mb-2 mt-5 block text-[11px] font-bold uppercase tracking-wider text-muted-foreground"
										>
											Anything else we should know?{" "}
											<span className="font-medium normal-case tracking-normal">
												(optional)
											</span>
										</label>
										<textarea
											id={detailsId}
											value={details}
											onChange={(e) =>
												setDetails(e.target.value.slice(0, DETAILS_MAX))
											}
											rows={3}
											placeholder="Add context that helps us review this"
											className="w-full resize-none rounded-xl border border-input bg-background px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
										/>
										<p className="mt-1 text-right text-[11px] text-muted-foreground">
											{details.length}/{DETAILS_MAX}
										</p>

										{canBlock && (
											<button
												type="button"
												role="switch"
												aria-checked={alsoBlock}
												onClick={() => setAlsoBlock((v) => !v)}
												className="mt-2 flex w-full items-center gap-3 rounded-xl border border-border bg-card px-3 py-3 text-left transition-colors hover:bg-muted/50"
											>
												<span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
													<ShieldBan className="h-4 w-4" />
												</span>
												<span className="min-w-0 flex-1">
													<span className="block text-sm font-semibold text-foreground">
														Also block {first}
													</span>
													<span className="block text-xs text-muted-foreground">
														You won't see their messages, and they can't message
														you.
													</span>
												</span>
												<span
													className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
														alsoBlock
															? "bg-destructive"
															: "bg-muted-foreground/30"
													}`}
												>
													<span
														className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
															alsoBlock ? "left-[22px]" : "left-0.5"
														}`}
													/>
												</span>
											</button>
										)}
									</motion.div>
								)}
							</AnimatePresence>

							{error && (
								<p
									role="alert"
									className="mt-4 rounded-xl bg-destructive/10 px-3.5 py-2.5 text-xs font-medium text-destructive"
								>
									{error}
								</p>
							)}
						</div>

						{/* Footer */}
						<div className="flex flex-col-reverse gap-2 border-t border-border px-5 py-4 sm:flex-row sm:justify-end">
							<button
								type="button"
								onClick={onClose}
								disabled={busy}
								className="inline-flex h-11 items-center justify-center rounded-xl border border-border px-5 text-sm font-semibold text-foreground transition-colors hover:bg-muted disabled:opacity-50 sm:h-10"
							>
								Cancel
							</button>
							<button
								type="button"
								onClick={() => void submit()}
								disabled={!reason || busy}
								className="app-cta inline-flex h-11 items-center justify-center gap-2 rounded-xl px-5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 sm:h-10"
							>
								{busy && <Loader2 className="h-4 w-4 animate-spin" />}
								Submit report
							</button>
						</div>
					</motion.div>
				)}
			</AnimatePresence>
		</AppDialog>
	);
}
