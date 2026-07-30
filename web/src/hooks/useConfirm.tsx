import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useMemo,
	useState,
} from "react";
import {
	AppConfirmDialog,
	type ConfirmTone,
} from "@/components/common/AppConfirmDialog";

/**
 * Promise-based confirmation, so replacing a native `confirm()` is a one-liner:
 *
 *   if (!(await confirm({ title: "Detach team?", tone: "danger" }))) return;
 *
 * A declarative `<ConfirmDialog open={...}>` would force every one of the
 * existing call sites — all of them synchronous checks inside event handlers —
 * to hoist state and split the handler in two. This keeps the control flow
 * exactly as it reads today, just styled and accessible.
 *
 * One dialog instance lives at the provider, so nested or rapid confirms can't
 * stack up.
 */

export interface ConfirmOptions {
	title: string;
	message?: ReactNode;
	confirmLabel?: string;
	cancelLabel?: string;
	tone?: ConfirmTone;
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

interface PendingConfirm {
	options: ConfirmOptions;
	resolve: (value: boolean) => void;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
	const [pending, setPending] = useState<PendingConfirm | null>(null);

	const confirm = useCallback<ConfirmFn>(
		(options) =>
			new Promise<boolean>((resolve) => {
				setPending((current) => {
					// A second confirm while one is open would otherwise leave the
					// first promise unresolved forever.
					current?.resolve(false);
					return { options, resolve };
				});
			}),
		[],
	);

	const settle = useCallback(
		(value: boolean) => {
			pending?.resolve(value);
			setPending(null);
		},
		[pending],
	);

	const value = useMemo(() => confirm, [confirm]);

	return (
		<ConfirmContext.Provider value={value}>
			{children}
			<AppConfirmDialog
				open={pending !== null}
				title={pending?.options.title ?? ""}
				message={pending?.options.message}
				confirmLabel={pending?.options.confirmLabel}
				cancelLabel={pending?.options.cancelLabel}
				tone={pending?.options.tone}
				onConfirm={() => settle(true)}
				onClose={() => settle(false)}
			/>
		</ConfirmContext.Provider>
	);
}

export function useConfirm(): ConfirmFn {
	const ctx = useContext(ConfirmContext);
	if (!ctx) {
		throw new Error("useConfirm must be used within a ConfirmProvider");
	}
	return ctx;
}
