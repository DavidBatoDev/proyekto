import { getAccessToken } from "@/lib/supabase";

/**
 * Thin WebSocket client for the Cloudflare Durable Objects realtime transport
 * (the `realtime/` Worker). One instance per room; the room key namespace is:
 *   roadmap:{roadmapId}   chatroom:{roomId}   user:{userId}
 *
 * It intentionally mirrors the slice of the Supabase channel API the hooks
 * used — `on(event, cb)`, `send(event, payload)`, `track(meta)` — so migrating
 * a hook is a transport swap, not a rewrite. Handlers receive the payload
 * directly (the wire envelope `{ event, payload }` is unwrapped here).
 *
 * Connection lifecycle: lazy connect, auto-reconnect with backoff, and the
 * last `track()` payload is re-sent on every (re)connect so presence survives
 * drops. A fresh access token is fetched per connect, so token expiry is
 * handled by reconnection.
 */

const RAW_URL = import.meta.env.VITE_REALTIME_URL as string | undefined;

/** Whether the DO transport is configured (URL present). */
export function isRealtimeConfigured(): boolean {
	return Boolean(RAW_URL);
}

function wsBaseUrl(): string | null {
	if (!RAW_URL) return null;
	// http(s):// -> ws(s)://
	return RAW_URL.replace(/^http/i, "ws").replace(/\/$/, "");
}

type Handler<T = unknown> = (payload: T) => void;
type ConnectionStatus = "connecting" | "connected" | "disconnected";

const MAX_BACKOFF_MS = 15_000;

export class RealtimeRoom {
	private ws: WebSocket | null = null;
	private readonly handlers = new Map<string, Set<Handler>>();
	private readonly outbox: string[] = [];
	private trackPayload: unknown = null;
	private reconnectAttempts = 0;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private disposed = false;
	private connecting = false;

	constructor(
		private readonly roomKey: string,
		private readonly onStatus?: (status: ConnectionStatus) => void,
	) {}

	/** Register a handler for an event. Chainable. */
	on<T = unknown>(event: string, handler: Handler<T>): this {
		let set = this.handlers.get(event);
		if (!set) {
			set = new Set();
			this.handlers.set(event, set);
		}
		set.add(handler as Handler);
		return this;
	}

	/** Send a peer broadcast (cursor / typing / data_changed). Queued if offline. */
	send(event: string, payload: unknown): void {
		this.raw(JSON.stringify({ event, payload }));
	}

	/** Set/replace this client's presence metadata; re-sent on every reconnect. */
	track(payload: unknown): void {
		this.trackPayload = payload;
		if (this.isOpen()) this.send("track", payload);
	}

	/** Open the connection (idempotent). */
	connect(): void {
		if (this.disposed || this.connecting || this.isOpen()) return;
		void this.open();
	}

	/** Permanently close and stop reconnecting. */
	close(): void {
		this.disposed = true;
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
		const ws = this.ws;
		this.ws = null;
		if (ws) {
			try {
				ws.close();
			} catch {
				// already closed
			}
		}
	}

	// ── internals ──────────────────────────────────────────────────────────

	private isOpen(): boolean {
		return this.ws?.readyState === WebSocket.OPEN;
	}

	private raw(frame: string): void {
		const ws = this.ws;
		if (ws && ws.readyState === WebSocket.OPEN) {
			ws.send(frame);
		} else {
			this.outbox.push(frame);
		}
	}

	private async open(): Promise<void> {
		const base = wsBaseUrl();
		if (!base || this.disposed) return;
		this.connecting = true;
		this.onStatus?.("connecting");

		let token: string | null = null;
		try {
			token = await getAccessToken();
		} catch {
			token = null;
		}
		if (this.disposed) {
			this.connecting = false;
			return;
		}
		if (!token) {
			this.connecting = false;
			this.scheduleReconnect();
			return;
		}

		const url = `${base}/ws?room=${encodeURIComponent(
			this.roomKey,
		)}&token=${encodeURIComponent(token)}`;

		let ws: WebSocket;
		try {
			ws = new WebSocket(url);
		} catch {
			this.connecting = false;
			this.scheduleReconnect();
			return;
		}
		this.ws = ws;

		ws.onopen = () => {
			this.connecting = false;
			this.reconnectAttempts = 0;
			this.onStatus?.("connected");
			// Re-establish presence, then flush anything queued while offline.
			if (this.trackPayload != null) {
				ws.send(JSON.stringify({ event: "track", payload: this.trackPayload }));
			}
			for (const frame of this.outbox.splice(0)) ws.send(frame);
		};

		ws.onmessage = (ev) => {
			let msg: { event?: string; payload?: unknown };
			try {
				msg = JSON.parse(ev.data as string);
			} catch {
				return;
			}
			if (!msg.event) return;
			const set = this.handlers.get(msg.event);
			if (!set) return;
			for (const handler of set) handler(msg.payload);
		};

		const onDown = () => {
			if (this.ws !== ws) return; // superseded by a newer socket
			this.ws = null;
			this.connecting = false;
			this.onStatus?.("disconnected");
			this.scheduleReconnect();
		};
		ws.onclose = onDown;
		ws.onerror = onDown;
	}

	private scheduleReconnect(): void {
		if (this.disposed || this.reconnectTimer) return;
		const delay = Math.min(1000 * 2 ** this.reconnectAttempts, MAX_BACKOFF_MS);
		const jitter = Math.random() * 300;
		this.reconnectAttempts += 1;
		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = null;
			void this.open();
		}, delay + jitter);
	}
}
