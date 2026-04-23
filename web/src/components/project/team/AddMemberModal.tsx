import { useState } from "react";
import { X, Plus } from "lucide-react";
import { useProjectInviteMemberMutation } from "@/hooks/useProjectQueries";
import { useToast } from "@/hooks/useToast";

interface AddMemberModalProps {
  projectId: string;
  onClose: () => void;
}

type InviteRole = "consultant" | "client" | "member";

const ROLE_CONFIG: Record<
  InviteRole,
  { label: string; description: string; accent: string; bg: string; border: string; ring: string }
> = {
  consultant: {
    label: "Consultant",
    description: "Full project access, billing, and settings",
    accent: "text-violet-700",
    bg: "bg-violet-50",
    border: "border-violet-300",
    ring: "ring-violet-500",
  },
  client: {
    label: "Client",
    description: "Project visibility and feedback",
    accent: "text-blue-700",
    bg: "bg-blue-50",
    border: "border-blue-300",
    ring: "ring-blue-500",
  },
  member: {
    label: "Freelancer",
    description: "Task execution and time logging",
    accent: "text-emerald-700",
    bg: "bg-emerald-50",
    border: "border-emerald-300",
    ring: "ring-emerald-500",
  },
};

export function AddMemberModal({ projectId, onClose }: AddMemberModalProps) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InviteRole>("member");
  const [position, setPosition] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inviteMemberMutation = useProjectInviteMemberMutation(projectId);
  const toast = useToast();
  const saving = inviteMemberMutation.isPending;

  const handleRoleChange = (r: InviteRole) => {
    setRole(r);
    if (r !== "member") setPosition("");
    setError(null);
  };

  const submit = async () => {
    if (!email.trim()) {
      setError("Email is required.");
      return;
    }
    if (role === "member" && !position.trim()) {
      setError("Position / Title is required for Freelancers.");
      return;
    }
    setError(null);
    try {
      await inviteMemberMutation.mutateAsync({
        email: email.trim(),
        role,
        position: role === "member" ? position.trim() : undefined,
      });
      const roleLabel = ROLE_CONFIG[role].label;
      toast.success(`Invite sent to ${email.trim()} as ${roleLabel}.`);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send invite.");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
          <h2 className="text-[15px] font-semibold text-gray-900">
            Add Team Member
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* Role selector */}
          <div>
            <label className="block text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
              Role
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(["consultant", "client", "member"] as InviteRole[]).map((r) => {
                const cfg = ROLE_CONFIG[r];
                const selected = role === r;
                return (
                  <button
                    key={r}
                    type="button"
                    onClick={() => handleRoleChange(r)}
                    className={`flex flex-col items-start gap-1 rounded-xl border px-3 py-2.5 text-left transition-all ${
                      selected
                        ? `${cfg.bg} ${cfg.border} ring-1 ${cfg.ring}`
                        : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
                    }`}
                  >
                    <span
                      className={`text-xs font-bold ${selected ? cfg.accent : "text-gray-700"}`}
                    >
                      {cfg.label}
                    </span>
                    <span className="text-[10px] leading-tight text-gray-400">
                      {cfg.description}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Email */}
          <div>
            <label className="block text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
              Email Address
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submit();
              }}
              placeholder="member@example.com"
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-slate-300 focus:border-slate-500 placeholder:text-gray-300"
            />
            <p className="mt-1.5 text-[11px] text-gray-400">
              If they already have an account they'll be notified right away. If
              not, they'll get the invite after signup.
            </p>
          </div>

          {/* Position — only for Freelancer */}
          {role === "member" && (
            <div>
              <label className="block text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
                Position / Title
              </label>
              <input
                type="text"
                value={position}
                onChange={(e) => setPosition(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void submit();
                }}
                placeholder="e.g. Backend Developer"
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-slate-300 focus:border-slate-500 placeholder:text-gray-300"
              />
            </div>
          )}

          {error && (
            <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2.5 border border-red-100">
              {error}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50/60">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors disabled:opacity-50 shadow-sm shadow-slate-900/20"
          >
            {saving ? (
              <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
            ) : (
              <Plus className="w-3.5 h-3.5" />
            )}
            Send Invite
          </button>
        </div>
      </div>
    </div>
  );
}
