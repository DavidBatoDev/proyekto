import { useEffect, useState } from "react";
import { AlertTriangle, Trash2, X } from "lucide-react";

interface RemoveMemberModalProps {
  open: boolean;
  memberName: string;
  onClose: () => void;
  onConfirm: () => void;
  loading?: boolean;
}

export function RemoveMemberModal({
  open,
  memberName,
  onClose,
  onConfirm,
  loading = false,
}: RemoveMemberModalProps) {
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    if (!open) return;
    setEntered(false);
    const id = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(id);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !loading) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, loading, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        onClick={loading ? undefined : onClose}
        aria-label="Close remove member confirmation"
        className={`absolute inset-0 bg-slate-900/45 backdrop-blur-[2px] transition-opacity duration-300 ${
          entered ? "opacity-100" : "opacity-0"
        }`}
      />

      <div
        className={`relative w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl transition-all duration-300 ease-out ${
          entered ? "opacity-100 translate-y-0 scale-100" : "opacity-0 translate-y-4 scale-95"
        }`}
      >
        <div className="relative border-b border-red-100 bg-gradient-to-r from-red-50 to-orange-50 px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-red-100 text-red-600">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-red-600">
                  Confirm Removal
                </p>
                <h2 className="mt-0.5 text-[18px] font-semibold text-slate-900">
                  Remove Team Member
                </h2>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-white/70 hover:text-slate-700 disabled:opacity-50"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="px-5 py-4">
          <p className="text-sm text-slate-700">
            You are about to remove{" "}
            <span className="font-semibold text-slate-900">{memberName}</span>{" "}
            from this project team.
          </p>
          <p className="mt-2 text-xs text-slate-500">
            This action immediately revokes project access and unassigns active tasks.
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/80 px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="rounded-md px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-md bg-red-600 px-3 py-2 text-sm font-semibold text-white shadow-sm shadow-red-600/20 transition-all hover:bg-red-700 disabled:opacity-50"
          >
            {loading ? (
              <span className="h-4 w-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
            {loading ? "Removing..." : "Remove Member"}
          </button>
        </div>
      </div>
    </div>
  );
}
