import { createFileRoute, useNavigate, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { ModalPortal } from "@/components/common/ModalPortal";
import {
  Check, Loader2, ExternalLink, Globe, Edit2, Plus, Trash2,
  Briefcase, GraduationCap, BadgeCheck, ShieldCheck,
  Globe as LangIcon, BookOpen, Building2, UserCheck,
} from "lucide-react";
import {
  profileService,
  applicationService,
  type UserExperience,
  type UserEducation,
  type UserLicense,
  type UserLanguage,
  type FullProfile,
} from "@/services/profile.service";
import { uploadService } from "@/services/upload.service";
import { useAuthStore } from "@/stores/authStore";
import { ExperienceModal } from "@/components/profile/ExperienceModal";
import { EducationModal } from "@/components/profile/EducationModal";
import { LicenseModal } from "@/components/profile/LicenseModal";
import { LanguageModal } from "@/components/profile/LanguageModal";
import { IdentityDocumentModal } from "@/components/profile/IdentityDocumentModal";
import { useToast } from "@/hooks/useToast";

// ─── Route ────────────────────────────────────────────────────────────────────
export const Route = createFileRoute("/consultant/apply")({
  beforeLoad: () => {
    const { isAuthenticated } = useAuthStore.getState();
    if (!isAuthenticated) throw redirect({ to: "/auth/login" });
  },
  component: ConsultantApplyPage,
});

const profileKeys = { full: (id: string) => ["full-profile", id] as const };

// ─── Form data type (declared first so all step components can reference it) ───
interface FormData2 {
  years_of_experience: string;
  primary_niche: string;
  custom_niche: string;
  cover_letter: string;
  why_join: string;
  linkedin_url: string;
  website_url: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtDate(iso: string | null | undefined) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short" });
}

function EmptySlate({ message, onAdd }: { message: string; onAdd: () => void }) {
  return (
    <button
      onClick={onAdd}
      className="w-full flex items-center gap-2 px-4 py-3 border border-dashed border-gray-300 rounded-xl text-sm text-gray-400 hover:border-slate-900 hover:text-slate-900 hover:bg-slate-50 transition-all"
    >
      <Plus className="w-4 h-4" /> {message}
    </button>
  );
}

function SectionHeader({ title, icon: Icon, onAdd }: { title: string; icon: React.ElementType; onAdd: () => void }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <div className="flex items-center gap-2">
        <Icon className="w-4 h-4 text-gray-900" strokeWidth={2.5} />
        <h3 className="text-sm font-bold text-gray-900">{title}</h3>
      </div>
      <button onClick={onAdd} className="p-1.5 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-900 transition-colors" title={`Add ${title}`}>
        <Plus className="w-4 h-4" />
      </button>
    </div>
  );
}

// ─── STEP 1: Identity ─────────────────────────────────────────────────────────
function Step1Identity({
  profile, profileId, qc,
}: { profile: FullProfile; profileId: string; qc: ReturnType<typeof useQueryClient> }) {
  const [idDocModalOpen, setIdDocModalOpen] = useState(false);

  const addIdentityDoc = useMutation({
    mutationFn: async ({ payload, file }: { payload: any; file: File }) => {
      const storage_path = await uploadService.upload("identity_documents" as any, file);
      return profileService.addIdentityDocument({ ...payload, storage_path });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: profileKeys.full(profileId) }); setIdDocModalOpen(false); },
  });
  const deleteIdentityDoc = useMutation({
    mutationFn: profileService.deleteIdentityDocument.bind(profileService),
    onSuccess: () => qc.invalidateQueries({ queryKey: profileKeys.full(profileId) }),
  });

  const docs = profile.identity_documents ?? [];
  const DOC_TYPE_LABELS: Record<string, string> = {
    passport: "Passport",
    national_id: "National ID",
    drivers_license: "Driver's License",
    residence_permit: "Residence Permit",
    other: "Other",
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        Upload a government-issued photo ID to begin the verification process. Your documents are stored securely and only accessible to authorized admin staff.
      </p>

      {docs.length > 0 && (
        <div className="space-y-3">
          {docs.map(doc => (
            <div key={doc.id} className="flex items-center gap-4 p-4 bg-white border border-gray-200 rounded-xl group">
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${doc.is_verified ? "bg-green-100" : "bg-gray-100"}`}>
                <ShieldCheck className={`w-5 h-5 ${doc.is_verified ? "text-green-600" : "text-gray-400"}`} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-900">{DOC_TYPE_LABELS[doc.type] ?? doc.type}</p>
                <p className="text-xs text-gray-400">
                  {doc.is_verified ? "✓ Verified" : "Pending verification"} · Uploaded {fmtDate(doc.uploaded_at ?? doc.created_at)}
                </p>
              </div>
              <button
                onClick={() => deleteIdentityDoc.mutate(doc.id)}
                disabled={deleteIdentityDoc.isPending}
                className="p-1.5 text-gray-300 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all rounded-lg hover:bg-red-50"
              >
                {deleteIdentityDoc.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
              </button>
            </div>
          ))}
        </div>
      )}

      <EmptySlate message="Add identity document" onAdd={() => setIdDocModalOpen(true)} />

      <IdentityDocumentModal
        isOpen={idDocModalOpen}
        onClose={() => setIdDocModalOpen(false)}
        onSave={(payload, file) => addIdentityDoc.mutate({ payload, file })}
        isSaving={addIdentityDoc.isPending}
      />

      {docs.length === 0 && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-700">
          <strong>Tip:</strong> Adding at least one verified identity document significantly improves your application approval rate.
        </div>
      )}
    </div>
  );
}

// ─── STEP 2: Experience & Niche ────────────────────────────────────────────────
const NICHES = [
  { value: "fintech", label: "Fintech" }, { value: "healthcare", label: "Healthcare" },
  { value: "e_commerce", label: "E-Commerce" }, { value: "saas", label: "SaaS" },
  { value: "education", label: "Education" }, { value: "real_estate", label: "Real Estate" },
  { value: "legal", label: "Legal" }, { value: "marketing", label: "Marketing" },
  { value: "logistics", label: "Logistics" }, { value: "media", label: "Media" },
  { value: "gaming", label: "Gaming" }, { value: "ai_ml", label: "AI / ML" },
  { value: "cybersecurity", label: "Cybersecurity" }, { value: "blockchain", label: "Blockchain" },
  { value: "other", label: "Other" },
];

function TileOption({ name, value, label, checked, onChange, description }: {
  name: string; value: string; label: string; checked: boolean; onChange: () => void; description?: string;
}) {
  return (
    <label className={`flex items-start gap-3 px-4 py-3 rounded-xl border cursor-pointer transition-all ${checked ? "border-slate-900 bg-slate-50 shadow-sm" : "border-slate-200 bg-white hover:border-slate-300"}`}>
      <input type="radio" name={name} value={value} checked={checked} onChange={onChange} className="mt-0.5 w-4 h-4 accent-slate-900 shrink-0" />
      <div>
        <p className="text-sm font-semibold text-slate-900">{label}</p>
        {description && <p className="text-xs text-gray-500 mt-0.5">{description}</p>}
      </div>
    </label>
  );
}

function Step2ExperienceNiche({ formData, updateFormData }: { formData: FormData2; updateFormData: (u: Partial<FormData2>) => void }) {
  return (
    <div className="space-y-6">
      <div>
        <label className="block text-sm font-semibold text-slate-900 mb-2">Years of Professional Experience <span className="text-red-500">*</span></label>
        <div className="grid grid-cols-2 gap-3">
          {[
            { value: "0", label: "Less than 1 year" },
            { value: "2", label: "1 – 3 years" },
            { value: "4", label: "3 – 5 years" },
            { value: "7", label: "5 – 10 years" },
            { value: "12", label: "10+ years" },
          ].map(opt => (
            <TileOption key={opt.value} name="exp_range" value={opt.value} label={opt.label}
              checked={formData.years_of_experience === opt.value} onChange={() => updateFormData({ years_of_experience: opt.value })} />
          ))}
        </div>
      </div>
      <div>
        <label className="block text-sm font-semibold text-slate-900 mb-2">Primary Industry / Niche <span className="text-red-500">*</span></label>
        <div className="grid grid-cols-3 gap-2">
          {NICHES.map(n => (
            <TileOption key={n.value} name="niche" value={n.value} label={n.label}
              checked={formData.primary_niche === n.value} onChange={() => updateFormData({ primary_niche: n.value, custom_niche: "" })} />
          ))}
        </div>
        {/* Custom niche input — shown only when "Other" is selected */}
        {formData.primary_niche === "other" && (
          <div className="mt-3">
            <input
              type="text"
              placeholder="Describe your industry or niche..."
              value={formData.custom_niche ?? ""}
              onChange={e => updateFormData({ custom_niche: e.target.value })}
              className="w-full px-4 py-2.5 bg-white border border-slate-900 rounded-xl text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/15 focus:border-transparent shadow-sm"
              autoFocus
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ─── STEP 3: Profile Sections ─────────────────────────────────────────────────
function Step3Profile({
  profile, profileId, qc,
}: { profile: FullProfile; profileId: string; qc: ReturnType<typeof useQueryClient> }) {
  // — Languages —
  const [langModalOpen, setLangModalOpen] = useState(false);
  const [editingLang, setEditingLang] = useState<UserLanguage | null>(null);
  const addLanguage    = useMutation({ mutationFn: profileService.addLanguage.bind(profileService),    onSuccess: () => { qc.invalidateQueries({ queryKey: profileKeys.full(profileId) }); setLangModalOpen(false); } });
  const updateLanguage = useMutation({ mutationFn: ({ id, payload }: { id: string; payload: any }) => profileService.updateLanguage(id, payload), onSuccess: () => { qc.invalidateQueries({ queryKey: profileKeys.full(profileId) }); setLangModalOpen(false); setEditingLang(null); } });
  const deleteLanguage = useMutation({ mutationFn: profileService.deleteLanguage.bind(profileService), onSuccess: () => qc.invalidateQueries({ queryKey: profileKeys.full(profileId) }) });

  // — Experience —
  const [expModalOpen, setExpModalOpen]   = useState(false);
  const [editingExp,   setEditingExp]     = useState<UserExperience | null>(null);
  const addExperience    = useMutation({ mutationFn: profileService.addExperience.bind(profileService),    onSuccess: () => { qc.invalidateQueries({ queryKey: profileKeys.full(profileId) }); setExpModalOpen(false); } });
  const updateExperience = useMutation({ mutationFn: ({ id, payload }: { id: string; payload: any }) => profileService.updateExperience(id, payload), onSuccess: () => { qc.invalidateQueries({ queryKey: profileKeys.full(profileId) }); setExpModalOpen(false); setEditingExp(null); } });
  const deleteExperience = useMutation({ mutationFn: profileService.deleteExperience.bind(profileService), onSuccess: () => qc.invalidateQueries({ queryKey: profileKeys.full(profileId) }) });

  // — Education —
  const [eduModalOpen, setEduModalOpen]   = useState(false);
  const [editingEdu,   setEditingEdu]     = useState<UserEducation | null>(null);
  const addEducation    = useMutation({ mutationFn: profileService.addEducation.bind(profileService),    onSuccess: () => { qc.invalidateQueries({ queryKey: profileKeys.full(profileId) }); setEduModalOpen(false); } });
  const updateEducation = useMutation({ mutationFn: ({ id, payload }: { id: string; payload: any }) => profileService.updateEducation(id, payload), onSuccess: () => { qc.invalidateQueries({ queryKey: profileKeys.full(profileId) }); setEduModalOpen(false); setEditingEdu(null); } });
  const deleteEducation = useMutation({ mutationFn: profileService.deleteEducation.bind(profileService), onSuccess: () => qc.invalidateQueries({ queryKey: profileKeys.full(profileId) }) });

  // — Licenses —
  const [licModalOpen, setLicModalOpen]   = useState(false);
  const [editingLic,   setEditingLic]     = useState<UserLicense | null>(null);
  const addLicense    = useMutation({ mutationFn: profileService.addLicense.bind(profileService),    onSuccess: () => { qc.invalidateQueries({ queryKey: profileKeys.full(profileId) }); setLicModalOpen(false); } });
  const updateLicense = useMutation({ mutationFn: ({ id, payload }: { id: string; payload: any }) => profileService.updateLicense(id, payload), onSuccess: () => { qc.invalidateQueries({ queryKey: profileKeys.full(profileId) }); setLicModalOpen(false); setEditingLic(null); } });
  const deleteLicense = useMutation({ mutationFn: profileService.deleteLicense.bind(profileService), onSuccess: () => qc.invalidateQueries({ queryKey: profileKeys.full(profileId) }) });

  const metaQuery = useQuery({
    queryKey: ["profileMeta"],
    queryFn: async () => {
      const [skills, languages] = await Promise.all([profileService.getAllSkills(), profileService.getAllLanguages()]);
      return { skills, languages };
    },
    staleTime: 1000 * 60 * 60,
  });

  return (
    <div className="space-y-8">

      {/* Languages */}
      <div>
        <SectionHeader title="Languages" icon={LangIcon} onAdd={() => { setEditingLang(null); setLangModalOpen(true); }} />
        {profile.languages.length > 0 ? (
          <div className="space-y-2">
            {profile.languages.map(lang => (
              <div key={lang.id} className="flex items-center gap-3 px-4 py-3 bg-white border border-gray-200 rounded-xl group">
                <div className="flex-1">
                  <p className="text-sm font-semibold text-gray-900">{lang.language?.name ?? lang.language_id}</p>
                  <p className="text-xs text-gray-400 capitalize">{lang.fluency_level?.replace("_", " ")}</p>
                </div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-all shrink-0">
                  <button onClick={() => { setEditingLang(lang); setLangModalOpen(true); }} className="p-1 rounded text-gray-300 hover:text-slate-900 hover:bg-slate-100 transition-colors"><Edit2 className="w-3.5 h-3.5" /></button>
                  <button onClick={() => deleteLanguage.mutate(lang.id)} className="p-1 rounded text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors">
                    {deleteLanguage.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : <EmptySlate message="Add a language" onAdd={() => { setEditingLang(null); setLangModalOpen(true); }} />}
      </div>

      {/* Experience */}
      <div>
        <SectionHeader title="Work Experience" icon={Briefcase} onAdd={() => { setEditingExp(null); setExpModalOpen(true); }} />
        {profile.experiences.length > 0 ? (
          <div className="relative">
            <div className="absolute left-[18px] top-2 bottom-2 w-px bg-gray-200" />
            <div className="space-y-0">
              {profile.experiences.map(exp => (
                <div key={exp.id} className="relative flex items-start gap-4 pl-10 pb-6 last:pb-0 group">
                  <div className="absolute left-0 top-1 w-9 h-9 rounded-full bg-white border-2 border-gray-900 flex items-center justify-center shrink-0 shadow-sm">
                    <Building2 className="w-4 h-4 text-gray-900" strokeWidth={2.5} />
                  </div>
                  <div className="flex-1 min-w-0 pt-1">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-bold text-gray-900 text-sm">{exp.title}</p>
                        <p className="text-gray-600 text-sm">{exp.company}</p>
                        <p className="text-gray-400 text-xs mt-0.5">
                          {fmtDate(exp.start_date)} – {exp.is_current ? "Present" : fmtDate(exp.end_date)}
                          {exp.location && !exp.is_remote && ` · ${exp.location}`}
                          {exp.is_remote && " · Remote"}
                        </p>
                      </div>
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-all shrink-0">
                        <button onClick={() => { setEditingExp(exp); setExpModalOpen(true); }} className="p-1 rounded text-gray-300 hover:text-slate-900 hover:bg-slate-100 transition-colors"><Edit2 className="w-3.5 h-3.5" /></button>
                        <button onClick={() => deleteExperience.mutate(exp.id)} className="p-1 rounded text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors">
                          {deleteExperience.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </div>
                    {exp.description && <p className="text-gray-500 text-sm mt-1.5 leading-relaxed">{exp.description}</p>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : <EmptySlate message="Add work experience" onAdd={() => { setEditingExp(null); setExpModalOpen(true); }} />}
      </div>

      {/* Education */}
      <div>
        <SectionHeader title="Education" icon={GraduationCap} onAdd={() => { setEditingEdu(null); setEduModalOpen(true); }} />
        {profile.educations.length > 0 ? (
          <div className="space-y-3">
            {profile.educations.map(edu => (
              <div key={edu.id} className="flex items-start gap-4 p-4 bg-white border border-gray-200 rounded-xl group">
                <div className="w-10 h-10 rounded-lg border-2 border-gray-900 flex items-center justify-center shrink-0 bg-white shadow-sm">
                  <BookOpen className="w-5 h-5 text-gray-900" strokeWidth={2.5} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-gray-900 text-sm">{edu.institution}</p>
                  <p className="text-gray-600 text-sm">{[edu.degree, edu.field_of_study].filter(Boolean).join(" · ")}</p>
                  {(edu.start_year || edu.end_year) && (
                    <p className="text-gray-400 text-xs mt-0.5">
                      {edu.start_year}{edu.end_year && ` – ${edu.is_current ? "Present" : edu.end_year}`}
                    </p>
                  )}
                </div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-all shrink-0">
                  <button onClick={() => { setEditingEdu(edu); setEduModalOpen(true); }} className="p-1 rounded text-gray-300 hover:text-slate-900 hover:bg-slate-100 transition-colors"><Edit2 className="w-3.5 h-3.5" /></button>
                  <button onClick={() => deleteEducation.mutate(edu.id)} className="p-1 rounded text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors">
                    {deleteEducation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : <EmptySlate message="Add education" onAdd={() => { setEditingEdu(null); setEduModalOpen(true); }} />}
      </div>

      {/* Licenses */}
      <div>
        <SectionHeader title="Licenses" icon={BadgeCheck} onAdd={() => { setEditingLic(null); setLicModalOpen(true); }} />
        {profile.licenses.length > 0 ? (
          <div className="space-y-3">
            {profile.licenses.map(lic => (
              <div key={lic.id} className="flex items-start gap-4 p-4 bg-white border border-gray-200 rounded-xl group">
                <div className="w-10 h-10 rounded-lg bg-indigo-50 flex items-center justify-center shrink-0">
                  <ShieldCheck className="w-5 h-5 text-indigo-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-gray-900 text-sm">{lic.name}</p>
                  <p className="text-gray-600 text-sm">{lic.issuing_authority}</p>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-400 mt-0.5">
                    {lic.issue_date && <span>Issued: {fmtDate(lic.issue_date)}</span>}
                    {lic.expiry_date && <span>Expires: {fmtDate(lic.expiry_date)}</span>}
                    {lic.license_number && <span>ID: {lic.license_number}</span>}
                  </div>
                </div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-all shrink-0">
                  <button onClick={() => { setEditingLic(lic); setLicModalOpen(true); }} className="p-1 rounded text-gray-300 hover:text-slate-900 hover:bg-slate-100 transition-colors"><Edit2 className="w-3.5 h-3.5" /></button>
                  <button onClick={() => deleteLicense.mutate(lic.id)} className="p-1 rounded text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors">
                    {deleteLicense.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : <EmptySlate message="Add a license" onAdd={() => { setEditingLic(null); setLicModalOpen(true); }} />}
      </div>

      {/* Modals */}
      <LanguageModal
        isOpen={langModalOpen}
        onClose={() => { setLangModalOpen(false); setEditingLang(null); }}
        initialData={editingLang ?? undefined}
        languagesMeta={metaQuery.data?.languages ?? []}
        onSave={payload => { if (editingLang) updateLanguage.mutate({ id: editingLang.id, payload }); else addLanguage.mutate(payload as any); }}
        isSaving={editingLang ? updateLanguage.isPending : addLanguage.isPending}
      />
      <ExperienceModal
        isOpen={expModalOpen}
        onClose={() => { setExpModalOpen(false); setEditingExp(null); }}
        initialData={editingExp ?? undefined}
        onSave={payload => { if (editingExp) updateExperience.mutate({ id: editingExp.id, payload }); else addExperience.mutate(payload as any); }}
        isSaving={editingExp ? updateExperience.isPending : addExperience.isPending}
      />
      <EducationModal
        isOpen={eduModalOpen}
        onClose={() => { setEduModalOpen(false); setEditingEdu(null); }}
        initialData={editingEdu ?? undefined}
        onSave={payload => { if (editingEdu) updateEducation.mutate({ id: editingEdu.id, payload }); else addEducation.mutate(payload as any); }}
        isSaving={editingEdu ? updateEducation.isPending : addEducation.isPending}
      />
      <LicenseModal
        isOpen={licModalOpen}
        onClose={() => { setLicModalOpen(false); setEditingLic(null); }}
        initialData={editingLic ?? undefined}
        onSave={payload => { if (editingLic) updateLicense.mutate({ id: editingLic.id, payload }); else addLicense.mutate(payload as any); }}
        isSaving={editingLic ? updateLicense.isPending : addLicense.isPending}
      />
    </div>
  );
}

// ─── STEP 4: Cover Letter ─────────────────────────────────────────────────────
function Step4CoverLetter({ formData, updateFormData }: { formData: FormData2; updateFormData: (u: Partial<FormData2>) => void }) {
  return (
    <div className="space-y-6">
      <div>
        <label className="block text-sm font-semibold text-slate-900 mb-2">Cover Letter <span className="text-red-500">*</span></label>
        <p className="text-xs text-slate-600 mb-3">Tell us about your professional background and why you'd be a great consultant on this platform. Mention specific outcomes, industries, or methodologies you specialise in.</p>
        <textarea
          rows={11}
          placeholder="I have X years of experience in [sector] leading teams to deliver [outcomes]. My core strengths include..."
          value={formData.cover_letter}
          onChange={e => updateFormData({ cover_letter: e.target.value })}
          className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/15 focus:border-transparent resize-none shadow-sm"
        />
        <p className="text-right text-xs text-gray-400 mt-1">{formData.cover_letter.length} / 2000</p>
      </div>
      <div>
        <label className="block text-sm font-semibold text-slate-900 mb-2">Why do you want to join as a Consultant?</label>
        <textarea
          rows={4}
          placeholder="I want to help early-stage companies solve..."
          value={formData.why_join}
          onChange={e => updateFormData({ why_join: e.target.value })}
          className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/15 focus:border-transparent resize-none shadow-sm"
        />
      </div>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────
function plural(count: number, singular: string, pluralForm?: string) {
  return count === 1 ? `1 ${singular}` : `${count} ${pluralForm ?? singular + "s"}`;
}

// ─── STEP 5: Links & Review ───────────────────────────────────────────────────
function Step5LinksReview({ formData, updateFormData, profile }: { formData: FormData2; updateFormData: (u: Partial<FormData2>) => void; profile: FullProfile }) {
  // Show custom niche text when "other" is selected, otherwise use the label
  const nicheLabel = formData.primary_niche === "other"
    ? formData.custom_niche || "Other"
    : NICHES.find(n => n.value === formData.primary_niche)?.label ?? "—";

  const ReviewRow = ({ label, value }: { label: string; value: string }) => (
    <div className="flex gap-3 text-sm py-1.5 border-b border-gray-100 last:border-0">
      <span className="text-slate-600 w-36 shrink-0">{label}</span>
      <span className="text-slate-900 font-medium flex-1 truncate">{value || "—"}</span>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-semibold text-slate-900 mb-2">LinkedIn Profile URL (Optional)</label>
          <div className="relative">
            <ExternalLink className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input type="url" placeholder="https://linkedin.com/in/yourname" value={formData.linkedin_url} onChange={e => updateFormData({ linkedin_url: e.target.value })}
              className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-900/15 focus:border-transparent shadow-sm" />
          </div>
        </div>
        <div>
          <label className="block text-sm font-semibold text-slate-900 mb-2">Personal Website / Portfolio (Optional)</label>
          <div className="relative">
            <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input type="url" placeholder="https://yourwebsite.com" value={formData.website_url} onChange={e => updateFormData({ website_url: e.target.value })}
              className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-900/15 focus:border-transparent shadow-sm" />
          </div>
        </div>
      </div>

      <div className="border-t border-gray-100 pt-5">
        <p className="text-sm font-semibold text-slate-900 mb-3">Application Summary</p>
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-0">
          <ReviewRow label="Applicant" value={profile.display_name ?? `${profile.first_name} ${profile.last_name}`} />
          <ReviewRow label="Primary Niche" value={nicheLabel} />
          <ReviewRow label="Experience" value={formData.years_of_experience ? `${formData.years_of_experience}+ years` : "—"} />
          <ReviewRow label="Identity Docs" value={plural(profile.identity_documents?.length ?? 0, "uploaded", "uploaded")} />
          <ReviewRow label="Languages" value={plural(profile.languages.length, "language")} />
          <ReviewRow label="Work Experience" value={plural(profile.experiences.length, "entry", "entries")} />
          <ReviewRow label="Education" value={plural(profile.educations.length, "entry", "entries")} />
          <ReviewRow label="Licenses" value={plural(profile.licenses.length, "license")} />
          <ReviewRow label="Cover Letter" value={formData.cover_letter ? `${formData.cover_letter.length} characters` : "—"} />
          <ReviewRow label="LinkedIn" value={formData.linkedin_url} />
          <ReviewRow label="Website" value={formData.website_url} />
        </div>
        <p className="text-xs text-slate-600 mt-3">
          Our team will manually review your profile within <strong>3–5 business days</strong>. Applications can only be submitted once — ensure all information is accurate.
        </p>
      </div>
    </div>
  );
}

// ─── Form data type (kept here as alias for readability) ───
// See declaration above profileKeys

// ─── Step meta ────────────────────────────────────────────────────────────────
const STEP_META = [
  { label: "Identity" },
  { label: "Experience" },
  { label: "Profile" },
  { label: "Cover Letter" },
  { label: "Links & Review" },
];

const STEP_DESCRIPTIONS = [
  {
    title: "Step 1: Identity Verification",
    body: "Upload a government-issued photo ID to verify your identity. This is a mandatory part of the vetting process and helps build trust with clients.",
  },
  {
    title: "Step 2: Experience & Niche",
    body: "Tell us how long you've been working professionally and which industry you specialise in. This helps us match you to the right projects.",
  },
  {
    title: "Step 3: Your Profile",
    body: "Add or update your languages, work experience, education, and professional licenses. These are saved directly to your profile.",
  },
  {
    title: "Step 4: Cover Letter",
    body: "Write a compelling summary of your professional background and explain why you'd be a great fit as a consultant on this platform.",
  },
  {
    title: "Step 5: Links & Review",
    body: "Share your online presence and review your application before submitting. Our admin team will get back to you within 3–5 business days.",
  },
];

// ─── Main Page ────────────────────────────────────────────────────────────────
function ConsultantApplyPage() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const qc = useQueryClient();
  const toast = useToast();
  const [currentStep, setCurrentStep] = useState(1);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [hasHydratedDraft, setHasHydratedDraft] = useState(false);
  const [formData, setFormData] = useState<FormData2>({
    years_of_experience: "",
    primary_niche: "",
    custom_niche: "",
    cover_letter: "",
    why_join: "",
    linkedin_url: "",
    website_url: "",
  });

  const updateFormData = (updates: Partial<FormData2>) => setFormData(prev => ({ ...prev, ...updates }));

  const { data: profile, isLoading: profileLoading } = useQuery({
    queryKey: profileKeys.full(user?.id ?? ""),
    queryFn: () => profileService.getProfile(user!.id),
    enabled: !!user?.id,
  });

  const { data: existingApp, isLoading: appLoading } = useQuery({
    queryKey: ["myApplication"],
    queryFn: () => applicationService.getMyApplication(),
    enabled: !!user?.id,
  });

  useEffect(() => {
    if (hasHydratedDraft || !existingApp || existingApp.status !== "draft") {
      return;
    }

    const knownNicheValues = new Set(NICHES.map((n) => n.value));
    const draftNiche = existingApp.primary_niche?.trim() ?? "";
    const isKnownNiche = knownNicheValues.has(draftNiche);

    setFormData((prev) => ({
      ...prev,
      years_of_experience:
        existingApp.years_of_experience !== null &&
        existingApp.years_of_experience !== undefined
          ? String(existingApp.years_of_experience)
          : "",
      primary_niche: draftNiche
        ? isKnownNiche
          ? draftNiche
          : "other"
        : "",
      custom_niche: draftNiche && !isKnownNiche ? draftNiche : "",
      cover_letter: existingApp.cover_letter ?? "",
      why_join: existingApp.why_join ?? "",
      linkedin_url: existingApp.linkedin_url ?? "",
      website_url: existingApp.website_url ?? "",
    }));

    setHasHydratedDraft(true);
  }, [existingApp, hasHydratedDraft]);

  const submitApp = useMutation({
    mutationFn: async () => {
      await applicationService.saveDraft({
        cover_letter: formData.cover_letter,
        years_of_experience: parseInt(formData.years_of_experience) || 0,
        primary_niche: formData.primary_niche === "other" && formData.custom_niche
          ? formData.custom_niche
          : formData.primary_niche || null,
        linkedin_url: formData.linkedin_url || null,
        website_url: formData.website_url || null,
        why_join: formData.why_join || null,
      });
      return applicationService.submit();
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["myApplication"] });
      setShowSuccessModal(true);
    },
    onError: (error) => {
      const message =
        (error as { response?: { data?: { message?: string | string[] } } })
          ?.response?.data?.message ??
        (error instanceof Error ? error.message : "Failed to submit application");

      toast.error(Array.isArray(message) ? message.join(", ") : message);
    },
  });

  const canNext = (step: number) => {
    if (step === 1) return true;
    if (step === 2) {
      const nicheOk = formData.primary_niche === "other"
        ? !!formData.custom_niche.trim()
        : !!formData.primary_niche;
      return !!formData.years_of_experience && nicheOk;
    }
    if (step === 3) return true;
    if (step === 4) return formData.cover_letter.trim().length >= 50;
    return true;
  };

  if (profileLoading || appLoading) return (
    <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-slate-900" />
    </div>
  );

  if (existingApp && existingApp.status !== "draft") {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <div className="max-w-xl mx-auto px-6 py-24 text-center">
          <div className="w-14 h-14 rounded-2xl border border-amber-200 bg-amber-50 flex items-center justify-center mx-auto mb-5 shadow-[0_8px_18px_rgba(245,158,11,0.12)]">
            <UserCheck className="w-7 h-7 text-amber-600" />
          </div>
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-slate-900 mb-3">
            {existingApp.status === "approved" ? "You're a verified consultant!" :
             existingApp.status === "rejected" ? "Application not approved" :
             "Application under review"}
          </h1>
          <p className="text-slate-600 mb-6">Status: <strong className="capitalize text-slate-900">{existingApp.status.replace("_", " ")}</strong></p>
          {existingApp.rejection_reason && (
            <div className="bg-red-50 border border-red-200 rounded-xl text-sm text-red-700 p-4 mb-6 text-left">
              <strong>Reason:</strong> {existingApp.rejection_reason}
            </div>
          )}
          <button onClick={() => navigate({ to: "/dashboard" })} className="rounded-xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white shadow-[0_14px_30px_rgba(15,23,42,0.26)] hover:bg-slate-800 transition-colors">
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  const desc = STEP_DESCRIPTIONS[currentStep - 1];

  return (
    <div className="relative min-h-screen overflow-hidden bg-background text-foreground">

      {/* Soft ambient blurs — matches /welcome and /consultant landing */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-20 left-[10%] h-72 w-72 rounded-full bg-amber-200/35 blur-3xl" />
        <div className="absolute -right-12 top-1/3 h-72 w-72 rounded-full bg-indigo-200/40 blur-3xl" />
        <div className="absolute bottom-10 left-1/4 h-80 w-80 rounded-full bg-cyan-200/25 blur-3xl" />
      </div>

      <div className="max-w-[1280px] mx-auto px-6 sm:px-10 lg:px-16 pt-10 pb-40 relative z-10">

        {/* Slate dot stepper — matches /welcome */}
        <div className="mx-auto mb-12 flex max-w-3xl items-center gap-3">
          <div className="flex flex-1 items-center gap-2">
            {STEP_META.map((_, i) => (
              <div
                key={i}
                className={`h-1.5 flex-1 rounded-full transition-colors ${
                  i + 1 <= currentStep ? "bg-slate-900" : "bg-slate-200"
                }`}
              />
            ))}
          </div>
          <span className="shrink-0 text-xs font-semibold text-slate-500">
            Step {currentStep} of {STEP_META.length}
          </span>
        </div>

        {/* Two-column layout */}
        <div className="grid grid-cols-[380px_1fr] gap-12">
          {/* Left: sticky description */}
          <div className="relative">
            <div className="sticky top-[120px]">
              <AnimatePresence mode="wait">
                <motion.div key={currentStep} initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.4, ease: "easeOut" }}>
                  <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-slate-900 mb-4 leading-tight">{desc.title}</h1>
                  <p className="text-slate-600 text-base leading-relaxed">{desc.body}</p>
                </motion.div>
              </AnimatePresence>
            </div>
          </div>

          {/* Right: form */}
          <div className="min-h-[500px]">
            <AnimatePresence mode="wait">
              {currentStep === 1 && profile && (
                <motion.div key="s1" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} transition={{ duration: 0.4, ease: "easeOut" }}>
                  <Step1Identity profile={profile as any} profileId={user!.id} qc={qc} />
                </motion.div>
              )}
              {currentStep === 2 && (
                <motion.div key="s2" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} transition={{ duration: 0.4, ease: "easeOut" }}>
                  <Step2ExperienceNiche formData={formData} updateFormData={updateFormData} />
                </motion.div>
              )}
              {currentStep === 3 && profile && (
                <motion.div key="s3" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} transition={{ duration: 0.4, ease: "easeOut" }}>
                  <Step3Profile profile={profile as any} profileId={user!.id} qc={qc} />
                </motion.div>
              )}
              {currentStep === 4 && (
                <motion.div key="s4" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} transition={{ duration: 0.4, ease: "easeOut" }}>
                  <Step4CoverLetter formData={formData} updateFormData={updateFormData} />
                </motion.div>
              )}
              {currentStep === 5 && profile && (
                <motion.div key="s5" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} transition={{ duration: 0.4, ease: "easeOut" }}>
                  <Step5LinksReview formData={formData} updateFormData={updateFormData} profile={profile as any} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* Fixed bottom nav */}
      <div className="fixed bottom-0 left-0 right-0 z-50 pointer-events-none pb-8 pt-6 bg-linear-to-t from-[#fcfcfd] via-[#fcfcfd]/85 to-transparent">
        <div className="max-w-[1280px] mx-auto px-6 sm:px-10 lg:px-16 flex justify-between gap-3">
          <button
            onClick={() => setCurrentStep(s => Math.max(s - 1, 1))}
            disabled={currentStep === 1}
            className="pointer-events-auto cursor-pointer inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 transition-all hover:border-slate-900 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Back
          </button>
          {currentStep < 5 ? (
            <button
              onClick={() => setCurrentStep(s => Math.min(s + 1, 5))}
              disabled={!canNext(currentStep)}
              className="pointer-events-auto cursor-pointer rounded-xl bg-slate-900 px-6 py-2.5 text-sm font-semibold text-white shadow-[0_14px_30px_rgba(15,23,42,0.26)] transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next
            </button>
          ) : (
            <button
              onClick={() => submitApp.mutate()}
              disabled={submitApp.isPending}
              className="pointer-events-auto cursor-pointer rounded-xl bg-slate-900 px-6 py-2.5 text-sm font-semibold text-white shadow-[0_14px_30px_rgba(15,23,42,0.26)] transition-colors hover:bg-slate-800 flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitApp.isPending ? <><Loader2 className="w-4 h-4 animate-spin" /> Submitting…</> : <><Check className="w-4 h-4" /> Submit application</>}
            </button>
          )}
        </div>
      </div>

      {/* Success Modal */}
      <ModalPortal>
      <AnimatePresence>
        {showSuccessModal && (
          <motion.div className="fixed inset-0 z-[9999] flex items-center justify-center p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowSuccessModal(false)} />
            <motion.div
              className="relative bg-white rounded-2xl shadow-2xl max-w-lg w-full p-8 text-center"
              initial={{ opacity: 0, scale: 0.9, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9, y: 20 }}
              transition={{ duration: 0.3, ease: "easeOut" }}
            >
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Check className="w-8 h-8 text-green-600" />
              </div>
              <h2 className="text-3xl font-bold text-gray-900 mb-2">Application Submitted!</h2>
              <p className="text-gray-600 mb-1">Your application is now under review.</p>
              <p className="text-sm text-gray-400 mb-8">Our admin team will review your profile and supporting evidence. You'll be notified within <strong>3–5 business days</strong>.</p>
              <button onClick={() => { setShowSuccessModal(false); navigate({ to: "/dashboard" }); }}
                className="rounded-xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white shadow-[0_14px_30px_rgba(15,23,42,0.26)] hover:bg-slate-800 transition-colors">
                Back to Dashboard
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      </ModalPortal>
    </div>
  );
}
