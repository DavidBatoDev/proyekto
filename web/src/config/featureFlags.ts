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
} as const;
