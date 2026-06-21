/**
 * Upload Service
 * Handles file uploads to Cloudflare R2 (S3-compatible).
 * All buckets use the same flow: the backend issues a presigned PUT URL, the
 * browser uploads the bytes directly, and the backend returns the public URL
 * (or, for private buckets, the object key).
 */

import apiClient from "@/api/axios";

export type UploadBucket =
  | "avatars"
  | "banners"
  | "project_banners"
  | "portfolio_projects"
  | "roadmap_previews"
  | "task_attachments";

export interface SignedUrlResponse {
  signedUrl: string;
  path: string;
  publicUrl: string;
}

class UploadService {
  private base = "/api/uploads";

  /**
   * Full upload flow via backend signed URL:
   * 1. Get a signed upload URL from the backend
   * 2. PUT the file directly to Supabase Storage
   * 3. Return the public URL
   */
  async upload(bucket: UploadBucket, file: File): Promise<string> {
    const fileType = file.type || "application/octet-stream";

    // Step 1 — get signed URL
    const { data: meta } = await apiClient.post<{ data: SignedUrlResponse }>(
      `${this.base}/signed-url`,
      {
        bucket,
        fileType,
        fileName: file.name,
        fileSize: file.size,
      },
    );
    const { signedUrl, publicUrl } = meta.data;

    // Step 2 — PUT directly to storage (no auth header needed for signed uploads)
    const uploadRes = await fetch(signedUrl, {
      method: "PUT",
      headers: { "Content-Type": fileType },
      body: file,
    });

    if (!uploadRes.ok) {
      throw new Error(`Storage upload failed: ${uploadRes.statusText}`);
    }

    return publicUrl;
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
