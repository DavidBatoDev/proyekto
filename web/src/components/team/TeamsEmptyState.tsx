import { Plus } from "lucide-react";
import { PlusBadge } from "@/components/common/illustrationPrimitives";

export function TeamsEmptyState({ onCreate }: { onCreate: () => void }) {
	return (
		<section className="flex min-h-[420px] flex-col items-center justify-center px-4 py-12 text-center sm:py-16">
			<svg
				viewBox="0 0 320 200"
				fill="none"
				aria-hidden="true"
				focusable="false"
				className="mb-6 h-auto w-64 max-w-full sm:w-72"
			>
				<ellipse
					cx="160"
					cy="100"
					rx="116"
					ry="88"
					className="fill-primary/5"
				/>
				<circle cx="50" cy="55" r="4" className="fill-primary/20" />
				<circle cx="273" cy="132" r="5" className="fill-primary/15" />
				<path
					d="M63 133v8m-4-4h8M258 43v8m-4-4h8"
					className="stroke-primary/30"
					strokeWidth="2"
					strokeLinecap="round"
				/>
				<path
					d="M93 97v28q0 12 12 12h110q12 0 12-12V97M160 101v36"
					className="stroke-primary/35"
					strokeWidth="2"
					strokeDasharray="4 5"
					strokeLinecap="round"
				/>
				{[93, 160, 227].map((x, index) => (
					<g key={x} transform={`translate(${x} ${index === 1 ? 57 : 76})`}>
						<circle
							r="29"
							className="fill-background stroke-border"
							strokeWidth="2"
						/>
						<circle
							r="24"
							className={index === 1 ? "fill-primary" : "fill-muted"}
						/>
						<circle
							cy="-6"
							r="7"
							className={
								index === 1
									? "fill-primary-foreground"
									: "fill-muted-foreground/60"
							}
						/>
						<path
							d="M-13 14a13 13 0 0 1 26 0"
							className={
								index === 1
									? "fill-primary-foreground"
									: "fill-muted-foreground/60"
							}
						/>
					</g>
				))}
				<rect
					x="114"
					y="124"
					width="92"
					height="54"
					rx="12"
					className="fill-card stroke-border"
					strokeWidth="1.5"
				/>
				<rect
					x="126"
					y="137"
					width="16"
					height="16"
					rx="4"
					className="fill-primary/15"
				/>
				<path
					d="m130 145 3 3 5-6"
					className="stroke-primary"
					strokeWidth="2"
					strokeLinecap="round"
					strokeLinejoin="round"
				/>
				<rect
					x="150"
					y="139"
					width="42"
					height="4"
					rx="2"
					className="fill-muted-foreground/40"
				/>
				<rect
					x="150"
					y="148"
					width="28"
					height="3"
					rx="1.5"
					className="fill-muted-foreground/20"
				/>
				<rect
					x="126"
					y="161"
					width="66"
					height="4"
					rx="2"
					className="fill-primary/20"
				/>
				<g transform="translate(213 46) scale(1.8)">
					<PlusBadge cx={0} cy={0} />
				</g>
			</svg>
			<h2 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
				Great work starts with a team
			</h2>
			<p className="mt-3 max-w-md text-sm leading-6 text-muted-foreground">
				Bring your people together. Create a team, invite members, and choose
				who joins each project.
			</p>
			<button
				type="button"
				onClick={onCreate}
				className="mt-6 inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
			>
				<Plus className="h-4 w-4" aria-hidden="true" />
				Create team
			</button>
		</section>
	);
}
