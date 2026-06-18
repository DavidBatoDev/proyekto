/** Bindings + secrets available to the Worker and the Durable Object. */
export interface Env {
  /** Durable Object namespace; one instance per room key. */
  ROOMS: DurableObjectNamespace;
  /**
   * Supabase project URL (e.g. https://<ref>.supabase.co). Used to fetch the
   * JWKS for verifying asymmetric (ES256/RS256) access tokens — the default
   * for modern Supabase projects.
   */
  SUPABASE_URL?: string;
  /**
   * Legacy HS256 project JWT secret. Only used for projects still on symmetric
   * signing; asymmetric projects verify via SUPABASE_URL's JWKS instead.
   */
  SUPABASE_JWT_SECRET?: string;
  /** Shared secret the backend presents on POST /publish. */
  REALTIME_PUBLISH_TOKEN: string;
  /** Backend endpoint the Worker calls to authorize a connection. */
  BACKEND_AUTHORIZE_URL: string;
  /** Comma-separated allowed WebSocket origins; "*" allows any (dev only). */
  ALLOWED_ORIGINS?: string;
}

/**
 * ROOM KEY NAMESPACES — the string passed to `ROOMS.idFromName(key)`.
 *   roadmap:{roadmapId}   presence + cursors + data_changed (collaborative canvas)
 *   chatroom:{roomId}     typing broadcast only
 *   user:{userId}         per-user inbox fan-in (chat message/reaction/read invalidation)
 */
export type RoomType = "roadmap" | "chatroom" | "user";

export function parseRoomKey(
  key: string,
): { type: RoomType; id: string } | null {
  const idx = key.indexOf(":");
  if (idx <= 0) return null;
  const type = key.slice(0, idx);
  const id = key.slice(idx + 1);
  if (!id) return null;
  if (type === "roadmap" || type === "chatroom" || type === "user") {
    return { type, id };
  }
  return null;
}

/** Envelope every WebSocket frame uses, in both directions. */
export interface RealtimeMessage<T = unknown> {
  event: string;
  payload: T;
}

/** Presence metadata a client tracks (roadmap rooms). Stored per-socket. */
export interface PresenceMeta {
  userId: string;
  name?: string;
  avatarUrl?: string | null;
  color?: string;
}

/** What we serialize onto each hibernatable WebSocket. */
export interface SocketAttachment {
  userId: string;
  roomType: RoomType;
  presence: PresenceMeta | null;
}
