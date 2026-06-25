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
      <header className="mb-5 mt-1 space-y-2 border-b border-slate-200 pb-3 md:mb-8 md:space-y-3 md:pb-5">
        <p className="app-section-kicker">Overview</p>
        <h1 className="text-xl font-semibold uppercase leading-tight tracking-wide text-slate-900 md:text-[28px]">
          {projectTitle}
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-[12px] text-slate-700 md:px-3 md:py-1 md:text-[13px]">
            <span className="mr-1 font-semibold">Client:</span>
            <span className="font-medium text-slate-500">{clientName ?? "-"}</span>
          </div>
          <div className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-[12px] text-slate-700 md:px-3 md:py-1 md:text-[13px]">
            <span className="mr-1 font-semibold">Consultant:</span>
            <span className="font-medium text-slate-500">
              {consultantName ?? "-"}
            </span>
          </div>
        </div>
      </header>

      <div className="space-y-5 md:space-y-8">
        {/* Project Summary — single rich-text section. Custom-shaped
            content (scope, constraints, risks, etc.) now lives in the
            user-defined custom_fields list below. */}
        <section className="flex items-start gap-2.5 border-b border-slate-200 pb-4 md:gap-3 md:pb-7">
          <CheckCircle2 className="mt-1.5 h-4 w-4 shrink-0 text-slate-700 md:h-5 md:w-5" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2 mb-2 min-h-7 md:mb-2.5 md:min-h-8">
              <h2 className="text-[15px] font-semibold leading-none text-slate-900 md:text-[18px]">
                Project Summary
              </h2>
              {canEdit && !editingSummary && (
                <button
                  type="button"
                  onClick={() => {
                    setDraftSummary(summaryHtml);
                    setEditingSummary(true);
                  }}
                  className="inline-flex items-center gap-1 rounded-md p-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-900 md:gap-1.5 md:px-2 md:text-sm"
                >
                  <Edit2 className="h-3.5 w-3.5 md:h-4 md:w-4" />
                  <span className="hidden md:inline">Edit</span>
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
