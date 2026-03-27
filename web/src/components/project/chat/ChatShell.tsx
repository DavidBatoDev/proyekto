import { AnimatePresence, motion } from "framer-motion";
import type { ReactNode, RefObject } from "react";

export function ChatShell({
  sidebar,
  centerShellOverride,
  header,
  messages,
  typingIndicator,
  composer,
  profilePanel,
  isProfilePanelOpen = false,
  onCloseProfilePanel,
  messagesContainerRef,
}: {
  sidebar: ReactNode;
  centerShellOverride?: ReactNode;
  header: ReactNode;
  messages: ReactNode;
  typingIndicator?: ReactNode;
  composer: ReactNode;
  profilePanel?: ReactNode;
  isProfilePanelOpen?: boolean;
  onCloseProfilePanel?: () => void;
  messagesContainerRef?: RefObject<HTMLDivElement | null>;
}) {
  return (
    <div className="h-full overflow-hidden bg-[#f2f3f5]">
      <div className="h-full grid grid-cols-1 md:grid-cols-[320px_minmax(0,1fr)] xl:grid-cols-[320px_minmax(0,1fr)_minmax(320px,340px)]">
        {sidebar}

        <section className="h-full min-h-0 min-w-0 max-w-full overflow-hidden flex flex-col">
          {centerShellOverride ? (
            centerShellOverride
          ) : (
            <>
              {header}
              <div
                ref={messagesContainerRef}
                className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-3 py-4 md:px-6 md:py-5"
              >
                {messages}
              </div>
              <div className="relative">
                {typingIndicator ? (
                  <div className="pointer-events-none absolute left-3 bottom-full z-20 mb-2 md:left-6">
                    {typingIndicator}
                  </div>
                ) : null}
                {composer}
              </div>
            </>
          )}
        </section>

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
                className="xl:hidden fixed inset-0 z-40 bg-black/35"
                aria-label="Close member panel"
              />
              <motion.aside
                initial={{ x: 24, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: 24, opacity: 0 }}
                transition={{ duration: 0.22, ease: "easeOut" }}
                className="fixed xl:static right-0 top-0 z-50 h-full w-[340px] max-w-[92vw] overflow-y-auto border-l border-gray-200 bg-[#f5f6f8] shadow-[0_16px_40px_rgba(0,0,0,0.16)] xl:shadow-none"
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
