import { CheckCircle2, Edit2, Loader2, Save, X } from "lucide-react";
import { useState } from "react";
import { cleanHTML } from "@/components/common/RichTextEditor/utils/formatting";
import { EditableRichSection } from "./EditableRichSection";
import { CustomFieldsEditor } from "./CustomFieldsEditor";
import type { ProjectBriefField } from "./types";

interface OverviewContentProps {
  projectTitle: string;
  clientName?: string;
  consultantName?: string;

  summaryHtml: string;
  customFields: ProjectBriefField[];

  canEdit: boolean;
  isSavingSummary: boolean;
  isSavingFields: boolean;
  editingSummary: boolean;
  setEditingSummary: (v: boolean) => void;

  onSaveSummary: (value: string) => Promise<void>;
  onSaveCustomFields: (next: ProjectBriefField[]) => Promise<void>;
}

export function OverviewContent({
  projectTitle,
  clientName,
  consultantName,
  summaryHtml,
  customFields,
  canEdit,
  isSavingSummary,
  isSavingFields,
  editingSummary,
  setEditingSummary,
  onSaveSummary,
  onSaveCustomFields,
}: OverviewContentProps) {
  const [draftSummary, setDraftSummary] = useState(summaryHtml);

  const handleSaveSummary = async () => {
    await onSaveSummary(cleanHTML(draftSummary));
    setEditingSummary(false);
  };

  return (
    <div className="w-full">
      <header className="mb-8 mt-1 space-y-3 border-b border-slate-200 pb-5">
        <p className="app-section-kicker">Overview</p>
        <h1 className="text-[28px] font-semibold uppercase leading-tight tracking-wide text-slate-900">
          {projectTitle}
        </h1>
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[13px] text-slate-700">
            <span className="mr-1.5 font-semibold">Client:</span>
            <span className="font-medium text-slate-500">{clientName ?? "-"}</span>
          </div>
          <div className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[13px] text-slate-700">
            <span className="mr-1.5 font-semibold">Consultant:</span>
            <span className="font-medium text-slate-500">
              {consultantName ?? "-"}
            </span>
          </div>
        </div>
      </header>

      <div className="space-y-8">
        {/* Project Summary — single rich-text section. Custom-shaped
            content (scope, constraints, risks, etc.) now lives in the
            user-defined custom_fields list below. */}
        <section className="flex items-start gap-3 border-b border-slate-200 pb-7">
          <CheckCircle2 className="mt-1.5 h-5 w-5 shrink-0 text-slate-700" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2 mb-2.5 min-h-[32px]">
              <h2 className="text-[18px] font-semibold leading-none text-slate-900">
                Project Summary
              </h2>
              {canEdit && !editingSummary && (
                <button
                  type="button"
                  onClick={() => {
                    setDraftSummary(summaryHtml);
                    setEditingSummary(true);
                  }}
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900"
                >
                  <Edit2 className="w-4 h-4" />
                  Edit
                </button>
              )}
              {canEdit && editingSummary && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setDraftSummary(summaryHtml);
                      setEditingSummary(false);
                    }}
                    disabled={isSavingSummary}
                    className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-200 disabled:opacity-50"
                  >
                    <X className="w-4 h-4" />
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleSaveSummary()}
                    disabled={isSavingSummary}
                    className="app-cta inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                  >
                    {isSavingSummary ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Save className="w-4 h-4" />
                    )}
                    Save
                  </button>
                </div>
              )}
            </div>
            <div className="space-y-3 text-[13px] leading-6 text-slate-600">
              <EditableRichSection
                value={summaryHtml}
                placeholder="Write the project summary..."
                emptyText="No summary added yet."
                isSaving={isSavingSummary}
                isEditing={editingSummary}
                draft={draftSummary}
                setDraft={setDraftSummary}
              />
            </div>
          </div>
        </section>

        <CustomFieldsEditor
          fields={customFields}
          canEdit={canEdit}
          isSaving={isSavingFields}
          onSave={onSaveCustomFields}
        />
      </div>
    </div>
  );
}
