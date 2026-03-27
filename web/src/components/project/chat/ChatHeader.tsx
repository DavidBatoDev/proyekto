import { Hash, MessageCircle, UserRoundSearch } from "lucide-react";
import { ChatAvatar } from "./Avatar";

export function ChatHeader({
  title,
  subtitle,
  isChannel,
  avatarUrl,
  isProfilePanelOpen,
  onToggleProfilePanel,
  onOpenSidebar,
}: {
  title: string;
  subtitle: string;
  isChannel: boolean;
  avatarUrl?: string | null;
  isProfilePanelOpen?: boolean;
  onToggleProfilePanel?: () => void;
  onOpenSidebar?: () => void;
}) {
  return (
    <header className="border-b border-gray-200 bg-white px-4 py-3 md:px-6 md:py-4 sticky top-0 z-10">
      <div className="flex items-center gap-3 justify-between">
        <div className="flex items-center gap-3 min-w-0">
        <button
          type="button"
          onClick={onOpenSidebar}
          className="md:hidden inline-flex h-8 w-8 items-center justify-center rounded-md border border-gray-200 text-gray-600"
          aria-label="Open conversations"
        >
          <MessageCircle className="w-4 h-4" />
        </button>

        {isChannel ? (
          <div className="w-9 h-9 rounded-full bg-gray-100 text-gray-700 flex items-center justify-center shrink-0">
            <Hash className="w-5 h-5" />
          </div>
        ) : (
          <ChatAvatar name={title} avatarUrl={avatarUrl} size="lg" />
        )}

        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold">
            {subtitle}
          </p>
          <h2 className="text-lg font-semibold text-gray-900 truncate">{title}</h2>
        </div>
        </div>

        <button
          type="button"
          onClick={onToggleProfilePanel}
          className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition-colors ${
            isProfilePanelOpen
              ? "border-orange-300 bg-orange-50 text-orange-600"
              : "border-gray-200 text-gray-600 hover:bg-gray-50"
          }`}
          aria-label={isProfilePanelOpen ? "Hide member panel" : "Show member panel"}
        >
          <UserRoundSearch className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
}
