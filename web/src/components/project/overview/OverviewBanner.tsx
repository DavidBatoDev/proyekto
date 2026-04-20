import { ImagePlus } from "lucide-react";
import { UploadModal } from "@/components/profile/UploadModal";

interface OverviewBannerProps {
  bannerUrl: string | null;
  canEdit: boolean;
  isUploading: boolean;
  isOpen: boolean;
  onOpenModal: () => void;
  onCloseModal: () => void;
  onUpload: (files: File[]) => void;
}

export function OverviewBanner({
  bannerUrl,
  canEdit,
  isUploading,
  isOpen,
  onOpenModal,
  onCloseModal,
  onUpload,
}: OverviewBannerProps) {
  return (
    <>
      <div className="app-surface-card-strong relative mb-6 h-48 w-full overflow-hidden rounded-2xl">
        <div className="absolute inset-0 bg-linear-to-br from-slate-900 via-slate-800 to-slate-700" />
        {bannerUrl && (
          <img
            src={bannerUrl}
            alt="Project banner"
            className="relative h-full w-full object-cover"
          />
        )}
        {canEdit && (
          <button
            type="button"
            onClick={onOpenModal}
            className="absolute bottom-3 right-3 inline-flex items-center gap-1.5 rounded-full border border-white/25 bg-slate-900/55 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur-sm transition hover:bg-slate-900/70"
          >
            <ImagePlus className="w-3.5 h-3.5" />
            {bannerUrl ? "Change banner" : "Add banner"}
          </button>
        )}
      </div>

      <UploadModal
        isOpen={isOpen}
        onClose={onCloseModal}
        title="Project Banner"
        accept="image/jpeg,image/png,image/webp"
        maxFiles={1}
        maxSizeMb={10}
        aspectHint="4:1 (wide)"
        onUpload={(files) => onUpload(files)}
        isUploading={isUploading}
      />
    </>
  );
}
