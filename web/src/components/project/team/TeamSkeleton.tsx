/**
 * Skeleton for the Team page while data is loading. Matches the new
 * layout — header line + 1–2 section cards each with a few rows.
 */
export function TeamSkeleton() {
	return (
		<div className="animate-pulse space-y-6">
			<div className="flex items-end justify-between gap-3">
				<div>
					<div className="h-3 w-12 rounded bg-slate-200" />
					<div className="mt-2 h-6 w-44 rounded bg-slate-200" />
					<div className="mt-2 h-3 w-72 rounded bg-slate-100" />
				</div>
				<div className="flex gap-2">
					<div className="h-9 w-32 rounded-lg bg-slate-200" />
					<div className="h-9 w-32 rounded-lg bg-slate-100" />
				</div>
			</div>
			<SectionCardSkeleton rows={2} />
			<SectionCardSkeleton rows={3} />
		</div>
	);
}

function SectionCardSkeleton({ rows }: { rows: number }) {
	return (
		<div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
			<div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50/60 px-5 py-3">
				<div className="flex items-center gap-2">
					<div className="h-4 w-4 rounded bg-slate-200" />
					<div className="h-6 w-6 rounded-md bg-slate-200" />
					<div className="h-3 w-32 rounded bg-slate-200" />
				</div>
				<div className="h-7 w-24 rounded-lg bg-slate-100" />
			</div>
			<ul className="divide-y divide-slate-200">
				{Array.from({ length: rows }).map((_, i) => (
					<li key={i} className="flex items-center justify-between px-5 py-3">
						<div className="flex min-w-0 items-center gap-3">
							<div className="h-9 w-9 shrink-0 rounded-full bg-slate-200" />
							<div className="space-y-2">
								<div className="h-3 w-32 rounded bg-slate-200" />
								<div className="flex gap-1.5">
									<div className="h-4 w-20 rounded-full bg-slate-100" />
									<div className="h-4 w-14 rounded-full bg-slate-100" />
								</div>
							</div>
						</div>
						<div className="flex gap-1">
							<div className="h-8 w-8 rounded-lg bg-slate-100" />
							<div className="h-8 w-8 rounded-lg bg-slate-100" />
						</div>
					</li>
				))}
			</ul>
		</div>
	);
}
