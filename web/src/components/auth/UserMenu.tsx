import { useState, useRef, useEffect } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useAuthStore } from "@/stores/authStore";
import { User, LogOut, ChevronDown } from "lucide-react";

export default function UserMenu() {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const { user, profile, signOut } = useAuthStore();
  const navigate = useNavigate();

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  const getDisplayName = () => {
    if (profile?.display_name) {
      return profile.display_name;
    }
    if (profile?.first_name) {
      return `${profile.first_name} ${profile.last_name || ""}`.trim();
    }
    return profile?.email?.split("@")[0] || "User";
  };

  const handleLogout = async () => {
    await signOut();
    setIsOpen(false);
    navigate({ to: "/" });
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 p-2 rounded-lg hover:bg-gray-100 transition-colors"
        aria-label="User menu"
      >
        {profile?.avatar_url ? (
          <img
            src={profile.avatar_url}
            alt={profile.display_name || "User avatar"}
            className="w-10 h-10 rounded-full object-cover border border-slate-300"
          />
        ) : (
          <div className="w-12 h-12 rounded-full bg-linear-to-br from-slate-800 to-slate-900 text-white flex items-center justify-center font-semibold text-lg border border-slate-700">
            {getDisplayName().charAt(0).toUpperCase()}
          </div>
        )}
        <ChevronDown
          size={16}
          className={`transition-transform ${isOpen ? "rotate-180" : ""} text-black`}
        />
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-56 bg-white rounded-lg shadow-lg border border-gray-200 py-2 z-50">
          {/* User info */}
          <div className="px-4 py-3 border-b border-gray-100">
            <p className="text-sm font-semibold text-gray-900">
              {profile?.display_name ||
                `${profile?.first_name || ""} ${profile?.last_name || ""}`.trim() ||
                "User"}
            </p>
            <p className="text-xs text-gray-500 truncate">{profile?.email}</p>
          </div>

          {/* Menu items */}
          <div className="py-1">
            <Link
              to="/profile/$profileId"
              params={{ profileId: user?.id || "" }}
              onClick={() => setIsOpen(false)}
              className="flex items-center gap-3 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <User size={16} />
              Profile
            </Link>

            <button
              onClick={handleLogout}
              className="flex items-center gap-3 w-full px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
            >
              <LogOut size={16} />
              Logout
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
