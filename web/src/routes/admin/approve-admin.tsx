import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Search, ShieldCheck, UserPlus, UserX } from "lucide-react";
import {
  adminService,
  type AdminAccessLevel,
  type AdminProfile,
} from "@/services/admin.service";
import { useToast } from "@/hooks/useToast";
import { ScrollNavButtons } from "@/components/common/ScrollNavButtons";

export const Route = createFileRoute("/admin/approve-admin")({
  component: ApproveAdminPage,
});

type ProfileUser = {
  id: string;
  display_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  avatar_url?: string | null;
  created_at?: string;
};

function userName(user: ProfileUser) {
  const full = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
  return user.display_name || full || user.email || "Unknown User";
}

function accessBadge(accessLevel: AdminAccessLevel) {
  if (accessLevel === "super_admin") return "bg-purple-100 text-purple-700";
  if (accessLevel === "moderator") return "bg-blue-100 text-blue-700";
  return "bg-amber-100 text-amber-700";
}

function AdminUserRow({
  user,
  activeAdmin,
  onGrant,
  onRevoke,
  isGranting,
  isRevoking,
}: {
  user: ProfileUser;
  activeAdmin?: AdminProfile;
  onGrant: (payload: {
    userId: string;
    accessLevel: AdminAccessLevel;
    department?: string;
  }) => void;
  onRevoke: (userId: string) => void;
  isGranting: boolean;
  isRevoking: boolean;
}) {
  const [accessLevel, setAccessLevel] = useState<AdminAccessLevel>(
    activeAdmin?.access_level ?? "support",
  );
  const [department, setDepartment] = useState(activeAdmin?.department ?? "");

  return (
    <div className="border border-gray-200 bg-white rounded-xl p-4">
      <div className="flex items-center gap-3">
        {user.avatar_url ? (
          <img
            src={user.avatar_url}
            className="w-10 h-10 rounded-full object-cover shrink-0"
          />
        ) : (
          <div className="w-10 h-10 rounded-full bg-gray-100 text-gray-600 font-semibold flex items-center justify-center shrink-0">
            {(userName(user).trim()[0] ?? "?").toUpperCase()}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-gray-900 truncate">
            {userName(user)}
          </p>
          <p className="text-xs text-gray-500 truncate">{user.email ?? "No email"}</p>
        </div>
        {activeAdmin ? (
          <span
            className={`text-xs px-2 py-1 rounded-full font-semibold capitalize ${accessBadge(activeAdmin.access_level)}`}
          >
            {activeAdmin.access_level.replace("_", " ")}
          </span>
        ) : (
          <span className="text-xs px-2 py-1 rounded-full font-semibold bg-gray-100 text-gray-600">
            Not Admin
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4">
        <select
          value={accessLevel}
          onChange={(e) => setAccessLevel(e.target.value as AdminAccessLevel)}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
        >
          <option value="support">support</option>
          <option value="moderator">moderator</option>
          <option value="super_admin">super_admin</option>
        </select>
        <input
          value={department}
          onChange={(e) => setDepartment(e.target.value)}
          placeholder="Department (optional)"
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm"
        />
        <div className="flex gap-2">
          <button
            onClick={() =>
              onGrant({
                userId: user.id,
                accessLevel,
                department: department.trim() || undefined,
              })
            }
            disabled={isGranting}
            className="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 bg-amber-500 text-white rounded-lg text-sm font-semibold hover:bg-amber-600 disabled:opacity-60"
          >
            {isGranting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <UserPlus className="w-4 h-4" />
            )}
            {activeAdmin ? "Update" : "Grant"}
          </button>
          {activeAdmin && (
            <button
              onClick={() => onRevoke(user.id)}
              disabled={isRevoking}
              className="inline-flex items-center justify-center gap-2 px-3 py-2 border border-red-200 text-red-600 rounded-lg text-sm font-semibold hover:bg-red-50 disabled:opacity-60"
            >
              {isRevoking ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <UserX className="w-4 h-4" />
              )}
              Revoke
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ApproveAdminPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "admins" | "non-admins">("all");

  const { data: admins = [], isLoading: adminsLoading } = useQuery({
    queryKey: ["adminAdmins"],
    queryFn: () => adminService.getAdmins(),
  });

  const { data: users = [], isLoading: usersLoading } = useQuery({
    queryKey: ["adminUsers"],
    queryFn: () => adminService.getAllUsers(),
  });

  const adminByUserId = useMemo(() => {
    const map = new Map<string, AdminProfile>();
    for (const admin of admins) map.set(admin.user_id, admin);
    return map;
  }, [admins]);

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();

    return (users as ProfileUser[]).filter((user) => {
      const isAdmin = adminByUserId.has(user.id);
      if (filter === "admins" && !isAdmin) return false;
      if (filter === "non-admins" && isAdmin) return false;

      if (!q) return true;
      return (
        userName(user).toLowerCase().includes(q) ||
        (user.email ?? "").toLowerCase().includes(q)
      );
    });
  }, [users, search, filter, adminByUserId]);

  const grantAdmin = useMutation({
    mutationFn: (payload: {
      userId: string;
      accessLevel: AdminAccessLevel;
      department?: string;
    }) =>
      adminService.grantAdmin(payload.userId, {
        access_level: payload.accessLevel,
        department: payload.department,
      }),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["adminAdmins"] }),
        qc.invalidateQueries({ queryKey: ["adminUsers"] }),
      ]);
      toast.success("Admin access updated.");
    },
    onError: () => {
      toast.error("Failed to update admin access.");
    },
  });

  const revokeAdmin = useMutation({
    mutationFn: (userId: string) => adminService.revokeAdmin(userId),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["adminAdmins"] }),
        qc.invalidateQueries({ queryKey: ["adminUsers"] }),
      ]);
      toast.success("Admin access revoked.");
    },
    onError: () => {
      toast.error("Failed to revoke admin access.");
    },
  });

  if (adminsLoading || usersLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-amber-500" />
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto px-8 py-8">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="bg-white border border-gray-200 rounded-2xl p-6">
          <div className="flex items-start justify-between gap-6">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Approve Admins</h1>
              <p className="text-sm text-gray-500 mt-1">
                Grant, update, or revoke admin console access from `admin_profiles`.
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs uppercase tracking-wide text-gray-400">Active Admins</p>
              <p className="text-2xl font-bold text-amber-600">{admins.length}</p>
            </div>
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-2xl p-6">
          <div className="flex items-center gap-2 mb-4">
            <ShieldCheck className="w-4 h-4 text-amber-600" />
            <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wider">
              Current Admins
            </h2>
          </div>
          {admins.length === 0 ? (
            <p className="text-sm text-gray-500">No active admins found.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {admins.map((admin) => (
                <div
                  key={admin.user_id}
                  className="border border-gray-200 rounded-xl px-4 py-3 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">
                      {admin.user?.display_name || admin.user?.email || admin.user_id}
                    </p>
                    <p className="text-xs text-gray-500 truncate">{admin.user?.email}</p>
                  </div>
                  <span
                    className={`shrink-0 text-xs px-2 py-1 rounded-full font-semibold capitalize ${accessBadge(admin.access_level)}`}
                  >
                    {admin.access_level.replace("_", " ")}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white border border-gray-200 rounded-2xl p-6">
          <div className="flex flex-col md:flex-row md:items-center gap-3 mb-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search users by name or email"
                className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm"
              />
            </div>
            <div className="flex gap-2">
              {[
                { label: "All", value: "all" as const },
                { label: "Admins", value: "admins" as const },
                { label: "Non-admins", value: "non-admins" as const },
              ].map((item) => (
                <button
                  key={item.value}
                  onClick={() => setFilter(item.value)}
                  className={`px-3 py-2 rounded-lg text-sm font-medium ${
                    filter === item.value
                      ? "bg-amber-500 text-white"
                      : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          {filteredUsers.length === 0 ? (
            <p className="text-sm text-gray-500">No users match your filter.</p>
          ) : (
            <div className="space-y-3">
              {filteredUsers.map((user) => {
                const activeAdmin = adminByUserId.get(user.id);
                return (
                  <AdminUserRow
                    key={user.id}
                    user={user}
                    activeAdmin={activeAdmin}
                    onGrant={(payload) => grantAdmin.mutate(payload)}
                    onRevoke={(userId) => revokeAdmin.mutate(userId)}
                    isGranting={grantAdmin.isPending}
                    isRevoking={revokeAdmin.isPending}
                  />
                );
              })}
            </div>
          )}
        </div>
      </div>
      <ScrollNavButtons />
    </div>
  );
}
