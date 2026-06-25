import { AnimatePresence, motion } from "framer-motion";
import type { ReactNode, RefObject } from "react";

export type MobileView = "list" | "chat" | "info";

export function ChatShell({
  sidebar,
  centerShellOverride,
  header,
  messages,
  messagesOverlay,
  typingIndicator,
  composer,
  profilePanel,
  isProfilePanelOpen = false,
  onCloseProfilePanel,
  messagesContainerRef,
  mobileView = "chat",
}: {
  sidebar: ReactNode;
  centerShellOverride?: ReactNode;
  header: ReactNode;
  messages: ReactNode;
  /** Floating UI pinned to the message area (e.g. the jump-to-latest button). */
  messagesOverlay?: ReactNode;
  typingIndicator?: ReactNode;
  composer: ReactNode;
  profilePanel?: ReactNode;
  isProfilePanelOpen?: boolean;
  onCloseProfilePanel?: () => void;
  messagesContainerRef?: RefObject<HTMLDivElement | null>;
  /** Controls which panel is visible on mobile. On md+ all columns are always shown. */
  mobileView?: MobileView;
}) {
  return (
    <div className="app-shell-bg h-full overflow-hidden">
      <div className="h-full md:grid md:grid-cols-[320px_minmax(0,1fr)] xl:grid-cols-[320px_minmax(0,1fr)_minmax(320px,340px)]">

        {/* ── Conversation list — full-screen page on mobile, static column on md+ ── */}
        <div className={`h-full ${mobileView === "list" ? "block" : "hidden"} md:block`}>
          {sidebar}
        </div>

        {/* ── Chat center — full-screen page on mobile, card-styled column on md+ ── */}
        <section
          className={`min-h-0 min-w-0 max-w-full flex-col overflow-hidden bg-white
            md:mx-4 md:my-4 md:h-[calc(100%-2rem)] md:rounded-[1.25rem] md:border md:border-[#c9d4e2] md:shadow-[0_16px_36px_rgba(15,23,42,0.1)]
            ${mobileView === "chat" ? "flex h-full" : "hidden"} md:flex`}
        >
          {centerShellOverride ? (
            centerShellOverride
          ) : (
            <>
              {header}
              <div className="relative min-h-0 flex-1">
                <div
                  ref={messagesContainerRef}
                  className="h-full overflow-x-hidden overflow-y-auto px-3 py-4 md:px-6 md:py-5"
                >
                  {messages}
                </div>
                {messagesOverlay}
              </div>
              <div className="relative">
                {typingIndicator ? (
                  <div className="pointer-events-none absolute bottom-full left-3 z-20 mb-2 md:left-6">
                    {typingIndicator}
                  </div>
                ) : null}
                {composer}
              </div>
            </>
          )}
        </section>

        {/* ── Right panel ──────────────────────────────────────────────────────────
            Mobile (< md):  full-screen page, shown when mobileView === "info"
            Tablet (md–xl): fixed overlay sliding from the right
            Desktop (xl+):  static grid column
        ─────────────────────────────────────────────────────────────────────── */}

        {/* Mobile full-screen info page */}
        {profilePanel && (
          <div
            className={`h-full overflow-y-auto border-l border-slate-200 bg-slate-50 md:hidden ${
              mobileView === "info" ? "block" : "hidden"
            }`}
          >
            {profilePanel}
          </div>
        )}

        {/* Tablet overlay + desktop static column */}
        <AnimatePresence>
          {profilePanel && isProfilePanelOpen && (
            <>
              <motion.button
                type="button"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                onClick={onCloseProfilePanel}
                className="fixed inset-0 z-40 hidden bg-black/35 md:block xl:hidden"
                aria-label="Close member panel"
              />
              <motion.aside
                initial={{ x: 24, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: 24, opacity: 0 }}
                transition={{ duration: 0.22, ease: "easeOut" }}
                className="fixed right-0 top-0 z-50 hidden h-full w-[340px] max-w-[92vw] overflow-y-auto border-l border-slate-200 bg-slate-50 shadow-[0_16px_40px_rgba(0,0,0,0.16)] md:block xl:static xl:shadow-none"
              >
                {profilePanel}
              </motion.aside>
            </>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
