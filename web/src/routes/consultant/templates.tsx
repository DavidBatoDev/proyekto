import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { Archive, BarChart3, Loader2, Plus, RefreshCw } from "lucide-react";
import { useState } from "react";
import {
	archiveRoadmapTemplate,
	createRoadmapTemplateFromRoadmap,
	getMyRoadmapTemplates,
	getRoadmaps,
	getRoadmapTemplateAnalytics,
	getRoadmapTemplateCategories,
	publishRoadmapTemplate,
	reviseRoadmapTemplate,
	unlistRoadmapTemplate,
} from "@/api";
import { generateRoadmapThumbnailDataUri } from "@/lib/roadmapThumbnail";
import { useAuthStore } from "@/stores/authStore";

export const Route = createFileRoute("/consultant/templates")({
	beforeLoad: () => {
		const { isAuthenticated, profile } = useAuthStore.getState();
		if (!isAuthenticated) throw redirect({ to: "/auth/login" });
		if (profile && !profile.is_consultant_verified)
			throw redirect({ to: "/dashboard" });
	},
	component: ConsultantTemplatesPage,
});

function ConsultantTemplatesPage() {
	const queryClient = useQueryClient();
	const [showCreate, setShowCreate] = useState(false);
	const [selectedRoadmapId, setSelectedRoadmapId] = useState("");
	const [title, setTitle] = useState("");
	const [summary, setSummary] = useState("");
	const [category, setCategory] = useState("");
	const [tags, setTags] = useState("");
	const [attested, setAttested] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [analyticsId, setAnalyticsId] = useState<string | null>(null);
	const templatesQuery = useQuery({
		queryKey: ["roadmap-templates", "mine"],
		queryFn: getMyRoadmapTemplates,
	});
	const roadmapsQuery = useQuery({
		queryKey: ["roadmaps", "template-sources"],
		queryFn: getRoadmaps,
	});
	const categoriesQuery = useQuery({
		queryKey: ["roadmap-template-categories"],
		queryFn: getRoadmapTemplateCategories,
	});
	const analyticsQuery = useQuery({
		queryKey: ["roadmap-template-analytics", analyticsId],
		queryFn: () => getRoadmapTemplateAnalytics(analyticsId as string),
		enabled: Boolean(analyticsId),
	});
	const refresh = () =>
		queryClient.invalidateQueries({ queryKey: ["roadmap-templates", "mine"] });

	const createMutation = useMutation({
		mutationFn: async () => {
			const source = (roadmapsQuery.data ?? []).find(
				(roadmap) => roadmap.id === selectedRoadmapId,
			);
			if (!source) throw new Error("Choose a source roadmap");
			const draft = await createRoadmapTemplateFromRoadmap(source.id, {
				title,
				summary,
				category,
				tags,
				preview_url:
					source.preview_url ??
					generateRoadmapThumbnailDataUri(source.id, source.name),
				difficulty: "intermediate",
				schedule_kind: "long_term",
				estimated_duration_days: 120,
				rights_attested: attested,
			});
			await publishRoadmapTemplate(draft.id);
			return draft;
		},
		onSuccess: () => {
			setShowCreate(false);
			setTitle("");
			setSummary("");
			setTags("");
			setAttested(false);
			void refresh();
		},
		onError: (cause) =>
			setError(
				cause instanceof Error ? cause.message : "Could not publish template",
			),
	});

	const actionMutation = useMutation({
		mutationFn: async ({
			id,
			action,
		}: {
			id: string;
			action: "revise" | "unlist" | "archive";
		}) => {
			if (action === "revise") return reviseRoadmapTemplate(id);
			if (action === "unlist") return unlistRoadmapTemplate(id);
			return archiveRoadmapTemplate(id);
		},
		onSuccess: () => void refresh(),
		onError: (cause) =>
			setError(
				cause instanceof Error ? cause.message : "Template action failed",
			),
	});

	return (
		<main className="min-h-screen bg-background pt-24 text-foreground">
			<div className="mx-auto max-w-6xl px-6 pb-16">
				<div className="flex flex-wrap items-start justify-between gap-4">
					<div>
						<h1 className="text-3xl font-bold">Published templates</h1>
						<p className="mt-2 text-muted-foreground">
							Turn a roadmap you own into an immutable, attributed marketplace
							template.
						</p>
					</div>
					<button
						type="button"
						onClick={() => setShowCreate((open) => !open)}
						className="inline-flex items-center gap-2 rounded-xl bg-foreground px-4 py-2.5 text-sm font-bold text-background transition-opacity hover:opacity-85"
					>
						<Plus className="h-4 w-4" />
						Create from roadmap
					</button>
				</div>

				{showCreate ? (
					<form
						onSubmit={(event) => {
							event.preventDefault();
							setError(null);
							createMutation.mutate();
						}}
						className="mt-6 grid gap-4 rounded-2xl border border-border bg-card p-6 text-card-foreground shadow-(--app-shadow-sm) sm:grid-cols-2"
					>
						<label className="text-sm font-semibold">
							Source roadmap
							<select
								required
								value={selectedRoadmapId}
								onChange={(event) => {
									const id = event.target.value;
									setSelectedRoadmapId(id);
									const source = (roadmapsQuery.data ?? []).find(
										(roadmap) => roadmap.id === id,
									);
									if (source) {
										setTitle(source.name);
										setSummary(
											source.description ||
												`A practical roadmap template for ${source.name}.`,
										);
									}
								}}
								className="mt-2 h-11 w-full rounded-lg border border-input bg-background px-3 font-normal text-foreground"
							>
								<option value="">Choose roadmap</option>
								{(roadmapsQuery.data ?? []).map((roadmap) => (
									<option key={roadmap.id} value={roadmap.id}>
										{roadmap.name}
										{roadmap.project_id ? " · project linked" : " · standalone"}
									</option>
								))}
							</select>
						</label>
						<label className="text-sm font-semibold">
							Category
							<select
								required
								value={category}
								onChange={(event) => setCategory(event.target.value)}
								className="mt-2 h-11 w-full rounded-lg border border-input bg-background px-3 font-normal text-foreground"
							>
								<option value="">Choose category</option>
								{(categoriesQuery.data ?? []).map((item) => (
									<option key={item.id} value={item.slug}>
										{item.name}
									</option>
								))}
							</select>
						</label>
						<label className="text-sm font-semibold">
							Title
							<input
								required
								minLength={3}
								value={title}
								onChange={(event) => setTitle(event.target.value)}
								className="mt-2 h-11 w-full rounded-lg border border-input bg-background px-3 font-normal text-foreground"
							/>
						</label>
						<label className="text-sm font-semibold">
							Tags
							<input
								value={tags}
								onChange={(event) => setTags(event.target.value)}
								placeholder="discovery, launch, growth"
								className="mt-2 h-11 w-full rounded-lg border border-input bg-background px-3 font-normal text-foreground placeholder:text-muted-foreground"
							/>
						</label>
						<label className="text-sm font-semibold sm:col-span-2">
							Summary
							<textarea
								required
								minLength={20}
								value={summary}
								onChange={(event) => setSummary(event.target.value)}
								className="mt-2 min-h-24 w-full rounded-lg border border-input bg-background p-3 font-normal text-foreground"
							/>
						</label>
						<label className="flex items-start gap-3 text-sm text-muted-foreground sm:col-span-2">
							<input
								type="checkbox"
								checked={attested}
								onChange={(event) => setAttested(event.target.checked)}
								className="mt-1"
							/>
							<span>
								I confirm I own or have permission to publish this roadmap
								content. Personal data, assignments, comments, files, and
								completion state will not be copied.
							</span>
						</label>
						<div className="sm:col-span-2">
							<button
								type="submit"
								disabled={!attested || createMutation.isPending}
								className="rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground disabled:opacity-50"
							>
								{createMutation.isPending
									? "Validating and publishing…"
									: "Publish template"}
							</button>
						</div>
					</form>
				) : null}
				{error ? (
					<div className="mt-5 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
						{error}
					</div>
				) : null}

				{templatesQuery.isPending ? (
					<div className="flex justify-center py-20">
						<Loader2 className="h-8 w-8 animate-spin text-primary" />
					</div>
				) : templatesQuery.data?.length ? (
					<div className="mt-8 space-y-4">
						{templatesQuery.data.map((template) => (
							<div
								key={template.id}
								className="rounded-2xl border border-border bg-card p-5 text-card-foreground shadow-(--app-shadow-sm)"
							>
								<div className="flex flex-wrap items-start justify-between gap-4">
									<div>
										<div className="flex items-center gap-2">
											<h2 className="text-lg font-bold">{template.title}</h2>
											<span
												className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase ${template.status === "published" ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"}`}
											>
												{template.status}
											</span>
										</div>
										<p className="mt-1 max-w-2xl text-sm text-muted-foreground">
											{template.summary}
										</p>
										<p className="mt-2 text-xs text-muted-foreground">
											Version{" "}
											{template.current_version?.version_number ?? "draft"} ·{" "}
											{template.view_count} views · {template.duplicate_count}{" "}
											copies · {template.rating_average || "—"} rating
										</p>
									</div>
									<div className="flex flex-wrap gap-2">
										{template.status === "published" ? (
											<Link
												to="/roadmap-templates/$slug"
												params={{ slug: template.slug }}
												className="rounded-lg border border-border px-3 py-2 text-xs font-bold transition-colors hover:bg-muted"
											>
												View
											</Link>
										) : null}
										<button
											type="button"
											onClick={() =>
												actionMutation.mutate({
													id: template.id,
													action: "revise",
												})
											}
											className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-2 text-xs font-bold transition-colors hover:bg-muted"
										>
											<RefreshCw className="h-3 w-3" />
											New revision
										</button>
										{template.status === "published" ? (
											<button
												type="button"
												onClick={() =>
													actionMutation.mutate({
														id: template.id,
														action: "unlist",
													})
												}
												className="rounded-lg border border-border px-3 py-2 text-xs font-bold transition-colors hover:bg-muted"
											>
												Unlist
											</button>
										) : null}
										<button
											type="button"
											onClick={() =>
												actionMutation.mutate({
													id: template.id,
													action: "archive",
												})
											}
											className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-2 text-xs font-bold text-destructive transition-colors hover:bg-destructive/10"
										>
											<Archive className="h-3 w-3" />
											Archive
										</button>
										<button
											type="button"
											onClick={() =>
												setAnalyticsId(
													analyticsId === template.id ? null : template.id,
												)
											}
											className="inline-flex items-center gap-1 rounded-lg bg-muted px-3 py-2 text-xs font-bold text-foreground transition-colors hover:bg-accent"
										>
											<BarChart3 className="h-3 w-3" />
											Analytics
										</button>
									</div>
								</div>
								{analyticsId === template.id ? (
									<div className="mt-4 grid grid-cols-2 gap-3 rounded-xl bg-muted p-4 text-sm text-muted-foreground sm:grid-cols-5">
										{analyticsQuery.isPending ? (
											<span>Loading…</span>
										) : analyticsQuery.data ? (
											<>
												<span>
													<b>{analyticsQuery.data.view_count}</b>
													<br />
													Views
												</span>
												<span>
													<b>{analyticsQuery.data.unique_users}</b>
													<br />
													Unique users
												</span>
												<span>
													<b>{analyticsQuery.data.duplicates}</b>
													<br />
													Copies
												</span>
												<span>
													<b>{analyticsQuery.data.rating_average}</b>
													<br />
													Rating
												</span>
												<span>
													<b>{analyticsQuery.data.reports_open}</b>
													<br />
													Open reports
												</span>
											</>
										) : null}
									</div>
								) : null}
							</div>
						))}
					</div>
				) : (
					<div className="mt-8 rounded-2xl border-2 border-dashed border-border bg-card p-12 text-center text-card-foreground">
						<p className="font-semibold">No templates published yet.</p>
						<p className="mt-2 text-sm text-muted-foreground">
							Choose any roadmap you own to create your first marketplace
							template.
						</p>
					</div>
				)}
			</div>
		</main>
	);
}
