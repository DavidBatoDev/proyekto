const LEFT_PANEL_WIDTH = 320;

/** Indent + title width per placeholder row, to read as an epic/feature tree. */
const MOBILE_ROWS: { depth: 0 | 1; width: string }[] = [
	{ depth: 0, width: "68%" },
	{ depth: 1, width: "80%" },
	{ depth: 1, width: "62%" },
	{ depth: 0, width: "54%" },
	{ depth: 1, width: "74%" },
	{ depth: 1, width: "58%" },
	{ depth: 1, width: "70%" },
	{ depth: 0, width: "60%" },
	{ depth: 1, width: "66%" },
];

/**
 * Phone-sized placeholder, matching what actually loads on mobile:
 * `MobileRoadmapView`'s slim header over a vertical tree — never the desktop
 * three-column layout. Before this, the skeleton rendered its fixed 320px left
 * panel at every width, so on a 390px phone the "sidebar" was the entire page
 * and the loading state promised a layout that never arrived.
 */
function MobileRoadmapSkeleton() {
	return (
		<div className="flex h-full flex-col md:hidden">
			<div className="flex shrink-0 items-center gap-2 border-b border-border bg-card px-3 py-2.5">
				<div className="h-5 min-w-0 flex-1 rounded-md bg-muted" />
				<div className="h-9 w-9 shrink-0 rounded-lg bg-muted" />
				<div className="h-9 w-9 shrink-0 rounded-lg bg-muted" />
			</div>

			<div className="min-h-0 flex-1 space-y-3.5 overflow-hidden bg-card px-3 py-4">
				<div className="h-9 w-full rounded-lg bg-muted" />
				{MOBILE_ROWS.map((row, index) => (
					<div
						key={`${row.depth}-${row.width}-${index}`}
						className="flex items-center gap-2.5"
						style={{ paddingLeft: row.depth * 18 }}
					>
						<div className="h-4 w-4 shrink-0 rounded bg-muted" />
						<div
							className={`h-3.5 rounded ${
								row.depth === 0 ? "bg-muted" : "bg-muted/50"
							}`}
							style={{ width: row.width }}
						/>
					</div>
				))}
			</div>
		</div>
	);
}

interface RoadmapPageSkeletonProps {
	showLeftPanel?: boolean;
}

export function RoadmapPageSkeleton({
	showLeftPanel = true,
}: RoadmapPageSkeletonProps) {
	return (
		<div className="flex flex-col h-full app-shell-bg overflow-hidden animate-pulse">
			<MobileRoadmapSkeleton />

			<div className="hidden bg-card border-b border-border md:flex items-center justify-between w-full shrink-0 z-10 overflow-hidden">
				<div className="flex items-center flex-1 h-full">
					<div
						className="flex items-center gap-3 px-4 py-3 shrink-0"
						style={{ width: LEFT_PANEL_WIDTH }}
					>
						<div className="h-7 w-28 bg-muted rounded-md" />
						<div className="h-7 w-24 bg-muted rounded-md" />
					</div>
					<div className="h-8 w-px bg-border shrink-0" />
					<div className="flex items-center gap-2 px-4 py-2">
						<div className="h-6 w-28 bg-muted rounded-md" />
						<div className="h-6 w-24 bg-muted rounded-md" />
						<div className="h-6 w-20 bg-muted rounded-md" />
					</div>
				</div>

				<div className="flex items-center gap-2 px-6 py-2 border-l border-border bg-card shrink-0">
					<div className="h-8 w-20 bg-muted rounded-md" />
					<div className="h-8 w-24 bg-muted rounded-md" />
				</div>
			</div>

			<div className="hidden flex-1 md:flex overflow-hidden">
				{showLeftPanel && (
					<div
						className="relative h-full border-r border-border bg-card shrink-0"
						style={{ width: LEFT_PANEL_WIDTH, minWidth: LEFT_PANEL_WIDTH }}
					>
						<div className="px-4 py-4 space-y-4">
							<div className="h-9 w-full bg-muted rounded-lg" />
							<div className="h-4 w-20 bg-muted rounded" />

							<div className="space-y-3">
								<div className="space-y-2">
									<div className="h-4 w-[92%] bg-muted rounded" />
									<div className="h-3 w-[80%] bg-muted/50 rounded" />
									<div className="h-3 w-[70%] bg-muted/50 rounded" />
								</div>
								<div className="space-y-2">
									<div className="h-4 w-[88%] bg-muted rounded" />
									<div className="h-3 w-[76%] bg-muted/50 rounded" />
								</div>
							</div>

							<div className="h-4 w-24 bg-muted rounded" />
							<div className="space-y-2">
								<div className="h-3 w-[90%] bg-muted/50 rounded" />
								<div className="h-3 w-[72%] bg-muted/50 rounded" />
								<div className="h-3 w-[84%] bg-muted/50 rounded" />
							</div>
						</div>
					</div>
				)}

				<div className="flex-1 bg-background p-6 overflow-hidden">
					<div className="h-full relative min-w-[960px]">
						<div className="absolute left-[3%] top-[16%] w-[31%] h-[34%] rounded-3xl border border-border bg-card p-5">
							<div className="h-5 w-[70%] bg-muted rounded mb-3" />
							<div className="h-3 w-[90%] bg-muted/50 rounded mb-2" />
							<div className="h-3 w-[84%] bg-muted/50 rounded mb-2" />
							<div className="h-3 w-[76%] bg-muted/50 rounded mb-5" />
							<div className="h-3 w-20 bg-muted rounded mb-2" />
							<div className="h-3 w-36 bg-muted/50 rounded" />
						</div>

						<div className="absolute left-[42%] top-[10%] w-[30%] h-[27%] rounded-3xl border border-border bg-card p-5">
							<div className="h-5 w-[60%] bg-muted rounded mb-3" />
							<div className="h-3 w-[86%] bg-muted/50 rounded mb-2" />
							<div className="h-3 w-[72%] bg-muted/50 rounded mb-4" />
							<div className="h-2 w-full bg-muted/50 rounded mb-3" />
							<div className="h-3 w-28 bg-muted/50 rounded" />
						</div>

						<div className="absolute left-[42%] top-[43%] w-[30%] h-[27%] rounded-3xl border border-border bg-card p-5">
							<div className="h-5 w-[65%] bg-muted rounded mb-3" />
							<div className="h-3 w-[80%] bg-muted/50 rounded mb-2" />
							<div className="h-3 w-[68%] bg-muted/50 rounded mb-4" />
							<div className="h-2 w-full bg-muted/50 rounded mb-3" />
							<div className="h-3 w-24 bg-muted/50 rounded" />
						</div>

						<div className="absolute left-[76%] top-[16%] w-[21%] h-[16%] rounded-2xl border border-border bg-card p-3">
							<div className="grid grid-cols-2 gap-2">
								<div className="h-4 bg-primary/20 rounded" />
								<div className="h-4 bg-primary/20 rounded" />
								<div className="h-4 bg-primary/20 rounded" />
								<div className="h-4 bg-primary/20 rounded" />
								<div className="h-4 bg-primary/20 rounded" />
								<div className="h-4 bg-primary/20 rounded" />
							</div>
						</div>

						<div className="absolute left-[76%] top-[46%] w-[21%] h-[16%] rounded-2xl border border-border bg-card p-3">
							<div className="grid grid-cols-2 gap-2">
								<div className="h-4 bg-primary/20 rounded" />
								<div className="h-4 bg-primary/20 rounded" />
								<div className="h-4 bg-primary/20 rounded" />
								<div className="h-4 bg-primary/20 rounded" />
								<div className="h-4 bg-primary/20 rounded" />
								<div className="h-4 bg-primary/20 rounded" />
							</div>
						</div>

						<div className="absolute left-[34%] top-[30%] w-[8%] h-0.5 bg-border rounded" />
						<div className="absolute left-[34%] top-[39%] w-[8%] h-0.5 bg-border rounded" />
						<div className="absolute left-[72%] top-[23%] w-[4%] h-0.5 bg-primary/40 rounded" />
						<div className="absolute left-[72%] top-[53%] w-[4%] h-0.5 bg-primary/40 rounded" />
						<div className="absolute left-[28%] top-[50%] w-0.5 h-[32%] border-l-2 border-dashed border-border" />
					</div>
				</div>
			</div>
		</div>
	);
}
