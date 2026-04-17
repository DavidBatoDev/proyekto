import { useState } from "react";
import { createPortal } from "react-dom";
import {
  X,
  Copy,
  Check,
  Link2,
  Users,
  UserCheck,
  RefreshCw,
  ArrowRight,
  ShieldCheck,
  Loader2,
  Lock,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useToast } from "@/hooks/useToast";
import {
  getInvitationLinks,
  createInvitationLink,
  revokeInvitationLink,
  getInvitationRequests,
  buildInviteUrl,
  ROLE_META,
  type InvitationLink,
  type InvitationRoleType,
} from "@/services/project-invitations.service";

interface ProjectInviteLinksModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  /** true = consultant — can toggle/regenerate/approve. false = member — copy-only. */
  canManage?: boolean;
}

const ROLE_ICONS: Record<InvitationRoleType, React.ElementType> = {
  consultant: ShieldCheck,
  freelancer: Users,
  client: UserCheck,
};

const ROLE_ORDER: InvitationRoleType[] = ["consultant", "freelancer", "client"];

function RoleLinkCard({
  projectId,
  roleType,
  link,
  pendingCount,
  canManage,
  onToggle,
  onRegenerate,
  isLoading,
}: {
  projectId: string;
  roleType: InvitationRoleType;
  link: InvitationLink | undefined;
  pendingCount: number;
  canManage: boolean;
  onToggle: (roleType: InvitationRoleType, currentLink: InvitationLink | undefined) => void;
  onRegenerate: (roleType: InvitationRoleType) => void;
  isLoading: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const meta = ROLE_META[roleType];
  const Icon = ROLE_ICONS[roleType];
  const isActive = !!link?.is_active;
  const inviteUrl = link ? buildInviteUrl(link.token) : "";

  const handleCopy = () => {
    if (!inviteUrl) return;
    navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Members see an inactive card with a lock hint when no link is generated yet
  if (!canManage && !isActive) {
    return (
      <div className={`rounded-xl border bg-linear-to-r ${meta.gradient} p-4 opacity-50`}>
        <div className="flex items-center gap-3">
          <div className={`flex h-9 w-9 items-center justify-center rounded-lg bg-white/70 ${meta.color}`}>
            <Icon size={18} />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className={`text-sm font-semibold ${meta.color}`}>{meta.label}</h3>
            <p className="text-xs text-gray-400 mt-0.5">No active link — consultant hasn't enabled this yet</p>
          </div>
          <Lock size={14} className="text-gray-400 shrink-0" />
        </div>
      </div>
    );
  }

  return (
    <div className={`rounded-xl border bg-linear-to-r ${meta.gradient} p-4 transition-all duration-200`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className={`flex h-9 w-9 items-center justify-center rounded-lg bg-white/70 ${meta.color}`}>
            <Icon size={18} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className={`text-sm font-semibold ${meta.color}`}>{meta.label}</h3>
              {pendingCount > 0 && canManage && (
                <span className="rounded-full bg-[#ff9933] px-2 py-0.5 text-xs font-bold text-white">
                  {pendingCount} pending
                </span>
              )}
            </div>
            <p className="text-xs text-gray-500 mt-0.5">{meta.description}</p>
          </div>
        </div>

        {/* Toggle — consultant only */}
        {canManage ? (
          <button
            onClick={() => onToggle(roleType, link)}
            disabled={isLoading}
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-60 ${
              isActive ? "bg-[#ff9933]" : "bg-gray-300"
            }`}
            aria-label={isActive ? "Disable link" : "Enable link"}
          >
            {isLoading ? (
              <Loader2 size={12} className="absolute left-1/2 -translate-x-1/2 animate-spin text-white" />
            ) : (
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                  isActive ? "translate-x-6" : "translate-x-1"
                }`}
              />
            )}
          </button>
        ) : (
          /* Member: read-only active indicator */
          <span className="flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            Active
          </span>
        )}
      </div>

      {/* Link row — shown when active */}
      <AnimatePresence>
        {isActive && inviteUrl && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="mt-3 overflow-hidden"
          >
            <div className="flex items-center gap-2">
              <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-lg border border-gray-200 bg-white/80 px-3 py-1.5">
                <Link2 size={12} className="shrink-0 text-gray-400" />
                <span className="truncate text-xs text-gray-600">{inviteUrl}</span>
              </div>
              <button
                onClick={handleCopy}
                className="flex shrink-0 items-center gap-1.5 rounded-lg border border-gray-200 bg-white/80 px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-white"
              >
                {copied ? (
                  <>
                    <Check size={12} className="text-emerald-500" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy size={12} />
                    Copy
                  </>
                )}
              </button>
              {/* Regenerate — consultant only */}
              {canManage && (
                <button
                  onClick={() => onRegenerate(roleType)}
                  disabled={isLoading}
                  title="Regenerate link (revokes old link)"
                  className="flex shrink-0 items-center rounded-lg border border-gray-200 bg-white/80 p-1.5 text-gray-500 transition-colors hover:bg-white disabled:opacity-50"
                >
                  <RefreshCw size={12} />
                </button>
              )}
            </div>

            {/* Pending review link — consultant only */}
            {canManage && pendingCount > 0 && (
              <Link
                to="/project/$projectId/invitations"
                params={{ projectId }}
                className={`mt-2 flex items-center gap-1 text-xs font-medium ${meta.color} hover:underline`}
              >
                Review {pendingCount} pending request{pendingCount !== 1 ? "s" : ""}
                <ArrowRight size={11} />
              </Link>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function ProjectInviteLinksModal({
  isOpen,
  onClose,
  projectId,
  canManage = false,
}: ProjectInviteLinksModalProps) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [loadingRole, setLoadingRole] = useState<InvitationRoleType | null>(null);

  const linksQuery = useQuery({
    queryKey: ["project-invitation-links", projectId],
    queryFn: () => getInvitationLinks(projectId),
    enabled: isOpen && !!projectId,
  });

  const requestsQuery = useQuery({
    queryKey: ["project-invitation-requests", projectId, "pending"],
    queryFn: () => getInvitationRequests(projectId, "pending"),
    enabled: isOpen && !!projectId && canManage,
  });

  const createMutation = useMutation({
    mutationFn: (roleType: InvitationRoleType) =>
      createInvitationLink(projectId, roleType),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project-invitation-links", projectId] });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to generate link");
    },
  });

  const revokeMutation = useMutation({
    mutationFn: ({ linkId }: { linkId: string }) =>
      revokeInvitationLink(projectId, linkId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project-invitation-links", projectId] });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to revoke link");
    },
  });

  const links = linksQuery.data ?? [];
  const pendingRequests = requestsQuery.data ?? [];

  const linkByRole = (role: InvitationRoleType): InvitationLink | undefined =>
    links.find((l) => l.role_type === role && l.is_active);

  const pendingByRole = (role: InvitationRoleType): number =>
    pendingRequests.filter((r) => r.role_requested === role).length;

  const totalPending = pendingRequests.length;
  const activeLinksCount = ROLE_ORDER.filter((r) => linkByRole(r)).length;

  const handleToggle = async (
    roleType: InvitationRoleType,
    currentLink: InvitationLink | undefined,
  ) => {
    if (!canManage) return;
    setLoadingRole(roleType);
    try {
      if (currentLink?.is_active) {
        await revokeMutation.mutateAsync({ linkId: currentLink.id });
        toast.success("Invitation link disabled");
      } else {
        await createMutation.mutateAsync(roleType);
        toast.success("Invitation link generated");
      }
    } finally {
      setLoadingRole(null);
    }
  };

  const handleRegenerate = async (roleType: InvitationRoleType) => {
    if (!canManage) return;
    setLoadingRole(roleType);
    try {
      await createMutation.mutateAsync(roleType);
      toast.success("New link generated — old link is now invalid");
    } finally {
      setLoadingRole(null);
    }
  };

  if (!isOpen) return null;

  const modal = (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 px-4 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 8 }}
        transition={{ duration: 0.18, ease: "easeOut" }}
        className="w-full max-w-lg rounded-2xl bg-white shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Invite to Project</h2>
            <p className="mt-0.5 text-xs text-gray-500">
              {canManage
                ? "Generate role-specific links — anyone with the link can request access"
                : "Share these links to invite people to the project"}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
          >
            <X size={18} />
          </button>
        </div>

        {/* Member read-only notice */}
        {!canManage && (
          <div className="mx-6 mt-4 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
            <Lock size={13} className="shrink-0 text-amber-500" />
            <p className="text-xs text-amber-700">
              Only the project consultant can enable or disable links. You can copy and share active ones below.
            </p>
          </div>
        )}

        {/* Body */}
        <div className="space-y-3 p-6">
          {linksQuery.isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 size={24} className="animate-spin text-gray-400" />
            </div>
          ) : (
            ROLE_ORDER.map((role) => (
              <RoleLinkCard
                key={role}
                projectId={projectId}
                roleType={role}
                link={linkByRole(role)}
                pendingCount={pendingByRole(role)}
                canManage={canManage}
                onToggle={handleToggle}
                onRegenerate={handleRegenerate}
                isLoading={loadingRole === role}
              />
            ))
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-gray-100 px-6 py-4">
          {canManage ? (
            totalPending > 0 ? (
              <Link
                to="/project/$projectId/invitations"
                params={{ projectId }}
                onClick={onClose}
                className="flex items-center gap-1.5 text-sm font-medium text-[#ff9933] hover:underline"
              >
                Manage all {totalPending} pending request{totalPending !== 1 ? "s" : ""}
                <ArrowRight size={14} />
              </Link>
            ) : (
              <Link
                to="/project/$projectId/invitations"
                params={{ projectId }}
                onClick={onClose}
                className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700"
              >
                View invitation requests
                <ArrowRight size={14} />
              </Link>
            )
          ) : (
            <p className="text-xs text-gray-400">
              {activeLinksCount} active link{activeLinksCount !== 1 ? "s" : ""}
            </p>
          )}
          <button
            onClick={onClose}
            className="rounded-xl border border-gray-200 px-4 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-50"
          >
            Done
          </button>
        </div>
      </motion.div>
    </div>
  );

  return createPortal(modal, document.body);
}
