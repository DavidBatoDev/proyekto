/**
 * Feature flags — toggle experimental or cost-sensitive features without
 * touching component logic. Set a flag to `true` to enable.
 */
/**
 * Transport for a realtime feature. "supabase" = legacy Supabase Realtime;
 * "durable-objects" = the Cloudflare Worker in realtime/. Flipped per feature
 * so each migration phase rolls out (and rolls back) independently.
 */
export type RealtimeTransport = "supabase" | "durable-objects";

export const featureFlags = {
	/**
	 * Whole-app semantic theme runtime. Set VITE_THEME_SYSTEM_ENABLED=false in
	 * a build to force Light and hide the appearance entry point as a rollback.
	 */
	themeSystem: import.meta.env.VITE_THEME_SYSTEM_ENABLED !== "false",

	/**
	 * Show live mouse cursors of other users on the roadmap canvas.
	 * Disabled by default because cursor broadcasts are high-frequency and
	 * add Supabase Realtime message volume. All other real-time features
	 * (data sync, presence avatars, data_changed notifications) are
	 * unaffected by this flag.
	 */
	realtimeCursors: true,

	/**
	 * Transport for roadmap collaboration (presence/cursors/data-sync).
	 * Active on Durable Objects. Falls back to Supabase automatically when
	 * VITE_REALTIME_URL is unset (isRealtimeConfigured() === false), so an
	 * environment without the Worker deployed keeps working.
	 */
	realtimeRoadmapTransport: "durable-objects" as RealtimeTransport,

	/**
	 * Transport for chat (message/reaction/read invalidation + typing).
	 * Active on Durable Objects. Same VITE_REALTIME_URL fallback as above.
	 */
	realtimeChatTransport: "durable-objects" as RealtimeTransport,

	/**
	 * Push roadmap-AI trace events over the Durable Objects worker (agent →
	 * `user:{id}` room) so activity steps appear without waiting for the next
	 * poll. Polling stays on as the authoritative fallback either way — this
	 * flag only adds the accelerator. Flip to true after verifying the agent
	 * side is publishing (AGENT_REALTIME_TRACE_PUSH_ENABLED).
	 */
	realtimeAiTracePush: true as boolean,

	/**
	 * Curated stock photos as the default roadmap thumbnail, served from R2 via
	 * the committed manifest in src/data/stockPhotoManifest.ts. Off = roadmap
	 * create keeps generating the gradient thumbnail, exactly as before.
	 *
	 * Do NOT enable until `node scripts/seed_stock_photos.mjs` has run and the
	 * objects are live on cdn.proyekto.tech — the manifest can be committed
	 * ahead of the upload, and this flag is what keeps that ordering safe.
	 */
	stockPhotos: import.meta.env.VITE_STOCK_PHOTOS_ENABLED === "true",

	/**
	 * Comment count badges and hover previews on the roadmap canvas, fed by
	 * GET /api/roadmaps/:roadmapId/comment-summary.
	 *
	 * Off by default so the migration, endpoint and optimistic wiring can land
	 * live while the canvas surface is verified — with the flag off the query
	 * is disabled, so a dark build makes no extra request at all. Set
	 * VITE_CANVAS_COMMENT_INDICATORS=true to enable.
	 */
	canvasCommentIndicators:
		import.meta.env.VITE_CANVAS_COMMENT_INDICATORS === "true",
} as const;
