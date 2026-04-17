import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import {
  Loader2,
  ShieldCheck,
  Users,
  UserCheck,
  CheckCircle2,
  XCircle,
  Clock,
  LogIn,
  Building2,
} from "lucide-react";
import { motion } from "framer-motion";
import {
  getInvitationLinkInfo,
  submitInvitationRequest,
  ROLE_META,
  type InvitationLinkInfo,
  type InvitationRoleType,
} from "@/services/project-invitations.service";
import { useAuthStore } from "@/stores/authStore";

export const Route = createFileRoute("/invite/$token")({
  component: InvitationLandingPage,
});

const ROLE_ICONS: Record<InvitationRoleType, React.ElementType> = {
  consultant: ShieldCheck,
  freelancer: Users,
  client: UserCheck,
};

type PageState = "loading" | "ready" | "submitting" | "submitted" | "already_requested" | "error";

function InvitationLandingPage() {
  const { token } = Route.useParams();
  const { isAuthenticated, profile } = useAuthStore();

  const [linkInfo, setLinkInfo] = useState<InvitationLinkInfo | null>(null);
  const [pageState, setPageState] = useState<PageState>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [existingStatus, setExistingStatus] = useState<"pending" | "approved" | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const info = await getInvitationLinkInfo(token);
        setLinkInfo(info);
        setPageState("ready");
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : "This invitation link is invalid or has expired.");
        setPageState("error");
      }
    };
    load();
  }, [token]);

  const handleSubmit = async () => {
    if (!isAuthenticated) return;
    setPageState("submitting");
    try {
      await submitInvitationRequest(token, note.trim() || undefined);
      setPageState("submitted");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to submit request.";
      if (msg.toLowerCase().includes("already have a pending")) {
        setExistingStatus("pending");
        setPageState("already_requested");
      } else if (msg.toLowerCase().includes("already been approved")) {
        setExistingStatus("approved");
        setPageState("already_requested");
      } else {
        setErrorMessage(msg);
        setPageState("error");
      }
    }
  };

  const role = linkInfo?.role_type as InvitationRoleType | undefined;
  const meta = role ? ROLE_META[role] : null;
  const Icon = role ? ROLE_ICONS[role] : Building2;
  const project = linkInfo?.project;
  const consultant = project?.consultant;

  return (
    <div className="min-h-screen bg-linear-to-br from-gray-50 to-gray-100 flex flex-col">
      {/* Top bar */}
      <div className="border-b border-gray-200 bg-white px-6 py-3">
        <Link to="/landing" className="flex items-center gap-2">
          <img src="/prodigitality.svg" alt="Prodigy" className="h-7" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
          <span className="text-sm font-semibold text-gray-700">Prodigy</span>
        </Link>
      </div>

      {/* Content */}
      <div className="flex flex-1 items-center justify-center px-4 py-12">
        {pageState === "loading" && (
          <div className="text-center">
            <Loader2 size={36} className="mx-auto animate-spin text-[#ff9933]" />
            <p className="mt-3 text-sm text-gray-500">Loading invitation…</p>
          </div>
        )}

        {pageState === "error" && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-full max-w-md rounded-2xl border border-red-100 bg-white p-8 text-center shadow-lg"
          >
            <XCircle size={40} className="mx-auto text-red-400" />
            <h1 className="mt-4 text-lg font-semibold text-gray-900">Link unavailable</h1>
            <p className="mt-2 text-sm text-gray-500">{errorMessage}</p>
            <Link
              to="/dashboard"
              className="mt-6 inline-block rounded-xl bg-[#ff9933] px-6 py-2.5 text-sm font-semibold text-white hover:bg-[#ea8b25]"
            >
              Go to Dashboard
            </Link>
          </motion.div>
        )}

        {(pageState === "ready" || pageState === "submitting") && meta && project && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-full max-w-md"
          >
            {/* Project card */}
            {project.banner_url && (
              <div className="mb-4 overflow-hidden rounded-xl">
                <img src={project.banner_url} alt={project.title} className="h-32 w-full object-cover" />
              </div>
            )}

            <div className="rounded-2xl border border-gray-200 bg-white shadow-lg overflow-hidden">
              {/* Role badge */}
              <div className={`bg-linear-to-r ${meta.gradient} px-6 py-5`}>
                <div className="flex items-center gap-3">
                  <div className={`flex h-11 w-11 items-center justify-center rounded-xl bg-white/70 ${meta.color}`}>
                    <Icon size={22} />
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                      Project Invitation
                    </p>
                    <h1 className={`text-lg font-bold ${meta.color}`}>Join as {meta.label}</h1>
                  </div>
                </div>
              </div>

              <div className="p-6 space-y-5">
                {/* Project info */}
                <div>
                  <p className="text-xs text-gray-400 uppercase tracking-wide font-medium">Project</p>
                  <p className="mt-1 text-base font-semibold text-gray-900">{project.title}</p>
                </div>

                {/* Role description */}
                <div className={`rounded-xl bg-linear-to-r ${meta.gradient} px-4 py-3`}>
                  <p className={`text-sm font-medium ${meta.color}`}>{meta.description}</p>
                </div>

                {/* Invited by */}
                {consultant && (
                  <div className="flex items-center gap-3">
                    {consultant.avatar_url ? (
                      <img
                        src={consultant.avatar_url}
                        alt={consultant.display_name ?? ""}
                        className="h-8 w-8 rounded-full object-cover"
                      />
                    ) : (
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-200 text-sm font-medium text-gray-600">
                        {(consultant.display_name ?? "?")[0]?.toUpperCase()}
                      </div>
                    )}
                    <p className="text-sm text-gray-600">
                      Invited by{" "}
                      <span className="font-medium text-gray-900">
                        {consultant.display_name ?? "the project consultant"}
                      </span>
                    </p>
                  </div>
                )}

                {/* Auth gate or request form */}
                {!isAuthenticated ? (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-center">
                    <LogIn size={20} className="mx-auto mb-2 text-amber-500" />
                    <p className="text-sm text-amber-800 font-medium">Sign in to request access</p>
                    <p className="mt-1 text-xs text-amber-600">
                      You need an account to join this project.
                    </p>
                    <Link
                      to="/auth/login"
                      className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-[#ff9933] px-5 py-2 text-sm font-semibold text-white hover:bg-[#ea8b25]"
                    >
                      <LogIn size={14} />
                      Sign In
                    </Link>
                  </div>
                ) : (
                  <>
                    {/* Note field */}
                    <div>
                      <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                        Add a note (optional)
                      </label>
                      <textarea
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        maxLength={500}
                        rows={3}
                        placeholder="Introduce yourself or explain why you'd like to join…"
                        className="mt-1.5 w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700 placeholder-gray-400 focus:border-[#ff9933] focus:bg-white focus:outline-none focus:ring-1 focus:ring-[#ff9933] resize-none"
                      />
                      <p className="mt-1 text-right text-xs text-gray-400">{note.length}/500</p>
                    </div>

                    <button
                      onClick={handleSubmit}
                      disabled={pageState === "submitting"}
                      className="w-full rounded-xl bg-[#ff9933] py-3 text-sm font-semibold text-white transition-colors hover:bg-[#ea8b25] disabled:opacity-60"
                    >
                      {pageState === "submitting" ? (
                        <span className="inline-flex items-center justify-center gap-2">
                          <Loader2 size={16} className="animate-spin" />
                          Sending request…
                        </span>
                      ) : (
                        "Request Access"
                      )}
                    </button>

                    <p className="text-center text-xs text-gray-400">
                      Signed in as <span className="font-medium text-gray-600">{profile?.email}</span>
                    </p>
                  </>
                )}
              </div>
            </div>
          </motion.div>
        )}

        {pageState === "submitted" && meta && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-lg"
          >
            <CheckCircle2 size={48} className="mx-auto text-emerald-500" />
            <h2 className="mt-4 text-xl font-bold text-gray-900">Request sent!</h2>
            <p className="mt-2 text-sm text-gray-500">
              The consultant will review your request and notify you when a decision is made.
            </p>
            <div className={`mt-5 rounded-xl bg-linear-to-r ${meta.gradient} px-4 py-3`}>
              <p className={`text-sm font-medium ${meta.color}`}>
                Role requested: <strong>{meta.label}</strong>
              </p>
            </div>
            <Link
              to="/dashboard"
              className="mt-6 inline-block rounded-xl border border-gray-200 px-6 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Back to Dashboard
            </Link>
          </motion.div>
        )}

        {pageState === "already_requested" && meta && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-lg"
          >
            {existingStatus === "approved" ? (
              <>
                <CheckCircle2 size={48} className="mx-auto text-emerald-500" />
                <h2 className="mt-4 text-xl font-bold text-gray-900">You're already in!</h2>
                <p className="mt-2 text-sm text-gray-500">
                  Your request to join as {meta.label} has been approved.
                </p>
                <Link
                  to="/dashboard"
                  className="mt-6 inline-block rounded-xl bg-[#ff9933] px-6 py-2.5 text-sm font-semibold text-white hover:bg-[#ea8b25]"
                >
                  Go to Dashboard
                </Link>
              </>
            ) : (
              <>
                <Clock size={48} className="mx-auto text-amber-400" />
                <h2 className="mt-4 text-xl font-bold text-gray-900">Request pending</h2>
                <p className="mt-2 text-sm text-gray-500">
                  You already have a pending request to join as {meta.label}. The consultant will review it soon.
                </p>
                <Link
                  to="/dashboard"
                  className="mt-6 inline-block rounded-xl border border-gray-200 px-6 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  Back to Dashboard
                </Link>
              </>
            )}
          </motion.div>
        )}
      </div>
    </div>
  );
}
