/**
 * UploadModal — reusable file upload modal
 *
 * Props:
 *  isOpen       — controls visibility
 *  onClose      — close callback
 *  title        — modal header text
 *  accept       — comma-separated MIME types or extensions, e.g. "image/jpeg,image/png"
 *  maxFiles     — max number of files selectable at once (default 1)
 *  maxSizeMb    — per-file size limit in MB (default 5)
 *  aspectHint   — optional e.g. "1:1" or "4:1" shown as UI hint
 *  onUpload     — called with the array of selected File objects; caller handles the actual upload
 *  isUploading  — show spinner in save button
 */
import { useRef, useState, useCallback, type DragEvent } from "react";
import { ProfileModal } from "./ProfileModal";
import { Upload, ImageIcon, X, AlertCircle, CheckCircle2, Loader2 } from "lucide-react";

interface UploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  accept?: string;              // e.g. "image/jpeg,image/png,image/webp"
  maxFiles?: number;            // default 1
  maxSizeMb?: number;           // default 5
  aspectHint?: string;          // e.g. "1:1 (square)" shown as a hint
  onUpload: (files: File[]) => void;
  isUploading?: boolean;
}

interface FileEntry {
  file: File;
  preview: string;
  error?: string;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

export function UploadModal({
  isOpen,
  onClose,
  title,
  accept = "image/jpeg,image/png,image/webp",
  maxFiles = 1,
  maxSizeMb = 5,
  aspectHint,
  onUpload,
  isUploading = false,
}: UploadModalProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [dragging, setDragging] = useState(false);

  const maxSizeBytes = maxSizeMb * 1024 * 1024;
  const acceptTypes = accept.split(",").map(s => s.trim());

  const validate = useCallback(
    (file: File): string | undefined => {
      if (!acceptTypes.some(t => file.type === t || file.name.endsWith(t.replace("image/", ".")))) {
        return `Unsupported type: ${file.type || file.name.split(".").pop()}`;
      }
      if (file.size > maxSizeBytes) {
        return `Too large: ${formatBytes(file.size)} (max ${maxSizeMb} MB)`;
      }
    },
    [acceptTypes, maxSizeBytes, maxSizeMb]
  );

  const addFiles = useCallback(
    (raw: FileList | null) => {
      if (!raw) return;
      const incoming = Array.from(raw).slice(0, maxFiles - entries.length);
      const newEntries: FileEntry[] = incoming.map(file => ({
        file,
        preview: URL.createObjectURL(file),
        error: validate(file),
      }));
      setEntries(prev => [...prev, ...newEntries].slice(0, maxFiles));
    },
    [entries.length, maxFiles, validate]
  );

  const removeEntry = (idx: number) => {
    setEntries(prev => {
      URL.revokeObjectURL(prev[idx].preview);
      return prev.filter((_, i) => i !== idx);
    });
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    addFiles(e.dataTransfer.files);
  };

  const handleClose = () => {
    entries.forEach(e => URL.revokeObjectURL(e.preview));
    setEntries([]);
    onClose();
  };

  const handleUpload = () => {
    const valid = entries.filter(e => !e.error);
    if (valid.length === 0) return;
    onUpload(valid.map(e => e.file));
  };

  const hasErrors = entries.some(e => e.error);
  const hasValid = entries.some(e => !e.error);
  const canAddMore = entries.length < maxFiles;

  // Friendly accept label
  const acceptLabel = acceptTypes
    .map(t => t.split("/")[1]?.toUpperCase() ?? t)
    .join(", ");

  return (
    <ProfileModal isOpen={isOpen} onClose={handleClose} title={title} width="md">
      <div className="space-y-4">
        {/* Constraints hint */}
        <div className="flex items-center gap-4 text-xs text-gray-500 bg-gray-50 rounded-lg p-3">
          <span className="font-medium">Accepted:</span>
          <span>{acceptLabel}</span>
          <span>·</span>
          <span>Max size: {maxSizeMb} MB</span>
          {maxFiles > 1 && <><span>·</span><span>Up to {maxFiles} files</span></>}
          {aspectHint && <><span>·</span><span>Ratio: {aspectHint}</span></>}
        </div>

        {/* Drop zone (shown when can still add files) */}
        {canAddMore && (
          <div
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={() => inputRef.current?.click()}
            className={`relative border-2 border-dashed rounded-xl flex flex-col items-center justify-center gap-2 py-8 cursor-pointer transition-colors ${
              dragging
                ? "border-primary bg-primary/5"
                : "border-gray-200 hover:border-primary/50 hover:bg-gray-50"
            }`}
          >
            <div className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${dragging ? "bg-primary/10" : "bg-gray-100"}`}>
              <Upload className={`w-5 h-5 transition-colors ${dragging ? "text-primary" : "text-gray-400"}`} />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-gray-700">
                {dragging ? "Drop to upload" : "Drag & drop or click to browse"}
              </p>
              <p className="text-xs text-gray-400 mt-0.5">{acceptLabel} · Max {maxSizeMb} MB{maxFiles > 1 ? ` · Up to ${maxFiles} files` : ""}</p>
            </div>
            <input
              ref={inputRef}
              type="file"
              accept={accept}
              multiple={maxFiles > 1}
              className="hidden"
              onChange={e => addFiles(e.target.files)}
            />
          </div>
        )}

        {/* Previews */}
        {entries.length > 0 && (
          <div className={`grid gap-3 ${maxFiles === 1 ? "grid-cols-1" : "grid-cols-2 sm:grid-cols-3"}`}>
            {entries.map((entry, idx) => (
              <div key={idx} className={`relative rounded-xl overflow-hidden border-2 transition-colors ${entry.error ? "border-red-300" : "border-green-300"}`}>
                {entry.file.type.startsWith("image/") ? (
                  <img
                    src={entry.preview}
                    alt={entry.file.name}
                    className={`w-full object-cover ${maxFiles === 1 ? "max-h-48" : "aspect-square"}`}
                  />
                ) : (
                  <div className="w-full aspect-square bg-gray-100 flex items-center justify-center">
                    <ImageIcon className="w-8 h-8 text-gray-400" />
                  </div>
                )}

                {/* Status badge */}
                <div className={`absolute top-1.5 left-1.5 rounded-full p-0.5 ${entry.error ? "bg-red-500" : "bg-green-500"}`}>
                  {entry.error
                    ? <AlertCircle className="w-3 h-3 text-white" />
                    : <CheckCircle2 className="w-3 h-3 text-white" />
                  }
                </div>

                {/* Remove button */}
                <button
                  onClick={() => removeEntry(idx)}
                  className="absolute top-1.5 right-1.5 w-5 h-5 bg-gray-900/60 rounded-full flex items-center justify-center hover:bg-gray-900/80 transition-colors"
                >
                  <X className="w-3 h-3 text-white" />
                </button>

                {/* File info */}
                <div className="px-2 py-1.5 bg-white">
                  <p className="text-xs font-medium text-gray-700 truncate">{entry.file.name}</p>
                  {entry.error ? (
                    <p className="text-xs text-red-500">{entry.error}</p>
                  ) : (
                    <p className="text-xs text-gray-400">{formatBytes(entry.file.size)}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-3 pt-1">
          <button
            onClick={handleClose}
            className="px-5 py-2 text-sm border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleUpload}
            disabled={!hasValid || hasErrors || isUploading}
            className="px-5 py-2 text-sm bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-60 transition-colors flex items-center gap-2"
          >
            {isUploading ? (
              <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Uploading…</>
            ) : (
              <><Upload className="w-3.5 h-3.5" /> Upload</>
            )}
          </button>
        </div>
      </div>
    </ProfileModal>
  );
}
