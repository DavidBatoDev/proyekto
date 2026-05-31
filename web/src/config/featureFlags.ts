/**
 * Feature flags — toggle experimental or cost-sensitive features without
 * touching component logic. Set a flag to `true` to enable.
 */
export const featureFlags = {
  /**
   * Show live mouse cursors of other users on the roadmap canvas.
   * Disabled by default because cursor broadcasts are high-frequency and
   * add Supabase Realtime message volume. All other real-time features
   * (data sync, presence avatars, data_changed notifications) are
   * unaffected by this flag.
   */
  realtimeCursors: true,
} as const;
