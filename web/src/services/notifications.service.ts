import apiClient from "@/api/axios";

export type NotificationCategory = "global" | "specific";
export type NotificationPriority = "low" | "medium" | "high";

export interface NotificationTypeMeta {
	id: string;
	name: string;
	category: NotificationCategory;
	priority: NotificationPriority;
}

export interface NotificationItem {
	id: string;
	user_id: string;
	project_id: string | null;
	actor_id: string | null;
	content: Record<string, unknown>;
	is_read: boolean;
	read_at: string | null;
	link_url: string | null;
	created_at: string;
	updated_at: string;
	type: NotificationTypeMeta | null;
}

export interface NotificationTypePreference {
	type_name: string;
	email_enabled: boolean;
}

export interface NotificationPreferences {
	/** Master switch. When false, no notification email is sent at all. */
	all_email_enabled: boolean;
	/** One entry per type this build can render an email for. */
	types: NotificationTypePreference[];
}

export interface UpdateNotificationPreferences {
	all_email_enabled?: boolean;
	types?: NotificationTypePreference[];
}

export interface NotificationsQuery {
	limit?: number;
	offset?: number;
	is_read?: boolean;
	project_id?: string;
}

class NotificationsService {
	private base = "/api/notifications";

	async list(query: NotificationsQuery = {}): Promise<NotificationItem[]> {
		const params: Record<string, string | number | boolean> = {};

		if (query.limit !== undefined) params.limit = query.limit;
		if (query.offset !== undefined) params.offset = query.offset;
		if (query.is_read !== undefined) params.is_read = query.is_read;
		if (query.project_id) params.project_id = query.project_id;

		const { data } = await apiClient.get(this.base, { params });
		return data.data;
	}

	async unreadCount(): Promise<number> {
		const { data } = await apiClient.get(`${this.base}/unread-count`);
		return data.data?.unread ?? 0;
	}

	async markRead(id: string, isRead = true) {
		const { data } = await apiClient.patch(`${this.base}/${id}/read`, {
			is_read: isRead,
		});
		return data.data;
	}

	async markAllRead() {
		const { data } = await apiClient.patch(`${this.base}/read-all`);
		return data.data;
	}

	async deleteOne(id: string) {
		const { data } = await apiClient.delete(`${this.base}/${id}`);
		return data.data;
	}

	async getPreferences(): Promise<NotificationPreferences> {
		const { data } = await apiClient.get(`${this.base}/preferences`);
		return data.data;
	}

	async updatePreferences(
		patch: UpdateNotificationPreferences,
	): Promise<NotificationPreferences> {
		const { data } = await apiClient.put(`${this.base}/preferences`, patch);
		return data.data;
	}

	/**
	 * Apply an unsubscribe token. Unauthenticated on purpose — this is reached
	 * from an email footer, where there is no session. The API always answers 200,
	 * even for an unknown token, so this never reveals whether one was valid.
	 */
	async unsubscribe(token: string, scope?: string) {
		const params = new URLSearchParams({ token });
		if (scope) params.set("scope", scope);
		const { data } = await apiClient.post(
			`${this.base}/unsubscribe?${params.toString()}`,
		);
		return data.data;
	}
}

export const notificationsService = new NotificationsService();
