import { useMemo, useState } from "react";
import { AppDialog } from "@/components/common/AppDialog";
import { PERMISSION_SECTIONS } from "@/components/project/permissions/permissionCatalog";

/**
 * "What do these access levels mean?" — the permission reference.
 *
 * Was a fourth tab on the Team page, which put a glossary at the same level of
 * navigation as the roster itself. It is a dialog now: reachable when you're
 * confused, invisible when you're not.
 */
export function PermissionCatalogDialog({ onClose }: { onClose: () => void }) {
	const [query, setQuery] = useState("");

	const sections = useMemo(() => {
		const q = query.trim().toLowerCase();
		if (!q) return PERMISSION_SECTIONS;
		return PERMISSION_SECTIONS.map((section) => ({
			...section,
			permissions: section.permissions.filter((perm) =>
				`${perm.label} ${perm.description} ${perm.path}`
					.toLowerCase()
					.includes(q),
			),
		})).filter((section) => section.permissions.length > 0);
	}, [query]);

	const total = PERMISSION_SECTIONS.reduce(
		(sum, s) => sum + s.permissions.length,
		0,
	);
	const shown = sections.reduce((sum, s) => sum + s.permissions.length, 0);

	return (
		<AppDialog
			open
			onClose={onClose}
			size="xl"
			title="What each permission means"
			description="Reference only — nothing here changes anyone's access."
			footer={
				<button
					type="button"
					onClick={onClose}
					className="rounded-lg border border-border px-4 py-2 text-sm text-foreground transition hover:bg-muted"
				>
					Close
				</button>
			}
		>
			<div className="space-y-4">
				<div className="flex items-center gap-3">
					<input
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						placeholder="Search permissions…"
						aria-label="Search permissions"
						className="w-full rounded-lg border border-input bg-card px-3 py-2 text-sm text-card-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/25"
					/>
					<span className="shrink-0 text-xs text-muted-foreground">
						{shown} of {total}
					</span>
				</div>

				{sections.map((section) => (
					<section key={section.key}>
						<h3 className="text-sm font-semibold text-foreground">
							{section.label}
						</h3>
						<p className="mb-2 text-xs text-muted-foreground">
							{section.description}
						</p>
						<div className="divide-y divide-border overflow-hidden rounded-xl border border-border">
							{section.permissions.map((perm) => (
								<div key={perm.path} className="px-3 py-2">
									<p className="text-xs font-medium text-foreground">
										{perm.label}
									</p>
									<p className="mt-0.5 text-[11px] text-muted-foreground">
										{perm.description}
									</p>
									{perm.requires && (
										<p className="mt-1 text-[11px] text-muted-foreground">
											Needs{" "}
											<code className="rounded bg-muted px-1 py-0.5">
												{perm.requires}
											</code>{" "}
											first.
										</p>
									)}
								</div>
							))}
						</div>
					</section>
				))}

				{sections.length === 0 && (
					<p className="py-8 text-center text-sm text-muted-foreground">
						No permissions match "{query}".
					</p>
				)}
			</div>
		</AppDialog>
	);
}
