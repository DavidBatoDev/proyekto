import { UserRound, X } from "lucide-react";
import { useEffect, useState } from "react";
import { ModalPortal } from "@/components/common/ModalPortal";

interface ConfirmAssigneeOverwriteDialogProps {
  isOpen: boolean;
  isSaving: boolean;
  currentAssigneeName: string | null;
  newAssigneeName: string | null;
  onCancel: () => void;
  onConfirm: () => Promise<void> | void;
}

export function ConfirmAssigneeOverwriteDialog({
  isOpen,
  isSaving,
  currentAssigneeName,
  newAssigneeName,
  onCancel,
  onConfirm,
}: ConfirmAssigneeOverwriteDialogProps) {
  const [shouldRender, setShouldRender] = useState(isOpen);
  const [isVisible, setIsVisible] = useState(isOpen);

  useEffect(() => {
    if (isOpen) {
      setShouldRender(true);
      const raf = requestAnimationFrame(() => setIsVisible(true));
      return () => cancelAnimationFrame(raf);
    }
    setIsVisible(false);
    const timeout = window.setTimeout(() => setShouldRender(false), 180);
    return () => window.clearTimeout(timeout);
  }, [isOpen]);

  if (!shouldRender || !currentAssigneeName || !newAssigneeName) {
    return null;
  }

  return (
    <ModalPortal>
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-[3px] transition-opacity duration-200 ${
        isVisible ? "opacity-100" : "opacity-0"
      }`}
    >
      <div
        className={`w-full max-w-lg overflow-hidden rounded-2xl border border-orange-100/80 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.35)] transition-all duration-200 ${
          isVisible
            ? "translate-y-0 scale-100 opacity-100"
            : "translate-y-2 scale-95 opacity-0"
        }`}
      >
        <div className="flex items-center justify-between border-b border-orange-100 bg-gradient-to-r from-amber-50 via-orange-50 to-rose-50 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-orange-500 text-white shadow-sm">
              <UserRound size={17} />
            </div>
            <div>
              <h3 className="text-base font-semibold text-slate-900">
                Replace assignee?
              </h3>
              <p className="text-xs text-slate-500">
                This task already has someone assigned.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-white/80 hover:text-slate-700"
            aria-label="Close assignee confirmation dialog"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-4 px-5 py-5 text-sm text-slate-700">
          <p className="text-[15px] leading-relaxed text-slate-800">
            Replace{" "}
            <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-sm font-semibold text-slate-700">
              {currentAssigneeName}
            </span>{" "}
            with{" "}
            <span className="inline-flex items-center rounded-full bg-orange-100 px-2.5 py-0.5 text-sm font-semibold text-orange-800">
              {newAssigneeName}
            </span>
            ?
          </p>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50/50 px-5 py-4">
          <button
            type="button"
            onClick={onCancel}
            disabled={isSaving}
            className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void onConfirm()}
            disabled={isSaving}
            className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-orange-500 to-amber-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all hover:brightness-105 disabled:opacity-60"
          >
            {isSaving ? "Saving..." : "Replace assignee"}
          </button>
        </div>
      </div>
    </div>
    </ModalPortal>
  );
}
