import {
  AlertTriangle,
  CheckCircle2,
  Edit2,
  Shield,
  StickyNote,
  Loader2,
  Save,
  X,
} from "lucide-react";
import { useState } from "react";
import { cleanHTML } from "@/components/common/RichTextEditor/utils/formatting";
import { EditableRichSection } from "./EditableRichSection";

interface OverviewContentProps {
  projectTitle: string;
  clientName?: string;
  consultantName?: string;

  summaryHtml: string;
  scopeHtml: string;
  constraintsHtml: string;
  requirementsHtml: string;
  notesHtml: string;
  risks: string[];

  canEdit: boolean;
  savingSection:
    | "summary"
    | "scope"
    | "constraints"
    | "requirements"
    | "notes"
    | null;
  editingSummary: boolean;
  editingScope: boolean;
  editingConstraints: boolean;
  editingRequirements: boolean;
  editingNotes: boolean;

  setEditingSummary: (v: boolean) => void;
  setEditingScope: (v: boolean) => void;
  setEditingConstraints: (v: boolean) => void;
  setEditingRequirements: (v: boolean) => void;
  setEditingNotes: (v: boolean) => void;

  onSaveSummary: (value: string) => Promise<void>;
  onSaveScope: (value: string) => Promise<void>;
  onSaveConstraints: (value: string) => Promise<void>;
  onSaveRequirements: (value: string) => Promise<void>;
  onSaveNotes: (value: string) => Promise<void>;
}

export function OverviewContent({
  projectTitle,
  clientName,
  consultantName,
  summaryHtml,
  scopeHtml,
  constraintsHtml,
  requirementsHtml,
  notesHtml,
  risks,
  canEdit,
  savingSection,
  editingSummary,
  editingScope,
  editingConstraints,
  editingRequirements,
  editingNotes,
  setEditingSummary,
  setEditingScope,
  setEditingConstraints,
  setEditingRequirements,
  setEditingNotes,
  onSaveSummary,
  onSaveScope,
  onSaveConstraints,
  onSaveRequirements,
  onSaveNotes,
}: OverviewContentProps) {
  const [draftSummary, setDraftSummary] = useState(summaryHtml);
  const [draftScope, setDraftScope] = useState(scopeHtml);
  const [draftConstraints, setDraftConstraints] = useState(constraintsHtml);
  const [draftRequirements, setDraftRequirements] = useState(requirementsHtml);
  const [draftNotes, setDraftNotes] = useState(notesHtml);

  const handleSaveSummary = async () => {
    await onSaveSummary(cleanHTML(draftSummary));
    setEditingSummary(false);
  };

  const handleSaveScope = async () => {
    await onSaveScope(cleanHTML(draftScope));
    setEditingScope(false);
  };

  const handleSaveConstraints = async () => {
    await onSaveConstraints(cleanHTML(draftConstraints));
    setEditingConstraints(false);
  };

  const handleSaveRequirements = async () => {
    await onSaveRequirements(cleanHTML(draftRequirements));
    setEditingRequirements(false);
  };

  const handleSaveNotes = async () => {
    await onSaveNotes(cleanHTML(draftNotes));
    setEditingNotes(false);
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
        {/* Project Summary */}
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
                    disabled={savingSection === "summary"}
                    className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-200 disabled:opacity-50"
                  >
                    <X className="w-4 h-4" />
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleSaveSummary()}
                    disabled={savingSection === "summary"}
                    className="app-cta inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                  >
                    {savingSection === "summary" ? (
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
                isSaving={savingSection === "summary"}
                isEditing={editingSummary}
                draft={draftSummary}
                setDraft={setDraftSummary}
              />
            </div>
          </div>
        </section>

        {/* Scope */}
        <section className="flex items-start gap-3 border-b border-slate-200 pb-7">
          <Shield className="mt-1.5 h-5 w-5 shrink-0 text-slate-700" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2 mb-2.5 min-h-[32px]">
              <h2 className="text-[18px] font-semibold leading-none text-slate-900">
                Scope
              </h2>
              {canEdit && !editingScope && (
                <button
                  type="button"
                  onClick={() => {
                    setDraftScope(scopeHtml);
                    setEditingScope(true);
                  }}
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900"
                >
                  <Edit2 className="w-4 h-4" />
                  Edit
                </button>
              )}
              {canEdit && editingScope && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setDraftScope(scopeHtml);
                      setEditingScope(false);
                    }}
                    disabled={savingSection === "scope"}
                    className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-200 disabled:opacity-50"
                  >
                    <X className="w-4 h-4" />
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleSaveScope()}
                    disabled={savingSection === "scope"}
                    className="app-cta inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                  >
                    {savingSection === "scope" ? (
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
                value={scopeHtml}
                placeholder="Write the scope statement..."
                emptyText="No scope statement added yet."
                isSaving={savingSection === "scope"}
                isEditing={editingScope}
                draft={draftScope}
                setDraft={setDraftScope}
              />
            </div>
          </div>
        </section>

        {/* Constraints */}
        <section className="flex items-start gap-3 border-b border-slate-200 pb-7">
          <AlertTriangle className="mt-1.5 h-5 w-5 shrink-0 text-slate-700" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2 mb-2.5 min-h-[32px]">
              <h2 className="text-[18px] font-semibold leading-none text-slate-900">
                Constraints
              </h2>
              {canEdit && !editingConstraints && (
                <button
                  type="button"
                  onClick={() => {
                    setDraftConstraints(constraintsHtml);
                    setEditingConstraints(true);
                  }}
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900"
                >
                  <Edit2 className="w-4 h-4" />
                  Edit
                </button>
              )}
              {canEdit && editingConstraints && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setDraftConstraints(constraintsHtml);
                      setEditingConstraints(false);
                    }}
                    disabled={savingSection === "constraints"}
                    className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-200 disabled:opacity-50"
                  >
                    <X className="w-4 h-4" />
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleSaveConstraints()}
                    disabled={savingSection === "constraints"}
                    className="app-cta inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                  >
                    {savingSection === "constraints" ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Save className="w-4 h-4" />
                    )}
                    Save
                  </button>
                </div>
              )}
            </div>
            <div className="space-y-3 rounded-md bg-slate-100/80 px-3 py-2.5 text-[13px] leading-6 text-slate-600">
              <EditableRichSection
                value={constraintsHtml}
                placeholder="Write constraints..."
                emptyText="No constraints added yet."
                isSaving={savingSection === "constraints"}
                isEditing={editingConstraints}
                draft={draftConstraints}
                setDraft={setDraftConstraints}
              />
            </div>
          </div>
        </section>

        {/* Core Requirements */}
        <section className="flex items-start gap-3 border-b border-slate-200 pb-7">
          <CheckCircle2 className="mt-1.5 h-5 w-5 shrink-0 text-slate-700" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2 mb-2.5 min-h-[32px]">
              <h2 className="text-[18px] font-semibold leading-none text-slate-900">
                Core Requirements
              </h2>
              {canEdit && !editingRequirements && (
                <button
                  type="button"
                  onClick={() => {
                    setDraftRequirements(requirementsHtml);
                    setEditingRequirements(true);
                  }}
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900"
                >
                  <Edit2 className="w-4 h-4" />
                  Edit
                </button>
              )}
              {canEdit && editingRequirements && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setDraftRequirements(requirementsHtml);
                      setEditingRequirements(false);
                    }}
                    disabled={savingSection === "requirements"}
                    className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-200 disabled:opacity-50"
                  >
                    <X className="w-4 h-4" />
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleSaveRequirements()}
                    disabled={savingSection === "requirements"}
                    className="app-cta inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                  >
                    {savingSection === "requirements" ? (
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
                value={requirementsHtml}
                placeholder="Describe core requirements..."
                emptyText="No requirements listed yet."
                isSaving={savingSection === "requirements"}
                isEditing={editingRequirements}
                draft={draftRequirements}
                setDraft={setDraftRequirements}
              />
            </div>
          </div>
        </section>

        {/* Project Notes */}
        <section className="flex items-start gap-3 border-b border-slate-200 pb-7">
          <StickyNote className="mt-1.5 h-5 w-5 shrink-0 text-slate-700" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2 mb-2.5 min-h-[32px]">
              <h2 className="text-[18px] font-semibold leading-none text-slate-900">
                Project Notes
              </h2>
              {canEdit && !editingNotes && (
                <button
                  type="button"
                  onClick={() => {
                    setDraftNotes(notesHtml);
                    setEditingNotes(true);
                  }}
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900"
                >
                  <Edit2 className="w-4 h-4" />
                  Edit
                </button>
              )}
              {canEdit && editingNotes && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setDraftNotes(notesHtml);
                      setEditingNotes(false);
                    }}
                    disabled={savingSection === "notes"}
                    className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-200 disabled:opacity-50"
                  >
                    <X className="w-4 h-4" />
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleSaveNotes()}
                    disabled={savingSection === "notes"}
                    className="app-cta inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                  >
                    {savingSection === "notes" ? (
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
                value={notesHtml}
                placeholder="Write project notes..."
                emptyText="No notes added yet."
                isSaving={savingSection === "notes"}
                isEditing={editingNotes}
                draft={draftNotes}
                setDraft={setDraftNotes}
              />
            </div>
          </div>
        </section>

        {/* Risk Register */}
        <section className="flex items-start gap-3 pb-2">
          <AlertTriangle className="mt-1.5 h-5 w-5 shrink-0 text-slate-700" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center mb-2.5 min-h-[32px]">
              <h2 className="text-[18px] font-semibold leading-none text-slate-900">
                Risk Register
              </h2>
            </div>
            {risks.length > 0 ? (
              <ul className="space-y-1.5 text-[13px] text-slate-700">
                {risks.map((item) => (
                  <li key={item} className="flex items-start gap-2">
                    <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-slate-500" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-slate-500">No risks logged yet.</p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

