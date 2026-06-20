import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Pencil, X } from "lucide-react";

const POSITION_MAX_LENGTH = 80;

/**
 * Position label cell. Shared by the project team page and the
 * permissions team tab. Renders the value (or a fallback) plus a
 * pencil affordance. Clicking the pencil opens a centered modal with
 * a single text input — Save commits, Cancel/Escape closes.
 */
export function PositionCell({
	value,
	fallback,
	canEdit,
	onSave,
	displayName,
}: {
	value: string | null;
	fallback: string;
	canEdit: boolean;
	onSave?: (next: string) => Promise<void> | void;
	/**
	 * Optional name shown in the modal header — e.g. "Edit position for
	 * Jasmin Fedilo". Falls back to a generic title when omitted.
	 */
	displayName?: string;
}) {
	const [open, setOpen] = useState(false);

	return (
		<>
			<div className="flex min-w-0 items-center gap-1.5">
				<span className="truncate text-sm text-slate-600">
					{value?.trim() || fallback}
				</span>
				{canEdit && (
					<button
						type="button"
						onClick={() => setOpen(true)}
						className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-900"
						title="Edit position"
					>
						<Pencil className="h-3.5 w-3.5" />
					</button>
				)}
			</div>

			{open && (
				<EditPositionModal
					initialValue={value ?? ""}
					displayName={displayName}
					onClose={() => setOpen(false)}
					onSave={onSave}
				/>
			)}
		</>
	);
}

function EditPositionModal({
	initialValue,
	displayName,
	onClose,
	onSave,
}: {
	initialValue: string;
	displayName?: string;
	onClose: () => void;
	onSave?: (next: string) => Promise<void> | void;
}) {
	const [draft, setDraft] = useState(initialValue);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const inputRef = useRef<HTMLInputElement | null>(null);

	useEffect(() => {
		requestAnimationFrame(() => inputRef.current?.focus());
	}, []);

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape" && !saving) onClose();
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [onClose, saving]);

	const submit = async () => {
		if (!onSave || saving) return;
		const trimmed = draft.trim();
		if (trimmed === initialValue.trim()) {
			onClose();
			return;
		}
		setSaving(true);
		setError(null);
		try {
			await onSave(trimmed);
			onClose();
		} catch (e) {
			setError(e instanceof Error ? e.message : "Couldn't save position.");
		} finally {
			setSaving(false);
		}
	};

	const title = displayName
		? `Edit position — ${displayName}`
		: "Edit position";

	return createPortal(
		<AnimatePresence>
			<motion.div
				key="backdrop"
				initial={{ opacity: 0 }}
				animate={{ opacity: 1 }}
				exit={{ opacity: 0 }}
				transition={{ duration: 0.15 }}
				className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm"
				onClick={() => {
					if (!saving) onClose();
				}}
			>
				<motion.div
					key="dialog"
					initial={{ opacity: 0, y: 8, scale: 0.98 }}
					animate={{ opacity: 1, y: 0, scale: 1 }}
					exit={{ opacity: 0, y: 8, scale: 0.98 }}
					transition={{ duration: 0.18, ease: "easeOut" }}
					onClick={(e) => e.stopPropagation()}
					className="w-full max-w-md mx-4 rounded-2xl border border-slate-200 bg-white shadow-xl"
					role="dialog"
					aria-modal="true"
					aria-labelledby="edit-position-title"
				>
					<div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
						<h2
							id="edit-position-title"
							className="truncate text-sm font-semibold text-slate-900"
						>
							{title}
						</h2>
						<button
							type="button"
							onClick={() => !saving && onClose()}
							disabled={saving}
							className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
							aria-label="Close"
						>
							<X className="h-4 w-4" />
						</button>
					</div>

					<form
						onSubmit={(e) => {
							e.preventDefault();
							void submit();
						}}
						className="px-5 py-4 space-y-3"
					>
						<label className="block">
							<span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
								Position
							</span>
							<input
								ref={inputRef}
								value={draft}
								maxLength={POSITION_MAX_LENGTH}
								onChange={(e) => setDraft(e.target.value)}
								placeholder="e.g. Backend Developer, CEO, Designer"
								disabled={saving}
								className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10 disabled:opacity-60"
							/>
							<div className="mt-1 flex justify-between text-[11px] text-slate-400">
								<span>Free-form label, never used for permissions.</span>
								<span>
									{draft.length}/{POSITION_MAX_LENGTH}
								</span>
							</div>
						</label>

						{error && (
							<p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
								{error}
							</p>
						)}

						<div className="flex justify-end gap-2 pt-2">
							<button
								type="button"
								onClick={() => !saving && onClose()}
								disabled={saving}
								className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
							>
								Cancel
							</button>
							<button
								type="submit"
								disabled={saving}
								className="rounded-md bg-primary px-3 py-1.5 text-sm font-semibold text-white hover:bg-primary/90 disabled:opacity-60"
							>
								{saving ? "Saving…" : "Save"}
							</button>
						</div>
					</form>
				</motion.div>
			</motion.div>
		</AnimatePresence>,
		document.body,
	);
}
