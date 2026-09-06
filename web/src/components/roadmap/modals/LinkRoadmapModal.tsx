import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, Loader2, Map, X } from "lucide-react";
import { useEffect, useState } from "react";
import {
	getRoadmapsPreview,
	type RoadmapPreview,
} from "@/api/endpoints/roadmap";
import { ModalPortal } from "@/components/common/ModalPortal";
import { ProjectStatusBadge } from "@/components/common/SemanticBadge";
import { RoadmapPreviewCard } from "@/components/home/RoadmapPreviewCard";
import { roadmapService } from "@/services/roadmap.service";

interface LinkRoadmapModalProps {
	isOpen: boolean;
	onClose: () => void;
	projectId: string;
	onLinked: (linkedRoadmapId: string) => void;
	/**
	 * When provided, the modal uses the atomic replace-for-project flow:
	 * the picked roadmap is linked AND the current empty roadmap is
	 * deleted server-side in one call. Required when the project already
	 * has an auto-created empty roadmap attached.
	 */
	currentRoadmapId?: string;
}

export function LinkRoadmapModal({
	isOpen,
	onClose,
	projectId,
	onLinked,
	currentRoadmapId,
}: LinkRoadmapModalProps) {
	const [roadmaps, setRoadmaps] = useState<RoadmapPreview[]>([]);
	const [isLoading, setIsLoading] = useState(false);
	const [isLinking, setIsLinking] = useState(false);
	const [selectedRoadmapId, setSelectedRoadmapId] = useState<string | null>(
		null,
	);
	const [showConfirmInfo, setShowConfirmInfo] = useState(false);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		if (isOpen) {
			const loadRoadmaps = async () => {
				setIsLoading(true);
				setRoadmaps([]);
				setErrorMessage(null);
				try {
					const allRoadmaps = await getRoadmapsPreview();
					if (cancelled) return;
					// Filter roadmaps that are not linked to any project
					const unlinkedRoadmaps = allRoadmaps.filter((r) => !r.project_id);
					setRoadmaps(unlinkedRoadmaps);
				} catch (error) {
					if (cancelled) return;
					console.error("Failed to load roadmaps:", error);
					setErrorMessage(
						"Unable to load roadmaps. Close this dialog and try again.",
					);
				} finally {
					if (!cancelled) setIsLoading(false);
				}
			};
			loadRoadmaps();
		} else {
			setSelectedRoadmapId(null);
			setShowConfirmInfo(false);
			setErrorMessage(null);
		}
		return () => {
			cancelled = true;
		};
	}, [isOpen]);

	const handleLink = async () => {
		if (!selectedRoadmapId) return;

		setIsLinking(true);
		setErrorMessage(null);
		try {
			if (currentRoadmapId) {
				await roadmapService.replaceProjectRoadmap(
					projectId,
					selectedRoadmapId,
				);
			} else {
				await roadmapService.update(selectedRoadmapId, {
					project_id: projectId,
				});
			}
			onLinked(selectedRoadmapId);
		} catch (error) {
			console.error("Failed to link roadmap:", error);
			setErrorMessage(
				error instanceof Error ? error.message : "Failed to link roadmap.",
			);
		} finally {
			setIsLinking(false);
			setShowConfirmInfo(false);
		}
	};

	return (
		<ModalPortal>
			<>
				<AnimatePresence>
					{isOpen && (
						<motion.div
							className="fixed inset-0 z-9999 flex items-center justify-center p-4"
							initial={{ opacity: 0 }}
							animate={{ opacity: 1 }}
							exit={{ opacity: 0 }}
						>
							{/* Backdrop */}
							<motion.div
								className="absolute inset-0 bg-black/50 backdrop-blur-sm"
								initial={{ opacity: 0 }}
								animate={{ opacity: 1 }}
								exit={{ opacity: 0 }}
								onClick={onClose}
							/>

							{/* Dialog */}
							<motion.div
								className="relative flex max-h-[90dvh] w-full max-w-4xl flex-col rounded-2xl border border-border bg-card p-5 text-card-foreground shadow-2xl sm:p-8"
								initial={{ opacity: 0, scale: 0.9, y: 20 }}
								animate={{ opacity: 1, scale: 1, y: 0 }}
								exit={{ opacity: 0, scale: 0.9, y: 20 }}
								transition={{ duration: 0.3, ease: "easeOut" }}
							>
								{/* Close button */}
								<button
									type="button"
									onClick={onClose}
									className="absolute top-4 right-4 p-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors"
									aria-label="Close dialog"
								>
									<X className="w-5 h-5" />
								</button>

								{/* Header */}
								<div className="mb-6">
									<h2 className="text-xl font-semibold text-foreground mb-2 pr-8">
										Link Existing Roadmap
									</h2>
									<p className="text-sm leading-6 text-muted-foreground">
										{currentRoadmapId
											? "Pick an existing roadmap to use for this project. The empty roadmap currently attached will be discarded."
											: "Select an existing roadmap to link to this project. Only roadmaps that are not currently linked to a project are shown."}
									</p>
									{errorMessage && (
										<p className="mt-3 text-sm text-destructive">
											{errorMessage}
										</p>
									)}
								</div>

								{/* Content */}
								<div className="min-h-0 overflow-y-auto py-2 mb-6 text-left">
									{isLoading ? (
										<div className="flex justify-center items-center py-8">
											<Loader2 className="w-6 h-6 animate-spin text-primary" />
										</div>
									) : errorMessage &&
										roadmaps.length === 0 ? null : roadmaps.length === 0 ? (
										<div className="text-center py-12 px-4 text-muted-foreground border border-border bg-muted/40 rounded-xl border-dashed">
											<Map className="w-8 h-8 mx-auto mb-3 text-primary" />
											<p>No unlinked roadmaps found.</p>
											<p className="text-sm mt-1">
												Create a new roadmap instead.
											</p>
										</div>
									) : (
										<div className="grid grid-cols-1 gap-4 p-1 sm:grid-cols-2">
											{roadmaps.map((roadmap) => (
												<RoadmapPreviewCard
													key={roadmap.id}
													variant="roadmap"
													title={roadmap.name || "Untitled Roadmap"}
													description={roadmap.description || "Project Roadmap"}
													epics={roadmap.epics ?? []}
													previewImageUrl={roadmap.preview_url}
													selected={selectedRoadmapId === roadmap.id}
													onSelect={() => setSelectedRoadmapId(roadmap.id)}
													status={
														<ProjectStatusBadge
															status={roadmap.status}
															className="shrink-0 capitalize"
														/>
													}
													footerAction={
														<span className="inline-flex items-center gap-1 text-xs font-semibold text-primary">
															<CheckCircle2 className="h-3.5 w-3.5" />
															{selectedRoadmapId === roadmap.id
																? "Selected to link"
																: "Click to select"}
														</span>
													}
												/>
											))}
										</div>
									)}
								</div>

								{/* Actions */}
								<div className="flex gap-3 justify-end">
									<button
										type="button"
										onClick={onClose}
										disabled={isLinking}
										className="px-6 py-2.5 text-foreground bg-card border border-border hover:bg-muted rounded-lg font-semibold transition-colors disabled:opacity-50"
									>
										Cancel
									</button>
									<button
										type="button"
										onClick={() => setShowConfirmInfo(true)}
										disabled={!selectedRoadmapId || isLinking}
										className="flex items-center justify-center gap-2 px-6 py-2.5 bg-primary text-primary-foreground rounded-lg font-semibold hover:bg-primary/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
									>
										{isLinking ? (
											<>
												<Loader2 className="w-4 h-4 animate-spin" />
												Linking...
											</>
										) : (
											"Link Roadmap"
										)}
									</button>
								</div>
							</motion.div>
						</motion.div>
					)}
				</AnimatePresence>

				<AnimatePresence>
					{showConfirmInfo && (
						<motion.div
							className="fixed inset-0 z-[10001] flex items-center justify-center p-4"
							initial={{ opacity: 0 }}
							animate={{ opacity: 1 }}
							exit={{ opacity: 0 }}
						>
							<motion.div
								className="absolute inset-0 bg-black/50 backdrop-blur-sm"
								initial={{ opacity: 0 }}
								animate={{ opacity: 1 }}
								exit={{ opacity: 0 }}
								onClick={() => setShowConfirmInfo(false)}
							/>

							<motion.div
								className="relative border border-border bg-card text-card-foreground rounded-2xl shadow-2xl max-w-sm w-full p-6 text-center"
								initial={{ opacity: 0, scale: 0.9, y: 20 }}
								animate={{ opacity: 1, scale: 1, y: 0 }}
								exit={{ opacity: 0, scale: 0.9, y: 20 }}
								transition={{ duration: 0.3, ease: "easeOut" }}
							>
								<div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
									<Map className="w-6 h-6 text-primary" />
								</div>
								<h3 className="text-xl font-bold text-foreground mb-2">
									Confirm Link
								</h3>
								<p className="text-muted-foreground mb-6">
									{currentRoadmapId
										? "Link this roadmap to the project and discard the current empty roadmap? This cannot be undone."
										: "Are you sure you want to link this roadmap to the project? This action cannot be undone."}
								</p>
								<div className="flex gap-3 justify-end">
									<button
										type="button"
										onClick={() => setShowConfirmInfo(false)}
										className="flex-1 px-4 py-2 text-foreground bg-card border border-border hover:bg-muted rounded-lg font-semibold transition-colors"
										disabled={isLinking}
									>
										Cancel
									</button>
									<button
										type="button"
										onClick={handleLink}
										className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-lg font-semibold hover:bg-primary/90 transition-all"
										disabled={isLinking}
									>
										{isLinking ? (
											<Loader2 className="w-5 h-5 mx-auto animate-spin" />
										) : (
											"Confirm"
										)}
									</button>
								</div>
							</motion.div>
						</motion.div>
					)}
				</AnimatePresence>
			</>
		</ModalPortal>
	);
}
