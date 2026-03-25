import { createFileRoute, useNavigate, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  Check, Loader2, ExternalLink, Globe, Edit2, Plus, Trash2,
  Briefcase, GraduationCap, BadgeCheck, ShieldCheck,
  Globe as LangIcon, BookOpen, Building2, UserCheck,
} from "lucide-react";
import { StepIndicator } from "@/components/project-brief";
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
      className="w-full flex items-center gap-2 px-4 py-3 border border-dashed border-gray-300 rounded-xl text-sm text-gray-400 hover:border-[#ff9933] hover:text-[#ff9933] hover:bg-orange-50 transition-all"
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
      <button onClick={onAdd} className="p-1.5 rounded-full hover:bg-gray-100 text-gray-400 hover:text-[#ff9933] transition-colors" title={`Add ${title}`}>
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
      <p className="text-sm text-[#61636c]">
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
    <label className={`flex items-start gap-3 px-4 py-3 rounded-xl border cursor-pointer transition-all ${checked ? "border-[#ff9933] bg-[#fff8f0] shadow-sm" : "border-gray-200 bg-white hover:border-gray-300"}`}>
      <input type="radio" name={name} value={value} checked={checked} onChange={onChange} className="mt-0.5 w-4 h-4 accent-[#ff9933] shrink-0" />
      <div>
        <p className="text-sm font-semibold text-[#333438]">{label}</p>
        {description && <p className="text-xs text-gray-500 mt-0.5">{description}</p>}
      </div>
    </label>
  );
}

function Step2ExperienceNiche({ formData, updateFormData }: { formData: FormData2; updateFormData: (u: Partial<FormData2>) => void }) {
  return (
    <div className="space-y-6">
      <div>
        <label className="block text-sm font-semibold text-[#333438] mb-2">Years of Professional Experience <span className="text-red-500">*</span></label>
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
        <label className="block text-sm font-semibold text-[#333438] mb-2">Primary Industry / Niche <span className="text-red-500">*</span></label>
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
              className="w-full px-4 py-2.5 bg-white border border-[#ff9933] rounded-xl text-sm text-[#333438] focus:outline-none focus:ring-2 focus:ring-[#ff9933] focus:border-transparent shadow-sm"
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
                  <button onClick={() => { setEditingLang(lang); setLangModalOpen(true); }} className="p-1 rounded text-gray-300 hover:text-[#ff9933] hover:bg-orange-50 transition-colors"><Edit2 className="w-3.5 h-3.5" /></button>
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
                        <button onClick={() => { setEditingExp(exp); setExpModalOpen(true); }} className="p-1 rounded text-gray-300 hover:text-[#ff9933] hover:bg-orange-50 transition-colors"><Edit2 className="w-3.5 h-3.5" /></button>
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
                  <button onClick={() => { setEditingEdu(edu); setEduModalOpen(true); }} className="p-1 rounded text-gray-300 hover:text-[#ff9933] hover:bg-orange-50 transition-colors"><Edit2 className="w-3.5 h-3.5" /></button>
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
                  <button onClick={() => { setEditingLic(lic); setLicModalOpen(true); }} className="p-1 rounded text-gray-300 hover:text-[#ff9933] hover:bg-orange-50 transition-colors"><Edit2 className="w-3.5 h-3.5" /></button>
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
        <label className="block text-sm font-semibold text-[#333438] mb-2">Cover Letter <span className="text-red-500">*</span></label>
        <p className="text-xs text-[#61636c] mb-3">Tell us about your professional background and why you'd be a great consultant on this platform. Mention specific outcomes, industries, or methodologies you specialise in.</p>
        <textarea
          rows={11}
          placeholder="I have X years of experience in [sector] leading teams to deliver [outcomes]. My core strengths include..."
          value={formData.cover_letter}
          onChange={e => updateFormData({ cover_letter: e.target.value })}
          className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm text-[#333438] focus:outline-none focus:ring-2 focus:ring-[#ff9933] focus:border-transparent resize-none shadow-sm"
        />
        <p className="text-right text-xs text-gray-400 mt-1">{formData.cover_letter.length} / 2000</p>
      </div>
      <div>
        <label className="block text-sm font-semibold text-[#333438] mb-2">Why do you want to join as a Consultant?</label>
        <textarea
          rows={4}
          placeholder="I want to help early-stage companies solve..."
          value={formData.why_join}
          onChange={e => updateFormData({ why_join: e.target.value })}
          className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm text-[#333438] focus:outline-none focus:ring-2 focus:ring-[#ff9933] focus:border-transparent resize-none shadow-sm"
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
      <span className="text-[#61636c] w-36 shrink-0">{label}</span>
      <span className="text-[#333438] font-medium flex-1 truncate">{value || "—"}</span>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-semibold text-[#333438] mb-2">LinkedIn Profile URL (Optional)</label>
          <div className="relative">
            <ExternalLink className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input type="url" placeholder="https://linkedin.com/in/yourname" value={formData.linkedin_url} onChange={e => updateFormData({ linkedin_url: e.target.value })}
              className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#ff9933] focus:border-transparent shadow-sm" />
          </div>
        </div>
        <div>
          <label className="block text-sm font-semibold text-[#333438] mb-2">Personal Website / Portfolio (Optional)</label>
          <div className="relative">
            <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input type="url" placeholder="https://yourwebsite.com" value={formData.website_url} onChange={e => updateFormData({ website_url: e.target.value })}
              className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#ff9933] focus:border-transparent shadow-sm" />
          </div>
        </div>
      </div>

      <div className="border-t border-gray-100 pt-5">
        <p className="text-sm font-semibold text-[#333438] mb-3">Application Summary</p>
        <div className="bg-[#f6f7f8] rounded-xl p-4 space-y-0">
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
        <p className="text-xs text-[#61636c] mt-3">
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
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["myApplication"] });
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
    <div className="min-h-screen bg-[#f6f7f8] flex items-center justify-center">
      <Loader2 className="w-8 h-8 text-[#ff9933] animate-spin" />
    </div>
  );

  if (existingApp && existingApp.status !== "draft") {
    return (
      <div className="min-h-screen bg-[#f6f7f8] ">
        <div className="max-w-xl mx-auto px-6  py-24 text-center">
          <div className="w-16 h-16 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <UserCheck className="w-8 h-8 text-[#ff9933]" />
          </div>
          <h1 className="text-3xl font-bold text-[#333438] mb-3 capitalize">
            {existingApp.status === "approved" ? "You're a verified consultant!" :
             existingApp.status === "rejected" ? "Application Not Approved" :
             "Application Under Review"}
          </h1>
          <p className="text-[#61636c] mb-6">Status: <strong className="capitalize">{existingApp.status.replace("_", " ")}</strong></p>
          {existingApp.rejection_reason && (
            <div className="bg-red-50 border border-red-200 rounded-xl text-sm text-red-700 p-4 mb-6 text-left">
              <strong>Reason:</strong> {existingApp.rejection_reason}
            </div>
          )}
          <button onClick={() => navigate({ to: "/dashboard" })} className="px-8 py-3 bg-[#ff9933] text-white rounded-lg font-semibold hover:bg-[#e8882e] transition-colors">
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  const desc = STEP_DESCRIPTIONS[currentStep - 1];

  return (
    <div className="min-h-screen bg-[#f6f7f8] relative overflow-hidden pt-20">

      {/* Background — same as project-posting */}
      <div className="absolute inset-0 pointer-events-none">
        <motion.svg className="absolute bottom-0 left-0 w-full h-[700px] opacity-30" viewBox="0 0 1440 320" preserveAspectRatio="none"
          animate={{ y: [0, -30, 0] }} transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}>
          <motion.path
            d="M0,96L48,112C96,128,192,160,288,160C384,160,480,128,576,122.7C672,117,768,139,864,144C960,149,1056,139,1152,128C1248,117,1344,107,1392,101.3L1440,96L1440,320L1392,320C1344,320,1248,320,1152,320C1056,320,960,320,864,320C768,320,672,320,576,320C480,320,384,320,288,320C192,320,96,320,48,320L0,320Z"
            fill={currentStep <= 2 ? "#FF9933" : currentStep === 3 ? "#e91e63" : "#8b5cf6"}
            fillOpacity="0.3"
            animate={{ fill: currentStep <= 2 ? "#FF9933" : currentStep === 3 ? "#e91e63" : "#8b5cf6" }}
            transition={{ duration: 0.5, ease: "easeInOut" }}
          />
        </motion.svg>
        <motion.div className="absolute top-20 left-10 w-[400px] h-[400px] bg-[#ff993326] rounded-full blur-3xl opacity-40"
          animate={{ scale: [1, 1.3, 1], x: [0, 50, 0], y: [0, -40, 0] }} transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }} />
        <motion.div className="absolute top-40 right-20 w-[350px] h-[350px] bg-pink-200 rounded-full blur-3xl opacity-30"
          animate={{ scale: [1, 1.4, 1], x: [0, -40, 0], y: [0, 35, 0] }} transition={{ duration: 7, repeat: Infinity, ease: "easeInOut", delay: 0.5 }} />
        <motion.div className="absolute bottom-40 left-1/3 w-[300px] h-[300px] bg-orange-200 rounded-full blur-3xl opacity-25"
          animate={{ scale: [1, 1.5, 1], x: [0, 30, 0], y: [0, -30, 0] }} transition={{ duration: 9, repeat: Infinity, ease: "easeInOut", delay: 1 }} />
      </div>

      <div className="max-w-[1440px] mx-auto px-20 py-8 pb-40 relative z-10">

        {/* Step Indicators */}
        <div className="flex items-center justify-center mb-14 gap-0">
          {STEP_META.map((s, i) => (
            <div key={i} className="flex items-center">
              <StepIndicator step={i + 1} currentStep={currentStep} label={s.label} totalSteps={5} />
              {i < STEP_META.length - 1 && (
                <div className="w-16 h-1 bg-gray-200 rounded-full mx-2 overflow-hidden mt-[-24px]">
                  <motion.div
                    className="h-full bg-[#ff9933]"
                    initial={{ width: "0%" }}
                    animate={{ width: currentStep > i + 1 ? "100%" : "0%" }}
                    transition={{ duration: 0.5, ease: "easeInOut" }}
                  />
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Two-column layout */}
        <div className="grid grid-cols-[380px_1fr] gap-12">
          {/* Left: sticky description */}
          <div className="relative">
            <div className="sticky top-[120px]">
              <AnimatePresence mode="wait">
                <motion.div key={currentStep} initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.4, ease: "easeOut" }}>
                  <h1 className="text-4xl font-bold text-[#333438] mb-4 leading-tight">{desc.title}</h1>
                  <p className="text-[#61636c] text-lg">{desc.body}</p>
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
      <div className="fixed bottom-0 left-0 right-0 z-50 pointer-events-none pb-8 pt-4 bg-linear-to-t from-[#f6f7f8] via-[#f6f7f8]/80 to-transparent">
        <div className="max-w-[1440px] mx-auto px-6 flex justify-between">
          <button
            onClick={() => setCurrentStep(s => Math.max(s - 1, 1))}
            disabled={currentStep === 1}
            className="pointer-events-auto cursor-pointer px-8 py-3 text-[#ff9933] border border-[#ff9933] bg-white rounded-lg font-semibold hover:bg-[#fff5eb] disabled:opacity-30 disabled:cursor-not-allowed transition-colors uppercase shadow-sm"
          >
            Back
          </button>
          {currentStep < 5 ? (
            <button
              onClick={() => setCurrentStep(s => Math.min(s + 1, 5))}
              disabled={!canNext(currentStep)}
              className="pointer-events-auto cursor-pointer px-8 py-3 bg-linear-to-r from-[#ff9933] to-[#ff6b35] text-white rounded-lg font-semibold hover:shadow-lg transition-all uppercase disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Next
            </button>
          ) : (
            <button
              onClick={() => submitApp.mutate()}
              disabled={submitApp.isPending}
              className="pointer-events-auto cursor-pointer px-8 py-3 bg-linear-to-r from-[#e91e63] to-[#ff1744] text-white rounded-lg font-semibold hover:shadow-lg transition-all uppercase flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitApp.isPending ? <><Loader2 className="w-5 h-5 animate-spin" /> Submitting...</> : <><Check className="w-5 h-5" /> Submit Application</>}
            </button>
          )}
        </div>
      </div>

      {/* Success Modal */}
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
                className="px-8 py-3 bg-gradient-to-r from-[#ff9933] to-[#ff6b35] text-white rounded-lg font-semibold hover:shadow-lg transition-all">
                Back to Dashboard
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
