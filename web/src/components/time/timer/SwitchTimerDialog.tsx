// web/src/components/time/timer/SwitchTimerDialog.tsx
//
// The Switch prompt (ux.md › Timer › Switching): starting while a timer runs
// asks "Stop *Fix login bug* (1:12) and start this?" with **Switch**. There
// are never two timers.
//
// `StartTimerPrompts` renders every prompt of a `useStartTimer` flow: the
// Switch prompt, the For picker, the locked-period card with its inline
// Withdraw, and the "You can't log time on this project" card. With an
// `anchorRef` (a task row's timer button) they open as a popover anchored to
// it; without one, as a dialog.

import { AlertTriangle, Ban, Loader2 } from "lucide-react";
import type { ReactNode, RefObject } from "react";
import { AnchoredPopover } from "@/components/common/AnchoredPopover";
import { AppDialog } from "@/components/common/AppDialog";
import type { TimeEntryView } from "@/services/time.types";
import { ForPickerPanel } from "../for/ForPicker";
import {
	CANCEL_BUTTON,
	CLOSE_BUTTON,
	entryWorkLabel,
	PICKER_TITLE,
	SWITCH_BUTTON,
	switchPromptText,
	WITHDRAW_BUTTON,
} from "../for/forCopy";
import {
	formatHoursMinutes,
	liveWorkSeconds,
	useLiveNowMs,
} from "./liveDuration";
import type { StartTimerFlow } from "./useStartTimer";

const SECONDARY =
	"rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted disabled:opacity-50";
const PRIMARY =
	"inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50";

// ── Switch ──────────────────────────────────────────────────────────────────

export interface SwitchTimerPanelProps {
	running: TimeEntryView | null;
	busy?: boolean;
	error?: string | null;
	onSwitch: () => void;
	onCancel: () => void;
	/** Live clock while shown. */
	active?: boolean;
}

/** The question, the error, Cancel and Switch. */
export function SwitchTimerPanel({
	running,
	busy = false,
	error,
	onSwitch,
	onCancel,
	active = true,
}: SwitchTimerPanelProps) {
	const nowMs = useLiveNowMs(active && Boolean(running));
	const duration = formatHoursMinutes(
		running ? liveWorkSeconds(running, nowMs) : 0,
	);
	return (
		<div className="space-y-3 p-3">
			<p className="text-sm font-semibold text-foreground">
				{switchPromptText(entryWorkLabel(running), duration)}
			</p>
			{error ? (
				<p role="alert" className="text-xs text-destructive">
					{error}
				</p>
			) : null}
			<div className="flex justify-end gap-2">
				<button
					type="button"
					onClick={onCancel}
					disabled={busy}
					className={SECONDARY}
				>
					{CANCEL_BUTTON}
				</button>
				<button
					type="button"
					onClick={onSwitch}
					disabled={busy}
					className={PRIMARY}
				>
					{busy ? (
						<Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
					) : null}
					{SWITCH_BUTTON}
				</button>
			</div>
		</div>
	);
}

export interface SwitchTimerDialogProps extends SwitchTimerPanelProps {
	open: boolean;
	zIndex?: number;
}

export function SwitchTimerDialog({
	open,
	zIndex,
	...panel
}: SwitchTimerDialogProps) {
	return (
		<AppDialog
			open={open}
			onClose={panel.onCancel}
			busy={panel.busy}
			size="sm"
			hideCloseButton
			bare
			zIndex={zIndex}
		>
			<SwitchTimerPanel {...panel} active={open} />
		</AppDialog>
	);
}

// ── Locked period and blocked ───────────────────────────────────────────────

function NoticePanel({
	icon,
	title,
	children,
	error,
	actions,
}: {
	icon: ReactNode;
	title: string;
	children?: ReactNode;
	error?: string | null;
	actions: ReactNode;
}) {
	return (
		<div className="space-y-3 p-3">
			<div className="flex items-start gap-2.5">
				{icon}
				<div className="min-w-0 space-y-1">
					<p className="text-sm font-semibold text-foreground">{title}</p>
					{children ? (
						<div className="text-xs leading-relaxed text-muted-foreground">
							{children}
						</div>
					) : null}
				</div>
			</div>
			{error ? (
				<p role="alert" className="text-xs text-destructive">
					{error}
				</p>
			) : null}
			<div className="flex justify-end gap-2">{actions}</div>
		</div>
	);
}

// ── All prompts of a flow ───────────────────────────────────────────────────

export interface StartTimerPromptsProps {
	flow: StartTimerFlow;
	/** Opens the prompts as a popover anchored here (a task's timer button). */
	anchorRef?: RefObject<HTMLElement | null>;
	/** Above AppDialog when the trigger sits in one. */
	zIndex?: number;
	projectWorkspaceName?: string | null;
}

export function StartTimerPrompts({
	flow,
	anchorRef,
	zIndex,
	projectWorkspaceName,
}: StartTimerPromptsProps) {
	const { state, prompt, isPending } = flow;
	const open = prompt !== null;

	let content: ReactNode = null;
	let label = "";
	if (prompt === "switch") {
		label = SWITCH_BUTTON;
		content = (
			<SwitchTimerPanel
				running={state.running}
				busy={isPending}
				error={state.error}
				onSwitch={() => void flow.confirmSwitch()}
				onCancel={flow.cancel}
			/>
		);
	} else if (prompt === "pick" && state.result) {
		label = PICKER_TITLE;
		content = (
			<ForPickerPanel
				mode="start"
				result={state.result}
				value={state.choice}
				onChange={(option) => flow.select(option)}
				remember={state.remember}
				onRememberChange={flow.setRemember}
				busy={isPending}
				error={state.error}
				projectWorkspaceName={projectWorkspaceName}
				onConfirm={() => void flow.confirmPick()}
				onCancel={flow.cancel}
			/>
		);
	} else if (prompt === "locked" && state.locked) {
		const locked = state.locked;
		// Named by its sentence: "Withdraw" would be wrong when Withdraw is not offered.
		label = locked.message;
		content = (
			<NoticePanel
				icon={
					<AlertTriangle
						className="mt-0.5 h-4 w-4 shrink-0 text-warning"
						aria-hidden="true"
					/>
				}
				title={locked.message}
				error={state.error}
				actions={
					<>
						<button
							type="button"
							onClick={flow.cancel}
							disabled={isPending}
							className={SECONDARY}
						>
							{locked.canWithdraw ? CANCEL_BUTTON : CLOSE_BUTTON}
						</button>
						{locked.canWithdraw ? (
							<button
								type="button"
								onClick={() => void flow.withdrawAndRetry()}
								disabled={isPending}
								className={PRIMARY}
							>
								{isPending ? (
									<Loader2
										className="h-3.5 w-3.5 animate-spin"
										aria-hidden="true"
									/>
								) : null}
								{WITHDRAW_BUTTON}
							</button>
						) : null}
					</>
				}
			/>
		);
	} else if (prompt === "blocked" && state.blocked) {
		label = state.blocked.title;
		content = (
			<NoticePanel
				icon={
					<Ban
						className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
						aria-hidden="true"
					/>
				}
				title={state.blocked.title}
				actions={
					<button type="button" onClick={flow.cancel} className={SECONDARY}>
						{CLOSE_BUTTON}
					</button>
				}
			>
				{state.blocked.why}
			</NoticePanel>
		);
	}

	const close = () => {
		if (!isPending) flow.cancel();
	};

	if (anchorRef) {
		return (
			<AnchoredPopover
				anchorRef={anchorRef}
				open={open && content !== null}
				onClose={close}
				width={320}
				maxHeight={440}
				zIndex={zIndex}
				ariaLabel={label}
			>
				{content}
			</AnchoredPopover>
		);
	}
	return (
		<AppDialog
			open={open && content !== null}
			onClose={close}
			busy={isPending}
			size="sm"
			hideCloseButton
			bare
			zIndex={zIndex}
		>
			{content}
		</AppDialog>
	);
}
