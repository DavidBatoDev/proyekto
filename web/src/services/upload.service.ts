/**
 * Upload Service
 * Handles file uploads to Cloudflare R2 (S3-compatible).
 * The browser POSTs the file to the backend (multipart); the backend proxies
 * it to R2 and returns the public URL (or, for private buckets, the object
 * key). The browser never touches R2's S3 endpoint
 * (*.r2.cloudflarestorage.com), which some client networks block at TLS.
 */

import apiClient, { API_BASE_URL } from "@/api/axios";
import { getAccessToken } from "@/lib/supabase";

export type UploadBucket =
  | "avatars"
  | "banners"
  | "project_banners"
  | "portfolio_projects"
  | "roadmap_previews"
  | "task_attachments";

class UploadService {
  private base = "/api/uploads";

  /**
   * Upload a file through the backend, which stores it in R2.
   * Returns the public URL (public buckets) or the object key (private buckets).
   * Uses native fetch so the browser sets the multipart boundary itself.
   */
  async upload(bucket: UploadBucket, file: File): Promise<string> {
    const token = await getAccessToken();

    const form = new FormData();
    form.append("bucket", bucket);
    form.append("file", file);

    const res = await fetch(`${API_BASE_URL}${this.base}/file`, {
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

    const body = (await res.json()) as { data: { publicUrl: string } };
    return body.data.publicUrl;
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
   * Remove avatar from storage and clear the profile field
   */
  async deleteAvatar(): Promise<void> {
    await apiClient.delete(`${this.base}/avatar`);
  }
}

export const uploadService = new UploadService();
