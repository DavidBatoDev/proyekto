import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  adminService,
  type MatchCandidate,
  type ConsultantProfile,
} from "@/services/admin.service";
import {
  Loader2, Search, X, ChevronRight, Star, Briefcase, Globe,
  GraduationCap, Award, Building2,
  MapPin, Mail, Check, ExternalLink, BadgeCheck, Link2,
  BookOpen, SlidersHorizontal, CheckCircle2,
} from "lucide-react";

export const Route = createFileRoute("/admin/match")({
  component: MatchPage,
});

// ─── Types ────────────────────────────────────────────────────────────────────
type Project = {
  id: string;
  title: string;
  description?: string;
  status?: string;
  budget_min?: number;
  budget_max?: number;
  category?: string;
  skills?: string[];
  created_at: string;
  owner?: { id: string; display_name?: string; email: string };
  consultant?: { id: string; display_name?: string; email: string } | null;
};

// ─── Constants ────────────────────────────────────────────────────────────────
const NICHES = [
  "all", "software_development", "data_science", "design", "marketing",
  "finance", "legal", "hr", "operations", "ai_ml", "other",
];

const AVAILABILITY_OPTIONS = [
  { value: "all", label: "Any availability" },
  { value: "available", label: "Available" },
  { value: "partially_available", label: "Partially available" },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function candidateName(c: MatchCandidate | ConsultantProfile) {
  return (
    (c as any).display_name ||
    [(c as any).first_name, (c as any).last_name].filter(Boolean).join(" ") ||
    c.email
  );
}

function fmtDate(iso?: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
}

function initials(name: string) {
  return name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
}

function Avatar({ url, name, size = "sm" }: { url?: string | null; name: string; size?: "sm" | "md" | "lg" }) {
  const cls = {
    sm: "w-9 h-9 text-xs",
    md: "w-11 h-11 text-sm",
    lg: "w-16 h-16 text-xl",
  }[size];
  if (url)
    return <img src={url} className={`${cls} rounded-full object-cover shrink-0`} />;
  return (
    <div className={`${cls} rounded-full bg-amber-100 text-amber-700 font-bold flex items-center justify-center shrink-0`}>
      {initials(name)}
    </div>
  );
}

function AvailabilityBadge({ status }: { status?: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    available:           { label: "Available",         cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
    partially_available: { label: "Partial",           cls: "bg-amber-50  text-amber-700  border-amber-200" },
    unavailable:         { label: "Unavailable",       cls: "bg-red-50    text-red-700    border-red-200" },
  };
  const { label, cls } = map[status ?? ""] ?? { label: status ?? "—", cls: "bg-gray-50 text-gray-500 border-gray-200" };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border ${cls}`}>{label}</span>;
}

function ProjectCard({
  project,
  isSelected,
  onClick,
}: {
  project: Project;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left p-4 rounded-xl border transition-all ${
        isSelected
          ? "border-amber-400 bg-amber-50 shadow-md ring-1 ring-amber-400/50"
          : "border-gray-200 bg-white hover:border-amber-300 hover:shadow-sm"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-gray-900 leading-tight line-clamp-2">{project.title}</p>
          <div className="flex items-center gap-1.5 mt-1.5">
            <div className="w-5 h-5 rounded-full bg-gray-100 flex items-center justify-center shrink-0">
              <span className="text-[10px] font-bold text-gray-500">
                {initials(project.owner?.display_name ?? project.owner?.email ?? "O")}
              </span>
            </div>
            <p className="text-xs text-gray-500 truncate">
              {project.owner?.display_name ?? project.owner?.email}
            </p>
          </div>
        </div>
      </div>
      
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {project.category && (
            <span className="text-[10px] font-semibold tracking-wide text-gray-500 uppercase bg-gray-100 px-2 py-0.5 rounded">
              {project.category.replace(/_/g, " ")}
            </span>
          )}
          {(project.budget_min ?? project.budget_max) && (
            <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded">
              ${project.budget_min ?? "?"}–${project.budget_max ?? "?"}
            </span>
          )}
        </div>
        
        {project.consultant ? (
          <span className="shrink-0 flex items-center gap-1 text-[11px] text-emerald-700 bg-emerald-100 border border-emerald-200 px-2 py-0.5 rounded-full font-bold uppercase tracking-wide">
            <CheckCircle2 className="w-3 h-3" /> Matched
          </span>
        ) : (
          <span className="shrink-0 text-[11px] text-amber-700 bg-amber-100 border border-amber-200 px-2 py-0.5 rounded-full font-bold uppercase tracking-wide animate-pulse">
            For Bidding
          </span>
        )}
      </div>
    </button>
  );
}

// ─── Consultant Card ──────────────────────────────────────────────────────────
function ConsultantCard({
  candidate,
  isSelected,
  isAssigned,
  onClick,
  onAssign,
  isAssigning,
  projectId,
}: {
  candidate: MatchCandidate;
  isSelected: boolean;
  isAssigned: boolean;
  onClick: () => void;
  onAssign: () => void;
  isAssigning: boolean;
  projectId: string | null;
}) {
  const name = candidateName(candidate);
  const rate = (candidate.rate_settings as any);
  return (
    <div
      className={`group bg-white border rounded-xl p-4 transition-all cursor-pointer ${
        isSelected ? "border-amber-400 shadow-sm bg-amber-50/20" : "border-gray-200 hover:border-gray-300 hover:shadow-sm"
      }`}
      onClick={onClick}
    >
      <div className="flex items-start gap-3">
        <Avatar url={candidate.avatar_url} name={name} size="md" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-bold text-gray-900 truncate">{name}</p>
            {candidate.match_score > 0 && (
              <span className="shrink-0 flex items-center gap-0.5 text-xs text-amber-600 font-semibold">
                <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                {candidate.match_score}
              </span>
            )}
          </div>
          {candidate.headline && <p className="text-xs text-gray-400 truncate mt-0.5">{candidate.headline}</p>}
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            {rate?.availability && <AvailabilityBadge status={rate.availability} />}
            {rate?.hourly_rate && (
              <span className="text-xs text-gray-500">${rate.hourly_rate}/hr</span>
            )}
          </div>
          {(candidate.specializations ?? []).length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {(candidate.specializations ?? []).slice(0, 2).map((s: any, i: number) => (
                <span key={i} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full capitalize">
                  {s.category?.replace(/_/g, " ")}
                </span>
              ))}
            </div>
          )}
        </div>
        <ChevronRight className={`w-4 h-4 shrink-0 mt-1 transition-colors ${isSelected ? "text-amber-500" : "text-gray-300"}`} />
      </div>

      {projectId && !isAssigned && (
        <button
          onClick={(e) => { e.stopPropagation(); onAssign(); }}
          disabled={isAssigning}
          className="mt-3 w-full flex items-center justify-center gap-1.5 py-1.5 text-xs font-semibold text-white bg-amber-500 hover:bg-amber-600 rounded-lg transition-colors disabled:opacity-50"
        >
          {isAssigning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Link2 className="w-3.5 h-3.5" />}
          Assign to Project
        </button>
      )}
      {isAssigned && (
        <div className="mt-3 flex items-center justify-center gap-1.5 py-1.5 text-xs font-semibold text-emerald-600 bg-emerald-50 rounded-lg border border-emerald-200">
          <Check className="w-3.5 h-3.5" /> Assigned
        </div>
      )}
    </div>
  );
}

// ─── Consultant Profile Panel ─────────────────────────────────────────────────
function ConsultantProfilePanel({ id, onClose }: { id: string; onClose: () => void }) {
  const { data: profile, isLoading } = useQuery({
    queryKey: ["adminConsultantProfile", id],
    queryFn: () => adminService.getConsultantProfile(id),
  });

  const name = profile ? candidateName(profile) : "";

  return (
    <motion.div
      initial={{ x: "100%", opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: "100%", opacity: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
      className="w-[440px] shrink-0 h-full bg-white border-l border-gray-200 flex flex-col overflow-hidden"
    >
      {/* Fixed header */}
      <div className="shrink-0 px-6 py-4 border-b border-gray-100 flex items-center justify-between">
        <h2 className="text-sm font-bold text-gray-900">Consultant Profile</h2>
        <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="w-6 h-6 text-amber-500 animate-spin" />
          </div>
        ) : !profile ? (
          <div className="flex items-center justify-center py-24 text-gray-400 text-sm">Profile not found</div>
        ) : (
          <div className="p-6 space-y-6">
            {/* Hero card */}
            <div className="relative rounded-xl overflow-hidden border border-gray-200">
              {/* Banner */}
              <div className={`h-20 w-full ${profile.banner_url ? "" : "bg-linear-to-br from-amber-100 to-amber-200"}`}>
                {profile.banner_url && <img src={profile.banner_url} className="w-full h-full object-cover" />}
              </div>
              {/* Avatar overlapping banner */}
              <div className="px-5 pb-4">
                <div className="-mt-8 flex items-end justify-between">
                  <Avatar url={profile.avatar_url} name={name} size="lg" />
                  {profile.rate_settings?.availability && (
                    <AvailabilityBadge status={profile.rate_settings.availability} />
                  )}
                </div>
                <div className="mt-3">
                  <div className="flex items-center gap-2">
                    <p className="text-base font-bold text-gray-900">{name}</p>
                    {profile.is_consultant_verified && (
                      <BadgeCheck className="w-4 h-4 text-amber-500 shrink-0" />
                    )}
                  </div>
                  {profile.headline && <p className="text-sm text-gray-500 mt-0.5">{profile.headline}</p>}
                  <div className="flex flex-wrap gap-3 mt-2 text-xs text-gray-500">
                    {profile.email && (
                      <span className="flex items-center gap-1"><Mail className="w-3.5 h-3.5" />{profile.email}</span>
                    )}
                    {profile.country && (
                      <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />{[profile.city, profile.country].filter(Boolean).join(", ")}</span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Rate settings */}
            {profile.rate_settings && (
              <div className="grid grid-cols-2 gap-3">
                {profile.rate_settings.hourly_rate && (
                  <div className="bg-gray-50 border border-gray-100 rounded-xl p-3">
                    <p className="text-xs text-gray-400">Hourly Rate</p>
                    <p className="text-sm font-bold text-gray-900 mt-0.5">
                      ${profile.rate_settings.hourly_rate} {profile.rate_settings.currency ?? "USD"}
                    </p>
                  </div>
                )}
                {profile.rate_settings.weekly_hours && (
                  <div className="bg-gray-50 border border-gray-100 rounded-xl p-3">
                    <p className="text-xs text-gray-400">Weekly Availability</p>
                    <p className="text-sm font-bold text-gray-900 mt-0.5">{profile.rate_settings.weekly_hours} hrs/wk</p>
                  </div>
                )}
              </div>
            )}

            {/* Bio */}
            {profile.bio && (
              <section>
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">About</h3>
                <p className="text-sm text-gray-700 leading-relaxed">{profile.bio}</p>
              </section>
            )}

            {/* Skills */}
            {profile.skills.length > 0 && (
              <section>
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <Briefcase className="w-3.5 h-3.5" /> Skills
                </h3>
                <div className="flex flex-wrap gap-1.5">
                  {profile.skills.map((s) => (
                    <span key={s.id} className="text-xs bg-gray-100 text-gray-700 px-2.5 py-1 rounded-full font-medium">
                      {(s as any).skill?.name ?? (s as any).skill_id}
                    </span>
                  ))}
                </div>
              </section>
            )}

            {/* Specializations */}
            {profile.specializations.length > 0 && (
              <section>
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <Star className="w-3.5 h-3.5" /> Specializations
                </h3>
                <div className="space-y-2">
                  {profile.specializations.map((s: any, i: number) => (
                    <div key={s.id ?? i} className="flex items-center justify-between text-sm py-1.5 border-b border-gray-100 last:border-0">
                      <span className="text-gray-800 capitalize font-medium">{s.category?.replace(/_/g, " ")}</span>
                      {s.sub_category && <span className="text-gray-500 text-xs capitalize">{s.sub_category}</span>}
                      {s.years_of_experience && <span className="text-gray-400 text-xs">{s.years_of_experience}+ yrs</span>}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Languages */}
            {profile.languages.length > 0 && (
              <section>
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <Globe className="w-3.5 h-3.5" /> Languages
                </h3>
                <div className="flex flex-wrap gap-2">
                  {profile.languages.map((l) => (
                    <span key={l.id} className="text-xs bg-blue-50 text-blue-700 border border-blue-100 px-2.5 py-1 rounded-full capitalize">
                      {(l as any).language?.name} · {l.fluency_level?.replace(/_/g, " ")}
                    </span>
                  ))}
                </div>
              </section>
            )}

            {/* Experience */}
            {profile.experiences.length > 0 && (
              <section>
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <Building2 className="w-3.5 h-3.5" /> Experience
                </h3>
                <div className="space-y-3">
                  {profile.experiences.map((e) => (
                    <div key={e.id} className="border-l-2 border-amber-200 pl-3">
                      <p className="text-sm font-semibold text-gray-900">{e.title}</p>
                      <p className="text-xs text-gray-500">{e.company}</p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {fmtDate(e.start_date)} – {e.is_current ? "Present" : fmtDate(e.end_date)}
                      </p>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Education */}
            {profile.educations.length > 0 && (
              <section>
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <BookOpen className="w-3.5 h-3.5" /> Education
                </h3>
                <div className="space-y-3">
                  {profile.educations.map((e) => (
                    <div key={e.id} className="border-l-2 border-blue-100 pl-3">
                      <p className="text-sm font-semibold text-gray-900">{e.institution}</p>
                      <p className="text-xs text-gray-500">{[e.degree, e.field_of_study].filter(Boolean).join(" · ")}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{e.start_year || "—"} – {e.is_current ? "Present" : (e.end_year || "—")}</p>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Certifications */}
            {profile.certifications.length > 0 && (
              <section>
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <Award className="w-3.5 h-3.5" /> Certifications
                </h3>
                <div className="flex flex-wrap gap-2">
                  {profile.certifications.map((c) => (
                    <span key={c.id} className="text-xs bg-purple-50 text-purple-700 border border-purple-100 px-2.5 py-1 rounded-full capitalize">
                      {c.name}
                    </span>
                  ))}
                </div>
              </section>
            )}

            {/* Licenses */}
            {profile.licenses.length > 0 && (
              <section>
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <GraduationCap className="w-3.5 h-3.5" /> Licenses
                </h3>
                <div className="flex flex-wrap gap-2">
                  {profile.licenses.map((l) => (
                    <span key={l.id} className="text-xs bg-emerald-50 text-emerald-700 border border-emerald-100 px-2.5 py-1 rounded-full">
                      {l.name}
                    </span>
                  ))}
                </div>
              </section>
            )}

            {/* Portfolios */}
            {profile.portfolios.length > 0 && (
              <section>
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <ExternalLink className="w-3.5 h-3.5" /> Portfolio
                </h3>
                <div className="grid grid-cols-1 gap-2">
                  {profile.portfolios.map((p: any) => (
                    <a
                      key={p.id}
                      href={p.url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-2 p-3 bg-gray-50 border border-gray-200 rounded-xl hover:border-amber-300 transition-colors group"
                    >
                      {p.thumbnail_url && <img src={p.thumbnail_url} className="w-10 h-10 rounded-lg object-cover" />}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-gray-800 truncate group-hover:text-amber-600">{p.title}</p>
                        {p.description && <p className="text-xs text-gray-400 truncate">{p.description}</p>}
                      </div>
                      <ExternalLink className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                    </a>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
function MatchPage() {
  const qc = useQueryClient();
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedConsultantId, setSelectedConsultantId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [nicheFilter, setNicheFilter] = useState("all");
  const [availabilityFilter, setAvailabilityFilter] = useState("all");
  const [showFilters, setShowFilters] = useState(false);
  const [assignedMap, setAssignedMap] = useState<Record<string, string>>({});

  // Projects list
  const { data: projects = [], isLoading: projLoading } = useQuery({
    queryKey: ["adminProjects"],
    queryFn: () => adminService.getAllProjects(),
  });

  // Consultants list
  const { data: candidates = [], isLoading: candLoading } = useQuery({
    queryKey: ["adminCandidates", selectedProjectId, nicheFilter, availabilityFilter],
    queryFn: () => adminService.searchConsultants({
      niche: nicheFilter !== "all" ? nicheFilter : undefined,
      availability: availabilityFilter !== "all" ? availabilityFilter : undefined,
    }),
  });

  const assignMutation = useMutation({
    mutationFn: ({ projectId, consultantId }: { projectId: string; consultantId: string }) =>
      adminService.assignConsultant(projectId, consultantId),
    onSuccess: (_, vars) => {
      setAssignedMap(prev => ({ ...prev, [vars.consultantId]: vars.projectId }));
      qc.invalidateQueries({ queryKey: ["adminProjects"] });
    },
  });

  const selectedProject = useMemo(
    () => projects.find((p: Project) => p.id === selectedProjectId) ?? null,
    [projects, selectedProjectId]
  );

  // Filter candidates by search query
  const filtered = useMemo(() => {
    if (!search.trim()) return candidates;
    const q = search.toLowerCase();
    return candidates.filter((c) =>
      candidateName(c).toLowerCase().includes(q) ||
      c.email?.toLowerCase().includes(q) ||
      (c.headline ?? "").toLowerCase().includes(q)
    );
  }, [candidates, search]);

  // Sort: project-matched candidates first
  const sorted = useMemo(() => {
    if (!selectedProjectId) return filtered;
    return [...filtered].sort((a, b) => (b.match_score ?? 0) - (a.match_score ?? 0));
  }, [filtered, selectedProjectId]);

  return (
    <div className="flex h-full">
      {/* Left: Projects + Consultants */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="shrink-0 px-8 pt-8 pb-5 bg-white border-b border-gray-200">
          <h1 className="text-2xl font-bold text-gray-900">Match Projects</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            Select a project, then assign a verified consultant
          </p>
        </div>

        <div className="flex-1 overflow-hidden flex gap-0">
          {/* Projects column */}
          <div className="w-72 shrink-0 h-full overflow-y-auto border-r border-gray-100 px-4 py-4 space-y-2 bg-gray-50">
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wider px-1 mb-3">
              Projects ({projects.length})
            </p>
            {projLoading ? (
              <div className="flex justify-center pt-8"><Loader2 className="w-5 h-5 text-amber-500 animate-spin" /></div>
            ) : projects.length === 0 ? (
              <p className="text-xs text-gray-400 px-1">No projects found</p>
            ) : (
              (projects as Project[]).map((p) => (
                <ProjectCard
                  key={p.id}
                  project={p}
                  isSelected={selectedProjectId === p.id}
                  onClick={() => {
                    setSelectedProjectId(prev => prev === p.id ? null : p.id);
                    setSelectedConsultantId(null);
                  }}
                />
              ))
            )}
          </div>

          {/* Consultants column */}
          <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
            {/* Consultant toolbar */}
            <div className="shrink-0 px-5 py-3 bg-white border-b border-gray-100 space-y-2">
              {selectedProject && (
                <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-2">
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                  <span>Showing consultants ranked for <strong>{selectedProject.title}</strong></span>
                </div>
              )}
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                  <input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search consultants..."
                    className="w-full pl-9 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent"
                  />
                </div>
                <button
                  onClick={() => setShowFilters(f => !f)}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-sm font-medium transition-colors ${
                    showFilters || nicheFilter !== "all" || availabilityFilter !== "all"
                      ? "border-amber-400 bg-amber-50 text-amber-700"
                      : "border-gray-200 text-gray-500 hover:border-gray-300"
                  }`}
                >
                  <SlidersHorizontal className="w-3.5 h-3.5" />
                  Filters
                </button>
              </div>
              <AnimatePresence>
                {showFilters && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="flex gap-2 pt-1">
                      <select
                        value={nicheFilter}
                        onChange={e => setNicheFilter(e.target.value)}
                        className="flex-1 px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-amber-400"
                      >
                        {NICHES.map(n => (
                          <option key={n} value={n}>{n === "all" ? "All niches" : n.replace(/_/g, " ")}</option>
                        ))}
                      </select>
                      <select
                        value={availabilityFilter}
                        onChange={e => setAvailabilityFilter(e.target.value)}
                        className="flex-1 px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-amber-400"
                      >
                        {AVAILABILITY_OPTIONS.map(o => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Consultant list */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2">
              {candLoading ? (
                <div className="flex justify-center pt-12">
                  <Loader2 className="w-6 h-6 text-amber-500 animate-spin" />
                </div>
              ) : sorted.length === 0 ? (
                <div className="flex flex-col items-center justify-center pt-20 text-center">
                  <Briefcase className="w-10 h-10 text-gray-200 mb-3" />
                  <p className="text-gray-500 font-medium text-sm">No consultants found</p>
                  <p className="text-gray-400 text-xs mt-1">Try adjusting your filters</p>
                </div>
              ) : (
                sorted.map((c) => (
                  <ConsultantCard
                    key={c.id}
                    candidate={c}
                    isSelected={selectedConsultantId === c.id}
                    isAssigned={
                      assignedMap[c.id] === selectedProjectId ||
                      (selectedProject?.consultant?.id === c.id)
                    }
                    projectId={selectedProjectId}
                    onClick={() => setSelectedConsultantId(prev => prev === c.id ? null : c.id)}
                    onAssign={() => {
                      if (selectedProjectId) {
                        assignMutation.mutate({ projectId: selectedProjectId, consultantId: c.id });
                      }
                    }}
                    isAssigning={assignMutation.isPending && assignMutation.variables?.consultantId === c.id}
                  />
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Right: Profile Panel */}
      <AnimatePresence>
        {selectedConsultantId && (
          <ConsultantProfilePanel
            id={selectedConsultantId}
            onClose={() => setSelectedConsultantId(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
