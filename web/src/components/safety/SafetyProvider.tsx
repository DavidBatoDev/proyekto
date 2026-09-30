import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useMemo,
	useState,
} from "react";
import { useConfirm } from "@/hooks/useConfirm";
import { useToast } from "@/hooks/useToast";
import {
	type PersonRef,
	useBlockedPeople,
	useBlockMutations,
} from "@/queries/safety";
import { useAuthStore } from "@/stores/authStore";
import { BlockConfirmDialog } from "./BlockConfirmDialog";
import { ReportSheet, type ReportTarget } from "./ReportSheet";
import { firstName } from "./safetyCopy";

interface SafetyActions {
	/** Open the report sheet for a message, comment or person. */
	report: (target: ReportTarget) => void;
	/** Confirm, then block. */
	block: (person: PersonRef) => void;
	/** Confirm, then unblock. */
	unblock: (person: PersonRef) => Promise<void>;
	isBlocked: (userId: string | null | undefined) => boolean;
	blockedIds: ReadonlySet<string>;
	/** False for yourself and signed-out viewers: nothing to report or block. */
	canActOn: (userId: string | null | undefined) => boolean;
}

const SafetyContext = createContext<SafetyActions | null>(null);

/**
 * One report sheet and one block dialog for the whole app (App Store guideline
 * 1.2). Any surface — chat, comments, profiles — calls `useSafety()` instead of
 * hosting its own dialogs and state.
 */
export function SafetyProvider({ children }: { children: ReactNode }) {
	const userId = useAuthStore((state) => state.user?.id ?? null);
	const { blockedIds } = useBlockedPeople();
	const { block: blockMutation, unblock: unblockMutation } =
		useBlockMutations();
	const confirm = useConfirm();
	const toast = useToast();

	const [reportTarget, setReportTarget] = useState<ReportTarget | null>(null);
	const [blockTarget, setBlockTarget] = useState<PersonRef | null>(null);

	const isBlocked = useCallback(
		(id: string | null | undefined) => Boolean(id && blockedIds.has(id)),
		[blockedIds],
	);
	const canActOn = useCallback(
		(id: string | null | undefined) => Boolean(userId && id && id !== userId),
		[userId],
	);

	const unblock = useCallback(
		async (person: PersonRef) => {
			const ok = await confirm({
				title: `Unblock ${person.name}?`,
				message: `${firstName(person.name)} will be able to message you again, and you'll see their messages and comments.`,
				confirmLabel: "Unblock",
			});
			if (!ok) return;
			try {
				await unblockMutation.mutateAsync(person);
				toast.success(`You unblocked ${person.name}`);
			} catch {
				toast.error("Couldn't unblock. Try again.");
			}
		},
		[confirm, toast, unblockMutation],
	);

	const confirmBlock = async () => {
		if (!blockTarget) return;
		const person = blockTarget;
		try {
			await blockMutation.mutateAsync(person);
			setBlockTarget(null);
			toast.success(`You blocked ${person.name}`);
		} catch {
			toast.error("Couldn't block. Try again.");
		}
	};

	const value = useMemo<SafetyActions>(
		() => ({
			report: setReportTarget,
			block: setBlockTarget,
			unblock,
			isBlocked,
			blockedIds,
			canActOn,
		}),
		[unblock, isBlocked, blockedIds, canActOn],
	);

	return (
		<SafetyContext.Provider value={value}>
			{children}
			<ReportSheet
				target={reportTarget}
				isAuthorBlocked={isBlocked(reportTarget?.author.id)}
				onClose={() => setReportTarget(null)}
			/>
			<BlockConfirmDialog
				person={blockTarget}
				busy={blockMutation.isPending}
				onConfirm={() => void confirmBlock()}
				onClose={() => setBlockTarget(null)}
			/>
		</SafetyContext.Provider>
	);
}

const NOOP: SafetyActions = {
	report: () => {},
	block: () => {},
	unblock: async () => {},
	isBlocked: () => false,
	blockedIds: new Set(),
	canActOn: () => false,
};

/**
 * Outside the provider (isolated tests, embeds) this degrades to "no safety
 * actions" rather than throwing, so a component never breaks for want of it.
 */
export function useSafety(): SafetyActions {
	return useContext(SafetyContext) ?? NOOP;
}
