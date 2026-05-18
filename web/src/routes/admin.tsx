import {
  createFileRoute,
  redirect,
  Link,
  Outlet,
  useNavigate,
  useLocation,
} from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { adminService } from "@/services/admin.service";
import { useAuthStore } from "@/stores/authStore";
import {
  Loader2,
  ShieldCheck,
  Users,
  Briefcase,
  Settings,
  LayoutGrid,
  ArrowLeft,
} from "lucide-react";

export const Route = createFileRoute("/admin")({
  beforeLoad: () => {
    const { isAuthenticated } = useAuthStore.getState();
    if (!isAuthenticated) throw redirect({ to: "/auth/login" });
  },
  component: AdminLayout,
});

const NAV_ITEMS = [
  {
    to: "/admin/applications",
    label: "Applications",
    icon: LayoutGrid,
    description: "Review consultant applications",
  },
  {
    to: "/admin/approve-admin",
    label: "Approve Admins",
    icon: Users,
    description: "Manage admin access",
  },
  {
    to: "/admin/match",
    label: "Match Projects",
    icon: Briefcase,
    description: "Assign consultants to projects",
  },
  {
    to: "/admin/settings",
    label: "Settings",
    icon: Settings,
    description: "System configuration",
  },
];

function AdminLayout() {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const { data: adminProfile, isLoading } = useQuery({
    queryKey: ["adminMe"],
    queryFn: () => adminService.getMe(),
    enabled: !!user?.id,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-amber-500 animate-spin" />
      </div>
    );
  }

  if (!adminProfile) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center text-center px-6">
        <div>
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <ShieldCheck className="w-8 h-8 text-red-500" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">
            Access Denied
          </h2>
          <p className="text-gray-500 mb-6">
            You don't have admin privileges to access this area.
          </p>
          <button
            onClick={() => navigate({ to: "/dashboard" })}
            className="px-6 py-2.5 bg-amber-500 text-white rounded-full font-bold hover:bg-amber-600 transition-colors"
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  const currentPath =
    pathname.endsWith("/") && pathname !== "/"
      ? pathname.slice(0, -1)
      : pathname;

  return (
    <div className="h-screen overflow-hidden bg-gray-50 flex flex-col">
      {/* Admin Banner */}
      <div className="bg-amber-500 text-white px-6 py-2 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4" />
          <span className="text-sm font-bold uppercase tracking-wider">
            Admin Console
          </span>
          <span className="ml-2 px-2 py-0.5 bg-white/20 rounded text-xs capitalize">
            {adminProfile.access_level}
          </span>
        </div>
        <span className="text-xs text-white/70">Proyekto Work Hub</span>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className="w-64 bg-white border-r border-gray-200 flex flex-col shrink-0">
          {/* User info */}
          <div className="p-5 border-b border-gray-100">
            <div className="flex items-center gap-3">
              {user?.user_metadata?.avatar_url ? (
                <img
                  src={user.user_metadata.avatar_url}
                  className="w-10 h-10 rounded-full object-cover"
                />
              ) : (
                <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
                  <Users className="w-5 h-5 text-amber-600" />
                </div>
              )}
              <div className="min-w-0">
                <p className="text-sm font-bold text-gray-900 truncate">
                  {user?.user_metadata?.display_name ??
                    user?.email?.split("@")[0]}
                </p>
                <p className="text-xs text-amber-600 capitalize font-medium">
                  {adminProfile.access_level}
                </p>
              </div>
            </div>
          </div>

          {/* Nav */}
          <nav className="flex-1 py-3 space-y-0.5 px-3">
            {NAV_ITEMS.map((item) => {
              const isActive =
                currentPath === item.to ||
                currentPath.startsWith(`${item.to}/`);
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all text-sm font-medium group ${
                    isActive
                      ? "bg-amber-50 text-amber-700 border border-amber-200"
                      : "text-gray-600 hover:text-gray-900 hover:bg-gray-50"
                  }`}
                >
                  <item.icon
                    className={`w-4 h-4 shrink-0 ${isActive ? "text-amber-600" : "text-gray-400 group-hover:text-gray-600"}`}
                  />
                  {item.label}
                </Link>
              );
            })}
          </nav>

          {/* Back to app */}
          <div className="p-4 border-t border-gray-100">
            <button
              onClick={() => navigate({ to: "/dashboard" })}
              className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-800 transition-colors w-full"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to App
            </button>
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 overflow-hidden bg-gray-50">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
