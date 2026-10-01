import { Loader2, Plus, X } from "lucide-react";
import { useState } from "react";
import { withTradingName } from "@/components/intake/intakeHints";

/** Mirrors TEAM_TRADING_NAME_MAX_* on the backend; the server is the authority. */
export const TRADING_NAME_MAX_COUNT = 10;
export const TRADING_NAME_MAX_LENGTH = 120;

/**
 * Team settings -> Trading names. Other names the team appears under on paper
 * ("PRODIGITALITY" for JC Studio). Document intake treats each as the team.
 * Owner-only: a trading name is identity, like the billing block.
 */
export function TradingNamesSection({
	teamName,
	names,
	canEdit,
	saving,
	onSave,
}: {
	teamName: string;
	names: string[];
	canEdit: boolean;
	saving: boolean;
	onSave: (names: string[]) => Promise<unknown>;
}) {
	const [draft, setDraft] = useState("");
	const atCap = names.length >= TRADING_NAME_MAX_COUNT;

	const add = async () => {
		const next = withTradingName(names, draft);
		if (next === names) {
			setDraft("");
			return;
		}
		try {
			await onSave(next);
			setDraft("");
		} catch {
			// The caller's mutation already surfaced the error.
		}
	};

	const remove = (name: string) => {
		void onSave(names.filter((item) => item !== name)).catch(() => undefined);
	};

	return (
		<section className="space-y-3">
			<div>
				<h3 className="text-[18px] font-semibold text-foreground">
					Trading names
				</h3>
				<p className="text-[13px] leading-6 text-muted-foreground">
					Other names {teamName} appears under on contracts and invoices. When
					you import documents, any of these counts as {teamName}.
				</p>
			</div>

			{names.length > 0 ? (
				<ul className="flex flex-wrap gap-1.5" aria-label="Trading names">
					{names.map((name) => (
						<li
							key={name}
							className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs text-foreground"
						>
							{name}
							{canEdit && (
								<button
									type="button"
									aria-label={`Remove ${name}`}
									disabled={saving}
									onClick={() => remove(name)}
									className="rounded-full p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
								>
									<X className="h-3 w-3" />
								</button>
							)}
						</li>
					))}
				</ul>
			) : (
				<p className="text-[13px] leading-6 text-muted-foreground">
					No trading names added yet.
				</p>
			)}

			{canEdit && (
				<form
					className="flex items-center gap-2"
					onSubmit={(event) => {
						event.preventDefault();
						void add();
					}}
				>
					<input
						type="text"
						value={draft}
						maxLength={TRADING_NAME_MAX_LENGTH}
						disabled={saving || atCap}
						onChange={(event) => setDraft(event.target.value)}
						placeholder={
							atCap
								? `Up to ${TRADING_NAME_MAX_COUNT} trading names`
								: "e.g. PRODIGITALITY"
						}
						aria-label="Add a trading name"
						className="w-full max-w-sm rounded-lg border border-border px-3 py-2 text-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30 disabled:opacity-60"
					/>
					<button
						type="submit"
						disabled={saving || atCap || !draft.trim()}
						className="app-cta inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
					>
						{saving ? (
							<Loader2 className="h-4 w-4 animate-spin" />
						) : (
							<Plus className="h-4 w-4" />
						)}
						Add
					</button>
				</form>
			)}
		</section>
	);
}
