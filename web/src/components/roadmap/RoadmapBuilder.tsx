import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ImagePlus, Loader2, Sparkles, Trash2 } from "lucide-react";
import Header from "@/components/layout/Header";
import { getOrCreateGuestUser } from "@/lib/guestAuth";
import { generateRoadmapThumbnailDataUri } from "@/lib/roadmapThumbnail";
import { roadmapService } from "@/services/roadmap.service";
import { uploadService } from "@/services/upload.service";
import { useIsLoading, useUser } from "@/stores/authStore";

type RoadmapBuilderProps = {
  projectId?: string;
  embedded?: boolean;
};

const DEFAULT_NAME = "Untitled Roadmap";

export function RoadmapBuilder({
  projectId,
  embedded = false,
}: RoadmapBuilderProps) {
  const navigate = useNavigate();
  const authenticatedUser = useUser();
  const isAuthLoading = useIsLoading();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState(DEFAULT_NAME);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Ensure a guest identity exists up front (for unauthenticated visitors) so
  // thumbnail uploads carry the X-Guest-User-Id header and the created roadmap
  // has an owner. getOrCreateGuestUser is idempotent + cached.
  useEffect(() => {
    if (isAuthLoading || authenticatedUser) return;
    void getOrCreateGuestUser().catch((err) => {
      console.error("Failed to initialize guest session:", err);
      setError(
        "Failed to initialize your session. Please refresh and try again.",
      );
    });
  }, [authenticatedUser, isAuthLoading]);

  const ensureGuest = async () => {
    if (authenticatedUser) return;
    const guestId = await getOrCreateGuestUser();
    if (!guestId) throw new Error("Failed to initialize guest session");
  };

  const handleUpload = async (file: File) => {
    setUploadError(null);
    setUploading(true);
    try {
      await ensureGuest();
      const url = await uploadService.upload("roadmap_previews", file);
      setPreviewUrl(url);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const handleGenerate = () => {
    const label = name.trim() || DEFAULT_NAME;
    setUploadError(null);
    setPreviewUrl(generateRoadmapThumbnailDataUri(label, label));
  };

  const handleCreate = async () => {
    if (!previewUrl || isCreating) return;
    setError(null);
    setIsCreating(true);
    try {
      await ensureGuest();
      const roadmap = await roadmapService.create({
        name: name.trim() || DEFAULT_NAME,
        description: "",
        project_id: projectId || undefined,
        status: "draft",
        settings: {},
        preview_url: previewUrl,
      });

      navigate({
        to: "/project/$projectId/roadmap/$roadmapId",
        params: { projectId: projectId || "n", roadmapId: roadmap.id },
      });
    } catch (createError) {
      console.error("Failed to create roadmap:", createError);
      setError("Failed to create roadmap. Please try again.");
      setIsCreating(false);
    }
  };

  const canCreate = Boolean(previewUrl) && !uploading && !isCreating;

  return (
    <div
      className={`${embedded ? "h-full" : "min-h-screen pt-16"} bg-[#f6f7f8]`}
    >
      {!embedded && <Header />}

      <div className="flex h-full min-h-[50vh] items-center justify-center px-6 py-10">
        <div className="w-full max-w-lg rounded-2xl border border-gray-200 bg-white p-6 shadow-sm sm:p-8">
          <h1 className="text-xl font-semibold text-gray-900">
            Create a roadmap
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Give it a name and a thumbnail — the thumbnail is shown on your
            roadmap card.
          </p>

          {/* Name */}
          <div className="mt-6">
            <label
              htmlFor="roadmap-name"
              className="block text-sm font-semibold text-[#333438]"
            >
              Roadmap name
            </label>
            <input
              id="roadmap-name"
              type="text"
              value={name}
              maxLength={200}
              onChange={(e) => setName(e.target.value)}
              placeholder={DEFAULT_NAME}
              className="mt-1.5 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#ff9933]"
            />
          </div>

          {/* Thumbnail (required) */}
          <div className="mt-4">
            <div className="flex items-center justify-between">
              <label className="block text-sm font-semibold text-[#333438]">
                Thumbnail <span className="font-normal text-red-500">*</span>
              </label>
              <button
                type="button"
                onClick={handleGenerate}
                disabled={uploading}
                className="inline-flex items-center gap-1 text-xs font-medium text-[#ff9933] hover:text-[#e8842a] disabled:opacity-50"
              >
                <Sparkles className="h-3.5 w-3.5" />
                Generate one for me
              </button>
            </div>
            <p className="mb-2 text-xs text-[#92969f]">
              Upload an image or generate a default. Required to create the
              roadmap.
            </p>

            {previewUrl ? (
              <div className="group relative inline-block">
                <img
                  src={previewUrl}
                  alt="Roadmap thumbnail"
                  className="h-32 w-auto rounded-lg border border-gray-200 object-cover shadow-sm"
                />
                <button
                  type="button"
                  onClick={() => {
                    setPreviewUrl(null);
                    if (fileInputRef.current) fileInputRef.current.value = "";
                  }}
                  className="absolute -top-2 -right-2 rounded-full bg-red-500 p-1 text-white opacity-0 shadow-sm transition-opacity group-hover:opacity-100"
                  aria-label="Remove thumbnail"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-gray-200 py-6 text-[#92969f] transition-colors hover:border-[#ff9933] hover:text-[#ff9933] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {uploading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span className="text-sm">Uploading…</span>
                  </>
                ) : (
                  <>
                    <ImagePlus className="h-4 w-4" />
                    <span className="text-sm">Click to upload image</span>
                  </>
                )}
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleUpload(file);
              }}
            />
            {uploadError && (
              <p className="mt-1.5 text-xs text-red-500">{uploadError}</p>
            )}
          </div>

          {/* Actions */}
          <div className="mt-6 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={handleCreate}
              disabled={!canCreate}
              className="inline-flex items-center gap-2 rounded-lg bg-[#ff9933] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#e8842a] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isCreating && <Loader2 className="h-4 w-4 animate-spin" />}
              {isCreating ? "Creating…" : "Create roadmap"}
            </button>
          </div>

          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        </div>
      </div>
    </div>
  );
}
