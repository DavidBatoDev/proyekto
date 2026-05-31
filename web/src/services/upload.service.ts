/**
 * Upload Service
 * Handles file uploads to Supabase Storage.
 * - Standard buckets (avatars, banners, etc.): signed URL flow via backend.
 * - Task attachments: direct upload via authenticated Supabase client.
 */

import apiClient from "@/api/axios";
import { supabase } from "@/lib/supabase";

export type UploadBucket =
  | "avatars"
  | "banners"
  | "project_banners"
  | "portfolio_projects"
  | "roadmap_previews"
  | "task_attachments";

export interface SignedUrlResponse {
  signedUrl: string;
  token: string;
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
   * Direct upload via authenticated Supabase client.
   * Used for task_attachments — avoids the signed URL round-trip and backend
   * file-type validation, which can fail for unusual mime types.
   */
  async uploadDirect(bucket: string, file: File): Promise<string> {
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id;
    if (!userId) throw new Error("Not authenticated");

    const ext = file.name.includes(".") ? file.name.split(".").pop() : "";
    const path = `${userId}/${Date.now()}${ext ? `.${ext}` : ""}`;

    const { error } = await supabase.storage
      .from(bucket)
      .upload(path, file, { upsert: false, contentType: file.type || "application/octet-stream" });

    if (error) throw new Error(error.message);

    const { data: { publicUrl } } = supabase.storage.from(bucket).getPublicUrl(path);
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
   * Upload a task attachment directly via authenticated Supabase client.
   * Returns the public URL.
   */
  async uploadTaskAttachment(file: File): Promise<string> {
    return this.uploadDirect("task_attachments", file);
  }

  /**
   * Remove avatar from storage and clear the profile field
   */
  async deleteAvatar(): Promise<void> {
    await apiClient.delete(`${this.base}/avatar`);
  }
}

export const uploadService = new UploadService();
