import {
  CheckCircle2,
  Loader2,
  Pencil,
  Plus,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { RichTextEditor } from "@/components/common/RichTextEditor";
import { cleanHTML } from "@/components/common/RichTextEditor/utils/formatting";
import type { ProjectBriefField } from "./types";

interface CustomFieldsEditorProps {
  fields: ProjectBriefField[];
  canEdit: boolean;
  isSaving: boolean;
  /** Called with the next array; parent persists and re-renders. */
  onSave: (next: ProjectBriefField[]) => void | Promise<void>;
}

type ModalState =
  | { mode: "closed" }
  | { mode: "create" }
  | { mode: "edit"; index: number };

/**
 * User-defined `{ key, value, position }` rows shown under the project
 * summary on /overview. Adding/editing happens in a focused modal so the
 * RichTextEditor for the value gets enough room to breathe; the page
 * itself just shows the persisted list as a definition list.
 *
 * Reordering (drag handles) is intentionally out of scope for v1 —
 * `position` follows insertion order and is compacted on delete.
 */
export function CustomFieldsEditor({
  fields,
  canEdit,
  isSaving,
  onSave,
}: CustomFieldsEditorProps) {
  const [modal, setModal] = useState<ModalState>({ mode: "closed" });
  const [confirmDeleteIndex, setConfirmDeleteIndex] = useState<number | null>(
    null,
  );

  const closeModal = () => setModal({ mode: "closed" });

  const handleSubmitField = async (next: { key: string; value: string }) => {
    const trimmedKey = next.key.trim();
    if (!trimmedKey) return;
    const cleanedValue = cleanHTML(next.value);

    if (modal.mode === "edit") {
      const updated = fields.map((row, i) =>
        i === modal.index
          ? { ...row, key: trimmedKey, value: cleanedValue }
          : row,
      );
      await onSave(updated);
    } else if (modal.mode === "create") {
      const updated = [
        ...fields,
        { key: trimmedKey, value: cleanedValue, position: fields.length },
      ];
      await onSave(updated);
    }
    closeModal();
  };

  const handleDeleteConfirmed = async (index: number) => {
    const updated = fields
      .filter((_, i) => i !== index)
      .map((row, i) => ({ ...row, position: i }));
    await onSave(updated);
    setConfirmDeleteIndex(null);
  };

  // Read-only audience: hide the section completely when there's nothing
  // to display so the page doesn't show an empty "Project details" header.
  if (!canEdit && fields.length === 0) return null;

  return (
    <div>
      {/* Top-level "Add field" affordance lives next to the last field's
          divider so it doesn't introduce a second header row. When there
          are no fields yet, the empty state itself surfaces it. */}
      {fields.length === 0 ? (
        <section className="flex items-start gap-3 border-b border-slate-200 pb-7">
          <CheckCircle2 className="mt-1.5 h-5 w-5 shrink-0 text-slate-300" />
          <div className="flex-1">
            <div className="mb-2.5 flex min-h-8 items-center justify-between gap-2">
              <h2 className="text-[18px] font-semibold leading-none text-slate-400">
                Project details
              </h2>
              {canEdit && (
                <button
                  type="button"
                  onClick={() => setModal({ mode: "create" })}
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900"
                >
                  <Plus className="h-4 w-4" />
                  Add field
                </button>
              )}
            </div>
            <p className="text-[13px] text-slate-500">
              {canEdit
                ? "No fields yet. Use Add field to capture stakeholders, links, dates, or anything else specific to this project."
                : "No additional details yet."}
            </p>
          </div>
        </section>
      ) : (
        <>
          {fields.map((row, index) => (
            <section
              key={`${row.position}-${row.key}-${index}`}
              className="group flex items-start gap-3 border-b border-slate-200 pb-7 pt-7 first:pt-0"
            >
              <CheckCircle2 className="mt-1.5 h-5 w-5 shrink-0 text-slate-700" />
              <div className="min-w-0 flex-1">
                <div className="mb-2.5 flex min-h-8 items-center justify-between gap-2">
                  <h2 className="text-[18px] font-semibold uppercase leading-none text-slate-900">
                    {row.key}
                  </h2>
                  {canEdit && (
                    <div className="flex shrink-0 items-center gap-2 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                      <button
                        type="button"
                        onClick={() => setModal({ mode: "edit", index })}
                        className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900"
                      >
                        <Pencil className="h-4 w-4" />
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteIndex(index)}
                        aria-label="Delete field"
                        title="Delete field"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-rose-50 hover:text-rose-700"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </div>
                <FieldValue value={row.value} />
              </div>
            </section>
          ))}
          {canEdit && (
            <div className="pt-5">
              <button
                type="button"
                onClick={() => setModal({ mode: "create" })}
                className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-600 hover:border-slate-400 hover:bg-slate-50"
              >
                <Plus className="h-4 w-4" />
                Add field
              </button>
            </div>
          )}
        </>
      )}

      {modal.mode !== "closed" && (
        <FieldEditorModal
          initial={
            modal.mode === "edit"
              ? { key: fields[modal.index].key, value: fields[modal.index].value }
              : { key: "", value: "" }
          }
          mode={modal.mode}
          isSaving={isSaving}
          onCancel={closeModal}
          onSubmit={handleSubmitField}
        />
      )}

      {confirmDeleteIndex !== null && (
        <ConfirmDeleteModal
          fieldKey={fields[confirmDeleteIndex]?.key ?? ""}
          isSaving={isSaving}
          onCancel={() => setConfirmDeleteIndex(null)}
          onConfirm={() => void handleDeleteConfirmed(confirmDeleteIndex)}
        />
      )}
    </div>
  );
}

function FieldValue({ value }: { value: string }) {
  const cleaned = (value ?? "").trim();
  if (!cleaned) {
    return <p className="mt-1 text-sm text-slate-400">—</p>;
  }
  return (
    <div
      className="prose prose-sm mt-1 max-w-none text-[14px] leading-6 text-slate-700 [&_a]:text-blue-600 [&_a]:underline [&_li]:my-0.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-0 [&_p+p]:mt-2 [&_strong]:font-semibold [&_ul]:list-disc [&_ul]:pl-5"
      // The HTML is already passed through cleanHTML on save; we render
      // the persisted value as-is.
      dangerouslySetInnerHTML={{ __html: cleaned }}
    />
  );
}

function FieldEditorModal({
  initial,
  mode,
  isSaving,
  onCancel,
  onSubmit,
}: {
  initial: { key: string; value: string };
  mode: "create" | "edit";
  isSaving: boolean;
  onCancel: () => void;
  onSubmit: (next: { key: string; value: string }) => void | Promise<void>;
}) {
  const [keyDraft, setKeyDraft] = useState(initial.key);
  const [valueDraft, setValueDraft] = useState(initial.value);

  // Re-sync if the modal is reopened with different initial content.
  useEffect(() => {
    setKeyDraft(initial.key);
    setValueDraft(initial.value);
  }, [initial.key, initial.value]);

  const canSubmit = keyDraft.trim().length > 0 && !isSaving;

  return (
    <ModalPortal>
      <div
        className="fixed inset-0 z-60 flex items-center justify-center bg-slate-900/50 px-4 backdrop-blur-sm"
        onClick={onCancel}
        role="presentation"
      >
        <div
          className="w-full max-w-2xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-labelledby="field-editor-title"
        >
          <header className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
            <h2
              id="field-editor-title"
              className="text-[16px] font-semibold text-slate-900"
            >
              {mode === "create" ? "Add field" : "Edit field"}
            </h2>
            <button
              type="button"
              onClick={onCancel}
              aria-label="Close"
              className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
            >
              <X className="h-4 w-4" />
            </button>
          </header>

          <form
            className="px-6 py-5"
            onSubmit={(e) => {
              e.preventDefault();
              if (!canSubmit) return;
              void onSubmit({ key: keyDraft, value: valueDraft });
            }}
          >
            {/* Mirror the on-page section layout: check icon on the left,
                heading-styled key input on top, rich value below. The
                preview reads the same as the rendered card on /overview
                so editors can see exactly what they're shaping. */}
            <div className="flex items-start gap-3">
              <CheckCircle2 className="mt-1.5 h-5 w-5 shrink-0 text-slate-700" />
              <div className="min-w-0 flex-1">
                <input
                  autoFocus
                  type="text"
                  value={keyDraft}
                  onChange={(e) =>
                    setKeyDraft(e.target.value.toUpperCase())
                  }
                  placeholder="LABEL (E.G. SCOPE, STAKEHOLDER, LAUNCH DATE)"
                  maxLength={120}
                  className="w-full border-0 bg-transparent p-0 text-[18px] font-semibold uppercase leading-none tracking-wide text-slate-900 placeholder:font-semibold placeholder:uppercase placeholder:text-slate-300 focus:outline-none"
                />
                <p className="mt-1.5 text-[11px] text-slate-400">
                  Plain text. Shown as the field heading on the overview.
                </p>

                <div className="mt-4">
                  <RichTextEditor
                    value={valueDraft}
                    onChange={setValueDraft}
                    placeholder="Add details, links, or formatting…"
                    minHeight="160px"
                    maxHeight="360px"
                    tools={[
                      "textFormat",
                      "bold",
                      "italic",
                      "more",
                      "separator",
                      "bulletList",
                      "numberedList",
                      "separator",
                      "link",
                    ]}
                  disabled={isSaving}
                />
              </div>
              </div>
            </div>

            <div className="mt-6 flex items-center justify-end gap-2 border-t border-slate-100 pt-4">
              <button
                type="button"
                onClick={onCancel}
                disabled={isSaving}
                className="rounded-md px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!canSubmit}
                className="app-cta inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {isSaving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                {mode === "create" ? "Add field" : "Save changes"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </ModalPortal>
  );
}

function ConfirmDeleteModal({
  fieldKey,
  isSaving,
  onCancel,
  onConfirm,
}: {
  fieldKey: string;
  isSaving: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <ModalPortal>
      <div
        className="fixed inset-0 z-60 flex items-center justify-center bg-slate-900/50 px-4 backdrop-blur-sm"
        onClick={onCancel}
        role="presentation"
      >
        <div
          className="w-full max-w-md overflow-hidden rounded-2xl border border-rose-200 bg-white shadow-2xl"
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
        >
          <div className="border-b border-rose-100 bg-rose-50 px-6 py-4">
            <h3 className="text-[16px] font-semibold text-rose-700">
              Delete field?
            </h3>
            <p className="mt-1 text-sm text-rose-700">
              This removes <span className="font-semibold">{fieldKey}</span>{" "}
              from the project overview. This can't be undone.
            </p>
          </div>
          <div className="flex items-center justify-end gap-2 px-6 py-4">
            <button
              type="button"
              onClick={onCancel}
              disabled={isSaving}
              className="rounded-md px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={isSaving}
              className="inline-flex items-center gap-1.5 rounded-md bg-rose-600 px-3 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
            >
              {isSaving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              Delete field
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}

/**
 * Render to document.body so the modal escapes ancestor stacking
 * contexts (the surrounding `app-surface-card` uses `backdrop-filter`,
 * which would otherwise trap a position:fixed child inside the card).
 */
function ModalPortal({ children }: { children: ReactNode }) {
  if (typeof document === "undefined") return null;
  return createPortal(children, document.body);
}
