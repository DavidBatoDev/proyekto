import {
  type Env,
  type PresenceMeta,
  type RealtimeMessage,
  type RoomType,
  type SocketAttachment,
} from "./types";

/**
 * One Durable Object instance per room key. Uses the WebSocket Hibernation API
 * (`acceptWebSocket` + `webSocket*` handlers) so a room with idle connections
 * is evicted from memory and rehydrated on the next event — idle rooms cost
 * nothing.
 *
 * Wire protocol — every frame is `{ event, payload }`:
 *   client -> DO:  track | cursor | typing | data_changed
 *   DO -> client:  presence | cursor | typing | data_changed | <backend events>
 *
 * Peer events (cursor/typing/data_changed) are relayed verbatim to the other
 * sockets, so payload shapes match the old Supabase broadcasts 1:1 and the
 * client hooks need no payload changes. Backend events arrive via POST /publish
 * (forwarded by the Worker as an internal `/publish` request) and fan out to
 * every socket in the room.
 */
export class RealtimeRoom {
  private readonly state: DurableObjectState;

  constructor(state: DurableObjectState, _env: Env) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Internal fan-out from the Worker (backend publish).
    if (url.pathname === "/publish") {
      const { event, payload } = (await request.json()) as RealtimeMessage;
      this.broadcast(event, payload);
      return new Response(null, { status: 202 });
    }

    // WebSocket upgrade (already authenticated + authorized by the Worker).
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected websocket", { status: 426 });
    }

    const userId = request.headers.get("x-user-id") ?? "";
    const roomType = (request.headers.get("x-room-type") ?? "user") as RoomType;

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    const attachment: SocketAttachment = { userId, roomType, presence: null };
    server.serializeAttachment(attachment);
    this.state.acceptWebSocket(server);

    // Tell the newcomer who is already present (roadmap rooms).
    if (roomType === "roadmap") {
      this.sendTo(server, "presence", { collaborators: this.presenceList() });
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): void {
    if (typeof raw !== "string") return;
    let msg: RealtimeMessage;
    try {
      msg = JSON.parse(raw) as RealtimeMessage;
    } catch {
      return;
    }
    if (!msg || typeof msg.event !== "string") return;

    switch (msg.event) {
      case "track": {
        const attachment = this.getAttachment(ws);
        attachment.presence = sanitizePresence(msg.payload, attachment.userId);
        ws.serializeAttachment(attachment);
        this.broadcast("presence", { collaborators: this.presenceList() });
        return;
      }
      // Peer broadcasts — relay verbatim to everyone else in the room.
      case "cursor":
      case "typing":
      case "data_changed":
      // Live epic/feature drag preview (Figma-style); relayed like cursors.
      case "node_drag_start":
      case "node_drag":
      case "node_drag_end": {
        this.broadcast(msg.event, msg.payload, ws);
        return;
      }
      default:
        return;
    }
  }

  webSocketClose(ws: WebSocket, code: number, reason: string): void {
    try {
      ws.close(code, reason);
    } catch {
      // already closing
    }
    const attachment = this.getAttachment(ws);
    if (attachment.roomType === "roadmap") {
      // Recompute presence excluding the socket that just closed. getWebSockets()
      // may still include it briefly, so filter it out explicitly.
      this.broadcast("presence", {
        collaborators: this.presenceList(ws),
      });
    }
  }

  webSocketError(): void {
    // Surfaced as a close; presence reconciles on the next sync.
  }

  // ── helpers ──────────────────────────────────────────────────────────────

  private getAttachment(ws: WebSocket): SocketAttachment {
    const att = ws.deserializeAttachment() as SocketAttachment | null;
    return att ?? { userId: "", roomType: "user", presence: null };
  }

  private presenceList(exclude?: WebSocket): PresenceMeta[] {
    const seen = new Set<string>();
    const out: PresenceMeta[] = [];
    for (const ws of this.state.getWebSockets()) {
      if (ws === exclude) continue;
      const att = this.getAttachment(ws);
      if (!att.presence || seen.has(att.presence.userId)) continue;
      seen.add(att.presence.userId);
      out.push(att.presence);
    }
    return out;
  }

  private sendTo(ws: WebSocket, event: string, payload: unknown): void {
    try {
      ws.send(JSON.stringify({ event, payload }));
    } catch {
      // socket gone
    }
  }

  private broadcast(event: string, payload: unknown, exclude?: WebSocket): void {
    const frame = JSON.stringify({ event, payload });
    for (const ws of this.state.getWebSockets()) {
      if (ws === exclude) continue;
      try {
        ws.send(frame);
      } catch {
        // socket gone; it will be cleaned up on close
      }
    }
  }
}

export function sanitizePresence(
  payload: unknown,
  fallbackUserId: string,
): PresenceMeta {
  const p = (payload ?? {}) as Partial<PresenceMeta>;
  return {
    userId: typeof p.userId === "string" && p.userId ? p.userId : fallbackUserId,
    name: typeof p.name === "string" ? p.name : undefined,
    avatarUrl: typeof p.avatarUrl === "string" ? p.avatarUrl : null,
    color: typeof p.color === "string" ? p.color : undefined,
    editingNodeId: typeof p.editingNodeId === "string" ? p.editingNodeId : null,
  };
}
