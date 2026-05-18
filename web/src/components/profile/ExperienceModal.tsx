import { useState, useEffect } from "react";
import { ProfileModal } from "./ProfileModal";
import { Briefcase, Loader2 } from "lucide-react";
import type { UserExperience } from "@/services/profile.service";

type ExpPayload = Omit<UserExperience, "id" | "user_id" | "created_at" | "updated_at">;

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSave: (payload: ExpPayload) => void;
  isSaving?: boolean;
  /** When provided, the modal runs in edit mode pre-filled with this data */
  initialData?: Partial<UserExperience>;
}

const empty: ExpPayload = {
  company: "", title: "", location: "", is_remote: false,
  description: "", start_date: "", end_date: null, is_current: false,
};

export function ExperienceModal({ isOpen, onClose, onSave, isSaving, initialData }: Props) {
  const isEdit = !!initialData;
  const [form, setForm] = useState<ExpPayload>(empty);
  const set = (k: keyof ExpPayload, v: unknown) => setForm(p => ({ ...p, [k]: v }));

  useEffect(() => {
    if (isOpen) {
      setForm(initialData ? {
        company:     initialData.company     ?? "",
        title:       initialData.title       ?? "",
        location:    initialData.location    ?? "",
        is_remote:   initialData.is_remote   ?? false,
        description: initialData.description ?? "",
        start_date:  initialData.start_date  ?? "",
        end_date:    initialData.end_date    ?? null,
        is_current:  initialData.is_current  ?? false,
      } : empty);
    }
  }, [isOpen, initialData]);

  const handleClose = () => { setForm(empty); onClose(); };
  const handleSave = () => {
    if (!form.company.trim() || !form.title.trim() || !form.start_date) return;
    onSave({ ...form, end_date: form.is_current ? null : (form.end_date || null) });
  };

  const cls = "w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#ff9933]/50";

  return (
    <ProfileModal isOpen={isOpen} onClose={handleClose} title={isEdit ? "Edit Experience" : "Add Work Experience"}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Job Title <span className="text-red-400">*</span></label>
            <input value={form.title} onChange={e => set("title", e.target.value)} className={cls} placeholder="e.g. Senior Engineer" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Company <span className="text-red-400">*</span></label>
            <input value={form.company} onChange={e => set("company", e.target.value)} className={cls} placeholder="e.g. Proyekto Inc." />
          </div>
        </div>

        <div className="flex items-end gap-3">
          <div className="flex-1">
            <label className="block text-xs font-medium text-gray-600 mb-1">Location</label>
            <input value={form.location ?? ""} onChange={e => set("location", e.target.value)} disabled={form.is_remote} className={`${cls} disabled:opacity-50`} placeholder="e.g. Cebu, Philippines" />
          </div>
          <label className="flex items-center gap-2 mb-2 cursor-pointer shrink-0">
            <input type="checkbox" checked={form.is_remote} onChange={e => set("is_remote", e.target.checked)} className="w-4 h-4 accent-[#ff9933]" />
            <span className="text-sm text-gray-700">Remote</span>
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Start Date <span className="text-red-400">*</span></label>
            <input type="month" value={form.start_date?.slice(0, 7) ?? ""} onChange={e => set("start_date", e.target.value ? e.target.value + "-01" : "")} className={cls} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">End Date</label>
            <input type="month" value={form.end_date?.slice(0, 7) ?? ""} onChange={e => set("end_date", e.target.value ? e.target.value + "-01" : null)} disabled={form.is_current} className={`${cls} disabled:opacity-50`} />
          </div>
        </div>

        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={form.is_current} onChange={e => set("is_current", e.target.checked)} className="w-4 h-4 accent-[#ff9933]" />
          <span className="text-sm text-gray-700">I currently work here</span>
        </label>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Description</label>
          <textarea value={form.description ?? ""} onChange={e => set("description", e.target.value)} rows={4} className={`${cls} resize-y`} placeholder="Key responsibilities and achievements..." />
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <button onClick={handleClose} className="px-5 py-2 text-sm border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50 transition-colors">Cancel</button>
          <button
            onClick={handleSave}
            disabled={isSaving || !form.company.trim() || !form.title.trim() || !form.start_date}
            className="px-5 py-2 text-sm bg-[#ff9933] text-white rounded-lg hover:bg-[#e68829] disabled:opacity-60 transition-colors flex items-center gap-2"
          >
            {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Briefcase className="w-3.5 h-3.5" />}
            {isSaving ? "Saving…" : isEdit ? "Save Changes" : "Add Experience"}
          </button>
        </div>
      </div>
    </ProfileModal>
  );
}
