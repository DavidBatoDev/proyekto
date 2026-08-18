import { CircleCheck, CircleDashed, Gavel } from "lucide-react";
import { useState } from "react";
import { AppDialog } from "@/components/common/AppDialog";
import type { Decision } from "@/services/delivery.service";
import { PrimaryButton, SecondaryButton } from "./DeliveryPrimitives";

/**
 * Asked when a decision that listed options is about to be settled without one
 * of them being marked.
 *
 * The gap it closes: the log would otherwise record what was weighed but never
 * what won, and "why didn't we use the other one?" is exactly the question the
 * options were captured to answer.
 *
 * Not a hard requirement. Options are sometimes context rather than a shortlist,
 * so "Settle it without choosing" is always available — it just stops being the
 * silent default.
 */
export function FinalizeDecisionModal({
	isOpen,
	decision,
	pending,
	onClose,
	onConfirm,
}: {
	isOpen: boolean;
	decision: Decision;
	pending: boolean;
	onClose: () => void;
	/** `null` settles the decision without marking any option. */
	onConfirm: (optionId: string | null) => void;
}) {
	const [picked, setPicked] = useState<string | null>(null);
	const options = decision.options ?? [];

	const close = () => {
		setPicked(null);
		onClose();
	};

	return (
		<AppDialog
			open={isOpen}
			onClose={close}
			busy={pending}
			title="Which option did you go with?"
			description={decision.title}
			footer={
				<>
					<SecondaryButton onClick={close} disabled={pending}>
						Cancel
					</SecondaryButton>
					<PrimaryButton
						onClick={() => onConfirm(picked)}
						disabled={!picked}
						loading={pending}
					>
						<Gavel className="h-4 w-4" />
						Mark final
					</PrimaryButton>
				</>
			}
		>
			<p className="mb-3 text-sm text-muted-foreground">
				This decision weighed {options.length} option
				{options.length === 1 ? "" : "s"} but never recorded which one won.
			</p>

			<ul className="overflow-hidden rounded-lg border border-border">
				{options.map((option) => {
					const chosen = picked === option.id;
					return (
						<li
							key={option.id}
							className="border-b border-border/60 last:border-b-0"
						>
							<button
								type="button"
								onClick={() => setPicked(option.id)}
								aria-pressed={chosen}
								className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors ${
									chosen ? "bg-success/5" : "hover:bg-muted/40"
								}`}
							>
								{chosen ? (
									<CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" />
								) : (
									<CircleDashed className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
								)}
								<span className="min-w-0">
									<span
										className={`block text-sm ${
											chosen
												? "font-semibold text-foreground"
												: "text-foreground"
										}`}
									>
										{option.title}
									</span>
									{option.detail && (
										<span className="mt-0.5 block text-xs text-muted-foreground">
											{option.detail}
										</span>
									)}
								</span>
							</button>
						</li>
					);
				})}
			</ul>

			<button
				type="button"
				onClick={() => onConfirm(null)}
				disabled={pending}
				className="mt-3 text-xs font-semibold text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline disabled:opacity-50"
			>
				These were context, not a shortlist — settle it without choosing
			</button>
		</AppDialog>
	);
}
