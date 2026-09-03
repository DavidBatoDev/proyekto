import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { type ReactNode, useState } from "react";
import { AppDialog } from "@/components/common/AppDialog";
import { invalidateDashboardRoadmaps } from "@/hooks/dashboardInvalidation";
import {
	createRoadmapFromMetadata,
	DEFAULT_ROADMAP_CATEGORY,
	DEFAULT_ROADMAP_NAME,
} from "@/lib/roadmapCreationFlow";
import { cn } from "@/lib/utils";
import { useUser } from "@/stores/authStore";
import {
	AiRoadmapIllustration,
	BlankRoadmapIllustration,
	TemplateRoadmapIllustration,
} from "./roadmapStartIllustrations";

/**
 * The three ways into a new roadmap.
 *
 * Every "Create roadmap" button used to go straight to the template
 * marketplace, which quietly decided for the author that browsing was the way
 * they wanted to start. It is one of three, and the other two were only
 * reachable by knowing a URL: the guided AI intake at
 * `/project/n/roadmap/create`, and a blank canvas, which nothing offered at all.
 *
 * Laid out as the marketplace survey's intent step is — three illustrated
 * cards side by side — because it is the same kind of question. Three answers
 * that are peers, being compared against each other, and side by side is how
 * you compare.
 *
 * Only the blank option writes a row here. The other two hand off to surfaces
 * that create the roadmap at the end of their own flow.
 */

type RoadmapStartDialogProps = {
	open: boolean;
	onClose: () => void;
	/** `"n"` — the sentinel for a roadmap that belongs to no project yet. */
	projectId?: string;
};

export function RoadmapStartDialog({
	open,
	onClose,
	projectId = "n",
}: RoadmapStartDialogProps) {
	const [isCreating, setIsCreating] = useState(false);

	return (
		<AppDialog
			open={open}
			onClose={onClose}
			title="How do you want to start?"
			description="Every route ends at the same canvas — pick the one that matches how much you already know."
			size="lg"
			busy={isCreating}
		>
			<RoadmapStartOptions
				projectId={projectId}
				onBeforeNavigate={onClose}
				onBusyChange={setIsCreating}
			/>
		</AppDialog>
	);
}

/**
 * The three routes as a row of cards, without the dialog around them.
 *
 * Rendered inside `RoadmapStartDialog` when a "Create roadmap" button is
 * pressed, and inline on the dashboard when the account has nothing on it yet
 * — a new account should meet the three doors directly rather than a page of
 * empty sections with the doors hidden behind a button.
 */
export function RoadmapStartOptions({
	projectId = "n",
	onBeforeNavigate,
	onBusyChange,
}: {
	/** `"n"` — the sentinel for a roadmap that belongs to no project yet. */
	projectId?: string;
	/** Runs before any navigation — closes the dialog when there is one. */
	onBeforeNavigate?: () => void;
	onBusyChange?: (busy: boolean) => void;
}) {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const user = useUser();
	const [isCreating, setIsCreating] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const setBusy = (busy: boolean) => {
		setIsCreating(busy);
		onBusyChange?.(busy);
	};

	const handleStartBlank = async () => {
		if (isCreating) return;
		setError(null);
		setBusy(true);

		try {
			const roadmap = await createRoadmapFromMetadata({
				metadata: {
					name: DEFAULT_ROADMAP_NAME,
					description: "",
					category: DEFAULT_ROADMAP_CATEGORY,
				},
				// No prompt: nothing is queued for the agent, so the author lands on
				// an empty canvas instead of watching epics appear that they did not
				// ask for.
				prompt: "",
				projectId,
				isAuthenticated: Boolean(user),
				// "New Roadmap" is a placeholder, not a name. Opening the details
				// panel on arrival is the difference between a roadmap the author
				// names and one that keeps the placeholder forever.
				openMetadataModal: true,
			});

			void invalidateDashboardRoadmaps(queryClient);
			await navigate({
				to: "/project/$projectId/roadmap/$roadmapId",
				params: { projectId, roadmapId: roadmap.id },
			});
		} catch (createError) {
			console.error("Failed to start a blank roadmap:", createError);
			setError("We could not create the roadmap. Please try again.");
			setBusy(false);
		}
	};

	return (
		<>
			<div className="grid gap-3 sm:grid-cols-3">
				<StartCard
					label="Start a roadmap with the help of AI"
					description="Describe what you are building and we draft the epics, features, and tasks."
					illustration={<AiRoadmapIllustration className="h-24 w-24" />}
					disabled={isCreating}
					onClick={() => {
						onBeforeNavigate?.();
						void navigate({
							to: "/project/$projectId/roadmap/create",
							params: { projectId },
							search: { draftId: undefined },
						});
					}}
				/>

				<StartCard
					label="Start the roadmap immediately"
					description="Open a blank canvas and build it yourself. The AI is still there if you want it."
					illustration={<BlankRoadmapIllustration className="h-24 w-24" />}
					disabled={isCreating}
					busy={isCreating}
					onClick={() => {
						void handleStartBlank();
					}}
				/>

				<StartCard
					label="Browse popular roadmaps"
					description="Pick a template someone has already proven, then make it yours."
					illustration={<TemplateRoadmapIllustration className="h-24 w-24" />}
					disabled={isCreating}
					onClick={() => {
						onBeforeNavigate?.();
						void navigate({ to: "/roadmap-templates" });
					}}
				/>
			</div>

			{error && (
				<p role="alert" className="mt-4 text-sm text-destructive">
					{error}
				</p>
			)}
		</>
	);
}

/**
 * One route, as a card.
 *
 * `aria-label` is set explicitly rather than left to name-from-contents: the
 * label sits two spans deep beside a decorative illustration, which is the
 * same reason the survey's cards name themselves.
 */
function StartCard({
	label,
	description,
	illustration,
	onClick,
	disabled,
	busy = false,
}: {
	label: string;
	description: string;
	illustration: ReactNode;
	onClick: () => void;
	disabled?: boolean;
	busy?: boolean;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			aria-label={label}
			aria-busy={busy || undefined}
			className={cn(
				"group relative flex h-full flex-col items-center gap-3 rounded-2xl border border-border p-4 text-center transition-colors",
				"hover:border-primary/50 hover:bg-muted/40",
				"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background",
				"disabled:cursor-not-allowed",
				// Only the card being acted on keeps full contrast; the other two
				// dim, so the spinner reads as "this one is working" rather than
				// "everything broke".
				disabled && !busy && "opacity-50",
			)}
		>
			<span className="relative">
				{illustration}
				{busy && (
					<span className="absolute inset-0 flex items-center justify-center rounded-xl bg-background/70">
						<Loader2 className="h-6 w-6 animate-spin text-primary" />
					</span>
				)}
			</span>

			<span className="min-w-0">
				<span className="block text-sm font-semibold text-foreground">
					{label}
				</span>
				<span className="mt-1 block text-[13px] leading-snug text-muted-foreground">
					{description}
				</span>
			</span>
		</button>
	);
}

/**
 * A "create roadmap" button that asks how, instead of answering for the author.
 *
 * Each call site keeps its own styling — the dashboard has a pill, the grid
 * header has a solid button, the empty state has a dark capsule — so the only
 * thing shared here is the behaviour.
 */
export function RoadmapStartTrigger({
	className,
	children,
	hierarchyLevel,
	projectId,
}: {
	className?: string;
	children: ReactNode;
	hierarchyLevel?: string;
	projectId?: string;
}) {
	const [open, setOpen] = useState(false);

	return (
		<>
			<button
				type="button"
				onClick={() => setOpen(true)}
				data-hierarchy-level={hierarchyLevel}
				className={className}
			>
				{children}
			</button>
			<RoadmapStartDialog
				open={open}
				onClose={() => setOpen(false)}
				projectId={projectId}
			/>
		</>
	);
}
