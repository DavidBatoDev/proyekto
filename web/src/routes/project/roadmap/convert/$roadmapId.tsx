import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { CheckCircle2, Loader2, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { getGuestSessionId } from "@/lib/guestAuth";
import {
	clearGuestRoadmapMetadata,
	clearPendingProjectFromRoadmap,
	getPendingProjectFromRoadmap,
} from "@/lib/guestRoadmapConversion";
import { projectService } from "@/services/project.service";
import { useAuthStore } from "@/stores/authStore";

export const Route = createFileRoute("/project/roadmap/convert/$roadmapId")({
	beforeLoad: ({ location }) => {
		const { isAuthenticated, isLoading } = useAuthStore.getState();
		if (!isLoading && !isAuthenticated) {
			throw redirect({
				to: "/auth/login",
				search: { redirect: location.href },
			});
		}
	},
	component: ConvertRoadmapToProjectPage,
});

const steps = [
	"Creating project",
	"Importing roadmap",
	"Preparing Kanban board",
	"Opening workspace",
];

type ConversionResult = Awaited<
	ReturnType<typeof projectService.createFromRoadmap>
>;

const inFlightConversions = new Map<string, Promise<ConversionResult>>();

function convertRoadmapOnce({
	roadmapId,
	guestSessionId,
}: {
	roadmapId: string;
	guestSessionId?: string | null;
}): Promise<ConversionResult> {
	const conversionKey = `${roadmapId}:${guestSessionId ?? ""}`;
	const existing = inFlightConversions.get(conversionKey);
	if (existing) return existing;

	const request = projectService
		.createFromRoadmap({
			roadmapId,
			guestSessionId: guestSessionId ?? undefined,
		})
		.finally(() => {
			inFlightConversions.delete(conversionKey);
		});

	inFlightConversions.set(conversionKey, request);
	return request;
}

function ConvertRoadmapToProjectPage() {
	const { roadmapId } = Route.useParams();
	const navigate = useNavigate();
	const [activeStep, setActiveStep] = useState(0);
	const [error, setError] = useState<string | null>(null);
	const pending = useMemo(() => getPendingProjectFromRoadmap(), []);

	useEffect(() => {
		let cancelled = false;
		const timers: number[] = [];

		const runConversion = async () => {
			try {
				timers.push(window.setTimeout(() => setActiveStep(1), 350));
				timers.push(window.setTimeout(() => setActiveStep(2), 900));

				const result = await convertRoadmapOnce({
					roadmapId,
					guestSessionId: pending?.guestSessionId ?? getGuestSessionId(),
				});

				if (cancelled) return;
				setActiveStep(3);
				clearPendingProjectFromRoadmap(roadmapId);
				clearGuestRoadmapMetadata(roadmapId);

				await navigate({
					to: "/project/$projectId/overview",
					params: { projectId: result.project.id },
					replace: true,
				});
			} catch (conversionError) {
				if (cancelled) return;
				console.error(
					"Failed to convert roadmap into project:",
					conversionError,
				);
				setError(
					conversionError instanceof Error
						? conversionError.message
						: "We couldn't create the project. Please try again.",
				);
			}
		};

		void runConversion();

		return () => {
			cancelled = true;
			for (const timer of timers) window.clearTimeout(timer);
		};
	}, [navigate, pending?.guestSessionId, roadmapId]);

	return (
		<main className="min-h-screen bg-[radial-gradient(circle_at_top_left,#dff7ec,transparent_34%),linear-gradient(135deg,#f8fafc,#eef6f1)] px-6 py-12 text-slate-950">
			<div className="mx-auto flex min-h-[70vh] max-w-2xl items-center justify-center">
				<section className="w-full overflow-hidden rounded-[2rem] border border-white/70 bg-white/85 p-8 shadow-[0_30px_100px_rgba(15,23,42,0.16)] backdrop-blur">
					<div className="mb-8 flex items-center gap-4">
						<div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500 text-white shadow-lg shadow-emerald-500/25">
							{error ? (
								<Sparkles className="h-7 w-7" />
							) : (
								<Loader2 className="h-7 w-7 animate-spin" />
							)}
						</div>
						<div>
							<p className="text-sm font-semibold uppercase tracking-[0.28em] text-emerald-700">
								Roadmap to project
							</p>
							<h1 className="mt-1 text-3xl font-black tracking-tight">
								{error ? "Conversion paused" : "Creating your project..."}
							</h1>
						</div>
					</div>

					{error ? (
						<div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-800">
							<p className="font-semibold">Something got tangled.</p>
							<p className="mt-1">{error}</p>
							<button
								type="button"
								onClick={() => window.location.reload()}
								className="mt-4 rounded-full bg-red-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-red-700"
							>
								Try again
							</button>
						</div>
					) : (
						<div className="space-y-3">
							{steps.map((step, index) => {
								const complete = index < activeStep;
								const current = index === activeStep;
								return (
									<div
										key={step}
										className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3"
									>
										<div
											className={`flex h-8 w-8 items-center justify-center rounded-full ${
												complete
													? "bg-emerald-500 text-white"
													: current
														? "bg-slate-950 text-white"
														: "bg-slate-100 text-slate-400"
											}`}
										>
											{complete ? (
												<CheckCircle2 className="h-5 w-5" />
											) : current ? (
												<Loader2 className="h-4 w-4 animate-spin" />
											) : (
												<span className="text-sm font-bold">{index + 1}</span>
											)}
										</div>
										<span className="font-semibold text-slate-800">{step}</span>
									</div>
								);
							})}
						</div>
					)}
				</section>
			</div>
		</main>
	);
}
