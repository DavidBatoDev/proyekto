// Project Pages Types

export type PaymentStatus = "pending" | "paid" | "overdue" | "cancelled";

export interface Payment {
	id: string;
	project_id: string;
	description: string;
	amount: number;
	status: PaymentStatus;
	due_date?: string;
	paid_date?: string;
	notes?: string;
	created_at: string;
	updated_at: string;
}

export type ActivityEntityType =
	| "project"
	| "epic"
	| "feature"
	| "task"
	| "payment"
	| "file";

export interface ActivityLog {
	id: string;
	project_id: string;
	user_id: string;
	action: string; // e.g. "created", "updated", "completed", "deleted"
	entity_type: ActivityEntityType;
	entity_id: string;
	entity_title?: string;
	metadata?: Record<string, any>;
	created_at: string;
	user?: {
		id: string;
		display_name?: string;
		avatar_url?: string;
		email?: string;
	};
}

export interface ProjectFile {
	id: string;
	project_id: string;
	name: string;
	file_url: string;
	file_size?: number;
	mime_type?: string;
	uploaded_by: string;
	created_at: string;
	uploader?: {
		id: string;
		display_name?: string;
		avatar_url?: string;
	};
}
