const LEFT_PANEL_WIDTH = 320;

interface RoadmapPageSkeletonProps {
	showLeftPanel?: boolean;
}

export function RoadmapPageSkeleton({
	showLeftPanel = true,
}: RoadmapPageSkeletonProps) {
	return (
		<div className="flex flex-col h-full app-shell-bg overflow-hidden animate-pulse">
			<div className="bg-card border-b border-border flex items-center justify-between w-full shrink-0 z-10 overflow-hidden">
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

			<div className="flex-1 flex overflow-hidden">
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
