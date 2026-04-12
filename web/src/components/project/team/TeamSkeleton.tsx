export function TeamSkeleton() {
	const teamRowSkeleton = (key: string, isLast: boolean) => (
		<div
			key={key}
			className={`grid grid-cols-[2fr_1fr_1fr_48px_80px] gap-4 items-center px-4 py-3 ${
				!isLast ? "border-b border-slate-100" : ""
			}`}
		>
			<div className="flex items-center gap-2.5 min-w-0">
				<div className="w-8 h-8 rounded-full bg-slate-200 shrink-0" />
				<div className="space-y-1.5 min-w-0">
					<div className="h-3 w-28 rounded bg-slate-200" />
					<div className="h-2.5 w-36 rounded bg-slate-100" />
				</div>
			</div>
			<div className="h-3 w-20 rounded bg-slate-200" />
			<div className="flex items-center gap-1.5">
				<div className="w-2 h-2 rounded-full bg-slate-200" />
				<div className="h-2.5 w-12 rounded bg-slate-200" />
			</div>
			<div className="flex justify-center">
				<div className="h-7 w-7 rounded-lg bg-slate-100" />
			</div>
			<div className="flex justify-end gap-1">
				<div className="h-7 w-7 rounded-lg bg-slate-100" />
				<div className="h-7 w-7 rounded-lg bg-slate-100" />
			</div>
		</div>
	);

	return (
		<div className="app-shell-bg h-full overflow-y-auto">
			<div className="mx-auto w-full max-w-6xl animate-pulse space-y-6 px-5 py-6 md:px-8">
				<div className="app-surface-card p-4">
					<div className="inline-flex items-center gap-1 rounded-full bg-slate-100 p-1">
						<div className="h-8 w-20 rounded-full bg-slate-300" />
						<div className="h-8 w-36 rounded-full bg-slate-200" />
						<div className="h-8 w-36 rounded-full bg-slate-200" />
					</div>
				</div>

				<div className="app-surface-card flex items-center justify-between gap-4 p-5">
					<div className="flex items-center gap-3">
						<div className="h-10 w-56 rounded-lg border border-slate-200 bg-slate-100" />
						<div className="h-10 w-28 rounded-lg border border-slate-200 bg-slate-100" />
					</div>
					<div className="h-10 w-40 rounded-md bg-slate-200" />
				</div>

				<div className="app-surface-card p-4 md:p-5">
					<div className="mb-3 h-3 w-52 rounded bg-slate-200" />
					<div className="grid grid-cols-[2fr_1fr_1fr_48px_80px] gap-4 items-center px-4 mb-2">
						<div className="h-2.5 w-14 rounded bg-slate-200" />
						<div className="h-2.5 w-10 rounded bg-slate-200" />
						<div className="h-2.5 w-12 rounded bg-slate-200" />
						<div className="h-2.5 w-8 rounded bg-slate-200 justify-self-center" />
						<div className="h-2.5 w-12 rounded bg-slate-200 justify-self-end" />
					</div>
					<div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
						{teamRowSkeleton("principal-0", false)}
						{teamRowSkeleton("principal-1", true)}
					</div>
				</div>

				<div className="app-surface-card p-4 md:p-5">
					<div className="mb-3 h-3 w-16 rounded bg-slate-200" />
					<div className="grid grid-cols-[2fr_1fr_1fr_48px_80px] gap-4 items-center px-4 mb-2">
						<div className="h-2.5 w-14 rounded bg-slate-200" />
						<div className="h-2.5 w-10 rounded bg-slate-200" />
						<div className="h-2.5 w-12 rounded bg-slate-200" />
						<div className="h-2.5 w-8 rounded bg-slate-200 justify-self-center" />
						<div className="h-2.5 w-12 rounded bg-slate-200 justify-self-end" />
					</div>
					<div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
						{teamRowSkeleton("member-0", false)}
						{teamRowSkeleton("member-1", false)}
						{teamRowSkeleton("member-2", true)}
					</div>
				</div>

				<div className="app-surface-card p-4 md:p-5">
					<div className="mb-3 h-3 w-24 rounded bg-slate-200" />
					<div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
						<div className="h-3.5 w-24 rounded bg-slate-200" />
						<div className="h-8 w-36 rounded-full bg-slate-100" />
					</div>
				</div>
			</div>
		</div>
	);
}
