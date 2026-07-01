/**
 * Upload Service
 * Handles file uploads to Cloudflare R2.
 * The browser POSTs the file (multipart) to a Cloudflare Worker that writes to
 * R2 via a native binding and returns the public URL (or, for private buckets,
 * the object key). This path never touches R2's S3 endpoint
 * (*.r2.cloudflarestorage.com) — which some client networks block at TLS and
 * which can be unprovisioned on new accounts — so uploads work everywhere.
 */

import apiClient, { API_BASE_URL } from "@/api/axios";
import { getAccessToken } from "@/lib/supabase";

// Upload worker origin. Defaults to the deployed realtime worker (which hosts
// POST /uploads); override with VITE_UPLOAD_WORKER_URL for local/dev workers.
const UPLOAD_WORKER_URL =
	import.meta.env.VITE_UPLOAD_WORKER_URL ||
	"https://proyekto-realtime.lucky-mud-7121.workers.dev";

export type UploadBucket =
	| "avatars"
	| "banners"
	| "project_banners"
	| "portfolio_projects"
	| "roadmap_previews"
	| "task_attachments"
	| "chat_attachments";

/** Full metadata for a chat attachment, persisted on the message. */
export interface ChatAttachmentMeta {
	url: string;
	name: string;
	content_type: string;
	size: number;
	width?: number;
	height?: number;
}

/**
 * Read an image's pixel dimensions client-side (so the thread can reserve
 * layout space and avoid jank). Resolves null for non-images or on failure.
 */
function readImageSize(
	file: File,
): Promise<{ width: number; height: number } | null> {
	if (!file.type.startsWith("image/")) return Promise.resolve(null);
	return new Promise((resolve) => {
		const url = URL.createObjectURL(file);
		const img = new Image();
		img.onload = () => {
			const size =
				img.naturalWidth && img.naturalHeight
					? { width: img.naturalWidth, height: img.naturalHeight }
					: null;
			URL.revokeObjectURL(url);
			resolve(size);
		};
		img.onerror = () => {
			URL.revokeObjectURL(url);
			resolve(null);
		};
		img.src = url;
	});
}

class UploadService {
	private base = "/api/uploads";

	/**
	 * Upload a file via the Cloudflare Worker, which stores it in R2.
	 * Returns the public URL (public buckets) or the object key (private buckets).
	 * Uses native fetch so the browser sets the multipart boundary itself.
	 */
	async upload(bucket: UploadBucket, file: File): Promise<string> {
		const token = await getAccessToken();

		const form = new FormData();
		form.append("bucket", bucket);
		form.append("file", file);

		const res = await fetch(`${UPLOAD_WORKER_URL}/uploads`, {
			method: "POST",
			headers: token ? { Authorization: `Bearer ${token}` } : {},
			body: form,
		});

		if (!res.ok) {
			let message = `Upload failed (${res.status})`;
			try {
				const body = await res.json();
				message = body?.message ?? body?.error ?? message;
			} catch {
				// non-JSON error body — keep the status-based message
			}
			throw new Error(message);
		}

		const body = (await res.json()) as { publicUrl: string };
		return body.publicUrl;
	}

	/**
	 * Upload avatar and persist to profile
	 */
	async uploadAvatar(file: File): Promise<string> {
		const publicUrl = await this.upload("avatars", file);
		await apiClient.post(`${this.base}/confirm-avatar`, {
			avatar_url: publicUrl,
		});
		return publicUrl;
	}

	/**
	 * Upload banner and persist to profile
	 */
	async uploadBanner(file: File): Promise<string> {
		const publicUrl = await this.upload("banners", file);
		await apiClient.post(`${this.base}/confirm-banner`, {
			banner_url: publicUrl,
		});
		return publicUrl;
	}

	/**
	 * Upload project banner and persist to the project record
	 */
	async uploadProjectBanner(projectId: string, file: File): Promise<string> {
		const publicUrl = await this.upload("project_banners", file);
		await apiClient.post(`${this.base}/confirm-project-banner`, {
			project_id: projectId,
			banner_url: publicUrl,
		});
		return publicUrl;
	}

	/**
	 * Upload a portfolio project image.
	 * Returns the public URL — no DB confirm needed; caller sets image_url on the portfolio record.
	 */
	async uploadPortfolioImage(file: File): Promise<string> {
		return this.upload("portfolio_projects", file);
	}

	/**
	 * Upload a task attachment via the backend signed-URL flow.
	 * Returns the public URL.
	 */
	async uploadTaskAttachment(file: File): Promise<string> {
		return this.upload("task_attachments", file);
	}

	/**
	 * Upload a chat attachment (image or file) to R2 and return full metadata
	 * to persist on the message. Image dimensions are read client-side first.
	 */
	async uploadChatAttachment(file: File): Promise<ChatAttachmentMeta> {
		const size = await readImageSize(file);
		const url = await this.upload("chat_attachments", file);
		return {
			url,
			name: file.name,
			content_type: file.type || "application/octet-stream",
			size: file.size,
			...(size ? { width: size.width, height: size.height } : {}),
		};
	}

	/**
	 * Upload a payout proof (image/PDF) to the PRIVATE R2 bucket via the backend
	 * (not the public Worker path). Returns the bare object key to persist on the
	 * payout; reads later go through a presigned GET on the backend.
	 */
	async uploadPayoutProof(file: File): Promise<string> {
		return this.uploadPrivateFile("payout_proofs", file);
	}

	/**
	 * Upload a payout-method QR image to the PRIVATE R2 bucket (reuses the
	 * payout_proofs bucket). Returns the bare object key to persist as qr_path;
	 * reads later go through a presigned GET on the backend.
	 */
	async uploadPayoutQr(file: File): Promise<string> {
		return this.uploadPrivateFile("payout_proofs", file);
	}

	/**
	 * POST a multipart file to the backend's private-upload endpoint and return
	 * the stored object key. IMPORTANT: the Content-Type header must be cleared
	 * so the browser sets `multipart/form-data; boundary=…` itself — apiClient's
	 * default `application/json` would otherwise suppress the boundary and multer
	 * would see no file (400 "No file provided").
	 */
	private async uploadPrivateFile(
		bucket: string,
		file: File,
	): Promise<string> {
		const token = await getAccessToken();
		const form = new FormData();
		form.append("bucket", bucket);
		form.append("file", file);

		// Native fetch (not apiClient) so the browser sets the multipart
		// Content-Type + boundary itself; apiClient's default application/json
		// header would suppress the boundary and multer would see no file.
		const res = await fetch(`${API_BASE_URL}${this.base}/file`, {
			method: "POST",
			headers: token ? { Authorization: `Bearer ${token}` } : {},
			body: form,
		});

		if (!res.ok) {
			let message = `Upload failed (${res.status})`;
			try {
				const body = await res.json();
				message = body?.error?.message ?? body?.message ?? message;
			} catch {
				// non-JSON error body — keep the status-based message
			}
			throw new Error(message);
		}

		const body = (await res.json()) as { data?: { path: string }; path?: string };
		const path = body?.data?.path ?? body?.path;
		if (!path) throw new Error("Upload succeeded but no path was returned.");
		return path;
	}

	/**
	 * Remove avatar from storage and clear the profile field
	 */
	async deleteAvatar(): Promise<void> {
		await apiClient.delete(`${this.base}/avatar`);
	}
}

export const uploadService = new UploadService();
