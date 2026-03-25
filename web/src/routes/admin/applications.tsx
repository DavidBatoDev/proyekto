import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  adminService,
  type ConsultantApplication,
  type ApplicationStatus,
} from "@/services/admin.service";
import {
  Loader2, Search, CheckCircle2, XCircle, Clock, FileText,
  Globe, BadgeCheck, ShieldCheck, ChevronRight, X, Check,
  AlertCircle, ExternalLink, Building2, BookOpen, Award,
  Mail, Info,
} from "lucide-react";

export const Route = createFileRoute("/admin/applications")({
  component: ApplicationsPage,
});

// ─── Constants ────────────────────────────────────────────────────────────────
const STATUS_TABS: { label: string; value: ApplicationStatus | "all" }[] = [
  { label: "All", value: "all" },
  { label: "Submitted", value: "submitted" },
  { label: "Under Review", value: "under_review" },
  { label: "Approved", value: "approved" },
  { label: "Rejected", value: "rejected" },
];

const STATUS_CONFIG: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  draft:        { label: "Draft",        icon: FileText,     color: "text-gray-500 bg-gray-100" },
  submitted:    { label: "Submitted",    icon: Clock,        color: "text-blue-600 bg-blue-50" },
  under_review: { label: "Under Review", icon: AlertCircle,  color: "text-amber-600 bg-amber-50" },
  approved:     { label: "Approved",     icon: CheckCircle2, color: "text-emerald-600 bg-emerald-50" },
  rejected:     { label: "Rejected",     icon: XCircle,      color: "text-red-600 bg-red-50" },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtDate(iso?: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function applicantName(app: ConsultantApplication) {
  const a = app.applicant;
  if (!a) return "Unknown";
  return (
    a.display_name ||
    [a.first_name, a.last_name].filter(Boolean).join(" ") ||
    a.email
  );
}

function initials(name: string) {
  return name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.draft;
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${cfg.color}`}>
      <Icon className="w-3 h-3" />
      {cfg.label}
    </span>
  );
}

function ApplicantAvatar({
  avatarUrl,
  name,
  size = "sm",
}: {
  avatarUrl?: string | null;
  name: string;
  size?: "sm" | "lg";
}) {
  const dim = size === "lg" ? "w-14 h-14 text-xl" : "w-9 h-9 text-xs";
  if (avatarUrl) {
    return <img src={avatarUrl} className={`${dim} rounded-full object-cover shrink-0`} />;
  }
  return (
    <div className={`${dim} rounded-full bg-amber-100 flex items-center justify-center text-amber-700 font-bold shrink-0`}>
      {initials(name)}
    </div>
  );
}

function VettingSection({
  title,
  icon: Icon,
  count,
  children,
}: {
  title: string;
  icon: React.ElementType;
  count: number;
  children: React.ReactNode;
}) {
  if (count === 0) return null;
  return (
    <section>
      <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
        <Icon className="w-3.5 h-3.5" />
        {title}
        <span className="ml-auto normal-case font-normal text-gray-400">{count}</span>
      </h3>
      <div className="space-y-1">{children}</div>
    </section>
  );
}

function VettingChip({
  label,
  verified,
}: {
  label: string;
  verified?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium mr-1.5 mb-1.5 ${
        verified
          ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
          : "bg-gray-100 text-gray-600"
      }`}
    >
      {verified && <BadgeCheck className="w-3 h-3" />}
      <span className="capitalize">{label}</span>
    </span>
  );
}

// ─── Application Row ──────────────────────────────────────────────────────────
function ApplicationRow({
  app,
  onClick,
  isSelected,
}: {
  app: ConsultantApplication;
  onClick: () => void;
  isSelected: boolean;
}) {
  const name = applicantName(app);
  return (
    <motion.tr
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      onClick={onClick}
      className={`border-b border-gray-100 cursor-pointer transition-colors ${
        isSelected
          ? "bg-amber-50 border-l-2 border-l-amber-500"
          : "hover:bg-gray-50"
      }`}
    >
      <td className="px-5 py-3.5">
        <div className="flex items-center gap-3">
          <ApplicantAvatar avatarUrl={app.applicant?.avatar_url} name={name} />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900 truncate">{name}</p>
            <p className="text-xs text-gray-400 truncate">{app.applicant?.email}</p>
          </div>
        </div>
      </td>
      <td className="px-5 py-3.5">
        <p className="text-sm text-gray-600 capitalize">{app.primary_niche?.replace(/_/g, " ") || "—"}</p>
      </td>
      <td className="px-5 py-3.5">
        <p className="text-sm text-gray-600">
          {app.years_of_experience != null ? `${app.years_of_experience}+ yrs` : "—"}
        </p>
      </td>
      <td className="px-5 py-3.5">
        <StatusBadge status={app.status} />
      </td>
      <td className="px-5 py-3.5">
        <p className="text-xs text-gray-400">{fmtDate(app.submitted_at ?? app.created_at)}</p>
      </td>
      <td className="px-5 py-3.5 text-right">
        <ChevronRight
          className={`w-4 h-4 ml-auto transition-colors ${
            isSelected ? "text-amber-500" : "text-gray-300"
          }`}
        />
      </td>
    </motion.tr>
  );
}

// ─── Application Table ────────────────────────────────────────────────────────
function ApplicationTable({
  apps,
  isLoading,
  selectedId,
  onSelect,
}: {
  apps: ConsultantApplication[];
  isLoading: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-8 h-8 text-amber-500 animate-spin" />
      </div>
    );
  }
  if (apps.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <FileText className="w-10 h-10 text-gray-300 mb-3" />
        <p className="text-gray-500 font-medium">No applications found</p>
        <p className="text-sm text-gray-400 mt-1">Try adjusting your filter or search</p>
      </div>
    );
  }
  return (
    <table className="w-full">
      <thead>
        <tr className="border-b border-gray-200">
          {["Applicant", "Niche", "Experience", "Status", "Date", ""].map((h) => (
            <th
              key={h}
              className="px-5 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider"
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        <AnimatePresence>
          {apps.map((app) => (
            <ApplicationRow
              key={app.id}
              app={app}
              isSelected={selectedId === app.id}
              onClick={() => onSelect(app.id)}
            />
          ))}
        </AnimatePresence>
      </tbody>
    </table>
  );
}

// ─── Detail Panel ─────────────────────────────────────────────────────────────
function ApplicationDetailPanel({
  id,
  onClose,
}: {
  id: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [rejectReason, setRejectReason] = useState("");
  const [showRejectForm, setShowRejectForm] = useState(false);

  const { data: detail, isLoading } = useQuery({
    queryKey: ["adminApp", id],
    queryFn: () => adminService.getApplication(id),
  });

  const approve = useMutation({
    mutationFn: () => adminService.approveApplication(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["adminApps"] });
      qc.invalidateQueries({ queryKey: ["adminApp", id] });
    },
  });

  const reject = useMutation({
    mutationFn: () => adminService.rejectApplication(id, rejectReason || undefined),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["adminApps"] });
      qc.invalidateQueries({ queryKey: ["adminApp", id] });
      setShowRejectForm(false);
    },
  });

  const name = detail ? applicantName(detail) : "";
  const app = detail;
  const v = detail?.vetting;
  const isActionable =
    app?.status === "draft" ||
    app?.status === "submitted" ||
    app?.status === "under_review";

  return (
    <motion.div
      key="detail-panel"
      initial={{ x: "100%", opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: "100%", opacity: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
      className="w-[480px] shrink-0 h-full bg-white border-l border-gray-200 flex flex-col overflow-hidden"
    >
      {/* Fixed Header */}
      <div className="shrink-0 bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between">
        <h2 className="text-sm font-bold text-gray-900">Application Detail</h2>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Scrollable Body */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="w-6 h-6 text-amber-500 animate-spin" />
          </div>
        ) : !app ? (
          <div className="flex items-center justify-center py-24 text-gray-400 text-sm">
            Application not found
          </div>
        ) : (
          <div className="p-6 space-y-6">
            {/* Applicant card */}
            <div className="flex items-center gap-4 p-4 bg-gray-50 rounded-xl border border-gray-200">
              <ApplicantAvatar avatarUrl={app.applicant?.avatar_url} name={name} size="lg" />
              <div className="flex-1 min-w-0">
                <p className="font-bold text-gray-900 text-base truncate">{name}</p>
                <p className="text-sm text-gray-500 flex items-center gap-1.5 mt-0.5">
                  <Mail className="w-3 h-3" />
                  {app.applicant?.email}
                </p>
                {app.applicant?.headline && (
                  <p className="text-xs text-gray-400 mt-0.5 truncate">{app.applicant.headline}</p>
                )}
              </div>
              <StatusBadge status={app.status} />
            </div>

            {/* Meta grid */}
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: "Niche", value: app.primary_niche?.replace(/_/g, " ") || "—" },
                { label: "Experience", value: app.years_of_experience != null ? `${app.years_of_experience}+ years` : "—" },
                { label: "Submitted", value: fmtDate(app.submitted_at) },
                { label: "Reviewed", value: fmtDate(app.reviewed_at) },
              ].map(({ label, value }) => (
                <div key={label} className="bg-gray-50 border border-gray-100 rounded-xl p-3">
                  <p className="text-xs text-gray-400 mb-0.5">{label}</p>
                  <p className="text-sm font-semibold text-gray-800 capitalize">{value}</p>
                </div>
              ))}
            </div>

            {/* Links */}
            {(app.linkedin_url || app.website_url) && (
              <div className="flex gap-2 flex-wrap">
                {app.linkedin_url && (
                  <a
                    href={app.linkedin_url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-blue-600 bg-blue-50 border border-blue-100 rounded-full hover:bg-blue-100 transition-colors"
                  >
                    <ExternalLink className="w-3 h-3" /> LinkedIn
                  </a>
                )}
                {app.website_url && (
                  <a
                    href={app.website_url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-purple-600 bg-purple-50 border border-purple-100 rounded-full hover:bg-purple-100 transition-colors"
                  >
                    <ExternalLink className="w-3 h-3" /> Website
                  </a>
                )}
              </div>
            )}

            {/* Cover Letter */}
            {app.cover_letter && (
              <section>
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5" /> Cover Letter
                </h3>
                <div className="bg-gray-50 border border-gray-100 rounded-xl p-4 text-sm text-gray-700 leading-relaxed whitespace-pre-wrap max-h-48 overflow-y-auto">
                  {app.cover_letter}
                </div>
              </section>
            )}

            {/* Why join */}
            {app.why_join && (
              <section>
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <Info className="w-3.5 h-3.5" /> Why Join
                </h3>
                <div className="bg-gray-50 border border-gray-100 rounded-xl p-4 text-sm text-gray-700 leading-relaxed">
                  {app.why_join}
                </div>
              </section>
            )}

            {/* Vetting */}
            {v && (
              <>
                <VettingSection title="Identity Documents" icon={ShieldCheck} count={v.identity_documents.length}>
                  {v.identity_documents.map((doc) => (
                    <VettingChip key={doc.id} label={doc.type?.replace(/_/g, " ")} verified={doc.is_verified} />
                  ))}
                </VettingSection>

                <VettingSection title="Languages" icon={Globe} count={v.languages.length}>
                  {v.languages.map((lang) => (
                    <VettingChip key={lang.id} label={`${lang.language?.name} — ${lang.fluency_level?.replace("_", " ")}`} />
                  ))}
                </VettingSection>

                <VettingSection title="Work Experience" icon={Building2} count={v.experiences.length}>
                  {v.experiences.map((exp) => (
                    <div key={exp.id} className="text-xs text-gray-700 py-2 border-b border-gray-100 last:border-0">
                      <p className="font-semibold">{exp.title} @ {exp.company}</p>
                      <p className="text-gray-400 mt-0.5">
                        {fmtDate(exp.start_date)} – {exp.is_current ? "Present" : fmtDate(exp.end_date)}
                      </p>
                    </div>
                  ))}
                </VettingSection>

                <VettingSection title="Education" icon={BookOpen} count={v.educations.length}>
                  {v.educations.map((edu) => (
                    <div key={edu.id} className="text-xs text-gray-700 py-2 border-b border-gray-100 last:border-0">
                      <p className="font-semibold">{edu.institution}</p>
                      <p className="text-gray-400 mt-0.5">{[edu.degree, edu.field_of_study].filter(Boolean).join(" · ")}</p>
                    </div>
                  ))}
                </VettingSection>

                <VettingSection title="Licenses" icon={Award} count={v.licenses.length}>
                  {v.licenses.map((lic) => (
                    <VettingChip key={lic.id} label={lic.name} />
                  ))}
                </VettingSection>
              </>
            )}

            {/* Rejection reason display */}
            {app.status === "rejected" && app.rejection_reason && (
              <div className="p-4 bg-red-50 border border-red-100 rounded-xl">
                <p className="text-xs font-bold text-red-600 mb-1">Rejection Reason</p>
                <p className="text-sm text-red-700">{app.rejection_reason}</p>
              </div>
            )}

            {/* Approved state */}
            {app.status === "approved" && (
              <div className="flex items-center gap-3 p-4 bg-emerald-50 border border-emerald-100 rounded-xl">
                <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
                <div>
                  <p className="text-sm font-bold text-emerald-700">Application Approved</p>
                  <p className="text-xs text-emerald-500">{fmtDate(app.reviewed_at)}</p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Fixed Actions Footer */}
      {app && isActionable && (
        <div className="shrink-0 border-t border-gray-100 bg-white p-4 space-y-3">
          {showRejectForm ? (
            <>
              <textarea
                rows={3}
                placeholder="Reason for rejection (optional)"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-red-400 focus:border-transparent resize-none"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => reject.mutate()}
                  disabled={reject.isPending}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-red-500 text-white rounded-xl text-sm font-semibold hover:bg-red-600 disabled:opacity-50 transition-colors"
                >
                  {reject.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
                  Confirm Reject
                </button>
                <button
                  onClick={() => setShowRejectForm(false)}
                  className="px-4 py-2.5 border border-gray-200 text-gray-500 rounded-xl text-sm hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <div className="flex gap-3">
              <button
                onClick={() => approve.mutate()}
                disabled={approve.isPending}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-emerald-500 text-white rounded-xl text-sm font-bold hover:bg-emerald-600 disabled:opacity-50 transition-colors"
              >
                {approve.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                Approve
              </button>
              <button
                onClick={() => setShowRejectForm(true)}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-3 border border-red-200 text-red-500 rounded-xl text-sm font-bold hover:bg-red-50 transition-colors"
              >
                <XCircle className="w-4 h-4" /> Reject
              </button>
            </div>
          )}
        </div>
      )}
    </motion.div>
  );
}

// ─── Stats Cards ──────────────────────────────────────────────────────────────
function StatCards({ counts }: { counts: Record<string, number> }) {
  return (
    <div className="flex gap-3">
      {[
        { label: "Pending", value: (counts.submitted ?? 0) + (counts.under_review ?? 0), color: "text-amber-600", bg: "bg-amber-50 border-amber-100" },
        { label: "Approved", value: counts.approved ?? 0, color: "text-emerald-600", bg: "bg-emerald-50 border-emerald-100" },
        { label: "Rejected", value: counts.rejected ?? 0, color: "text-red-500", bg: "bg-red-50 border-red-100" },
      ].map((s) => (
        <div key={s.label} className={`border rounded-xl px-4 py-2.5 text-center min-w-[80px] ${s.bg}`}>
          <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
          <p className="text-xs text-gray-500">{s.label}</p>
        </div>
      ))}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
function ApplicationsPage() {
  const [statusFilter, setStatusFilter] = useState<ApplicationStatus | "all">("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: apps = [], isLoading } = useQuery({
    queryKey: ["adminApps", statusFilter],
    queryFn: () =>
      adminService.getApplications(statusFilter === "all" ? undefined : statusFilter),
  });

  const filtered = apps.filter((app) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      applicantName(app).toLowerCase().includes(q) ||
      app.applicant?.email?.toLowerCase().includes(q) ||
      app.primary_niche?.includes(q)
    );
  });

  const counts = apps.reduce((acc, app) => {
    acc[app.status] = (acc[app.status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="flex h-full">
      {/* List panel */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {/* Page header */}
        <div className="shrink-0 px-8 pt-8 pb-5 border-b border-gray-200 bg-white">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Consultant Applications</h1>
              <p className="text-sm text-gray-400 mt-0.5">
                {apps.length} total · {counts.submitted ?? 0} pending review
              </p>
            </div>
            <StatCards counts={counts} />
          </div>

          {/* Status tabs */}
          <div className="flex gap-1">
            {STATUS_TABS.map((tab) => (
              <button
                key={tab.value}
                onClick={() => setStatusFilter(tab.value)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  statusFilter === tab.value
                    ? "bg-amber-500 text-white shadow-sm"
                    : "text-gray-500 hover:text-gray-800 hover:bg-gray-100"
                }`}
              >
                {tab.label}
                {tab.value !== "all" && counts[tab.value] != null && (
                  <span
                    className={`ml-1.5 px-1.5 py-0.5 rounded text-xs font-bold ${
                      statusFilter === tab.value
                        ? "bg-white/25"
                        : "bg-gray-200 text-gray-500"
                    }`}
                  >
                    {counts[tab.value]}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Search bar */}
        <div className="shrink-0 px-8 py-4 bg-white border-b border-gray-100">
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, email, niche..."
              className="w-full pl-10 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent"
            />
          </div>
        </div>

        {/* Scrollable table area */}
        <div className="flex-1 overflow-auto px-8 py-4">
          <ApplicationTable
            apps={filtered}
            isLoading={isLoading}
            selectedId={selectedId}
            onSelect={(id) => setSelectedId(selectedId === id ? null : id)}
          />
        </div>
      </div>

      {/* Detail panel */}
      <AnimatePresence>
        {selectedId && (
          <ApplicationDetailPanel
            id={selectedId}
            onClose={() => setSelectedId(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
