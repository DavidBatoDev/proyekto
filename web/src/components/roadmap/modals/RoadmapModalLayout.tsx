import {
  useEffect,
  useMemo,
  useState,
  useRef,
  type ReactNode,
  type FormEvent,
} from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { X, Plus, Calendar, Paperclip } from "lucide-react";

interface RoadmapModalLayoutProps {
  isOpen: boolean;
  onClose: () => void;
  isReadOnly?: boolean;
  title: string;
  onTitleChange: (value: string) => void;
  titlePlaceholder: string;
  onSubmit: (e: FormEvent) => void;
  actionButtons?: ReactNode;
  showDefaultDatesAction?: boolean;
  body: ReactNode;
  footer: ReactNode;
  canComment: boolean;
  commentPlaceholder?: string;
  rightPanelTabs?: { id: string; label: string; content: ReactNode }[];
  defaultRightPanelTabId?: string;
  autoFocusTitle?: boolean;
}

export const RoadmapModalLayout = ({
  isOpen,
  onClose,
  isReadOnly = false,
  title,
  onTitleChange,
  titlePlaceholder,
  onSubmit,
  actionButtons,
  showDefaultDatesAction = true,
  body,
  footer,
  canComment,
  commentPlaceholder = "Write a comment...",
  rightPanelTabs,
  defaultRightPanelTabId,
  autoFocusTitle,
}: RoadmapModalLayoutProps) => {
  const scrollContainerRef = useRef<HTMLFormElement>(null);
  const [isScrolled, setIsScrolled] = useState(false);

  const tabs = useMemo(() => {
    if (rightPanelTabs?.length) {
      return rightPanelTabs;
    }

    return [
      {
        id: "comments",
        label: "Comments",
        content: canComment ? (
          <textarea
            placeholder={commentPlaceholder}
            className="w-full px-3 py-2 text-sm text-gray-700 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary resize-none"
            rows={3}
          />
        ) : (
          <div className="text-center py-8">
            <p className="text-sm text-gray-500 mb-2">
              Sign in to leave comments
            </p>
            <p className="text-xs text-gray-400">
              You need to be logged in to participate in discussions
            </p>
          </div>
        ),
      },
    ];
  }, [rightPanelTabs, canComment, commentPlaceholder]);

  const tabIdsSignature = useMemo(
    () => rightPanelTabs?.map((t) => t.id).join("|") ?? "comments",
    [rightPanelTabs],
  );

  const [activeTabId, setActiveTabId] = useState<string>(
    defaultRightPanelTabId ?? tabs[0]?.id ?? "",
  );

  useEffect(() => {
    setActiveTabId(defaultRightPanelTabId ?? tabs[0]?.id ?? "");
  }, [isOpen, defaultRightPanelTabId, tabIdsSignature]);

  useEffect(() => {
    const handleScroll = () => {
      if (scrollContainerRef.current) {
        // Show sticky header when scrolled more than 150px (approximate header height)
        setIsScrolled(scrollContainerRef.current.scrollTop > 150);
      }
    };

    const container = scrollContainerRef.current;
    if (container) {
      container.addEventListener("scroll", handleScroll);
      return () => container.removeEventListener("scroll", handleScroll);
    }
  }, []);

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-60 flex items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
        >
          {/* Backdrop */}
          <motion.div
            className="absolute inset-0 bg-black/50"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          />

          {/* Modal */}
          <motion.div
            className="relative bg-white rounded-xl shadow-2xl w-full max-w-6xl mx-4 max-h-[90vh] min-h-[600px] overflow-hidden flex"
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ duration: 0.24, ease: "easeOut" }}
          >
            {/* Main Content */}
            <form
              ref={scrollContainerRef}
              onSubmit={onSubmit}
              className="flex-1 flex flex-col overflow-y-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
              {/* Sticky Mini Header - Shows when scrolled */}
              <div
                className={`sticky top-0 z-10 bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between transition-all duration-200 ${
                  isScrolled
                    ? "opacity-100 translate-y-0"
                    : "opacity-0 -translate-y-full absolute pointer-events-none"
                }`}
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <button
                    type="button"
                    className="w-5 h-5 rounded-full border-2 border-gray-300 hover:border-gray-400 transition-colors shrink-0"
                    aria-label="Mark complete"
                  />
                  <h2 className="text-lg font-semibold text-gray-900 truncate">
                    {title || titlePlaceholder}
                  </h2>
                </div>
                {actionButtons && (
                  <div className="flex items-center gap-2 ml-4">
                    {actionButtons}
                  </div>
                )}
              </div>

              {/* Header */}
              <div className="px-12 pt-6 pb-6">
                <div className="flex items-center gap-3 mb-6">
                  <button
                    type="button"
                    disabled={isReadOnly}
                    className="w-6 h-6 rounded-full border-2 border-gray-300 hover:border-gray-400 transition-colors shrink-0"
                    aria-label="Mark complete"
                  />
                  <input
                    type="text"
                    autoFocus={autoFocusTitle}
                    value={title}
                    onChange={(e) => onTitleChange(e.target.value)}
                    readOnly={isReadOnly}
                    disabled={isReadOnly}
                    placeholder={titlePlaceholder}
                    required
                    className="text-4xl font-bold text-gray-900 border-none outline-none bg-transparent w-full placeholder:text-gray-300 disabled:opacity-60 disabled:cursor-not-allowed"
                  />
                </div>

                {/* Action Buttons */}
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    disabled={isReadOnly}
                    className="inline-flex items-center gap-2 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 rounded-md transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                    Add
                  </button>
                  {showDefaultDatesAction && (
                    <button
                      type="button"
                      disabled={isReadOnly}
                      className="inline-flex items-center gap-2 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 rounded-md transition-colors"
                    >
                      <Calendar className="w-4 h-4" />
                      Dates
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={isReadOnly}
                    className="inline-flex items-center gap-2 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 rounded-md transition-colors"
                  >
                    <Paperclip className="w-4 h-4" />
                    Attachment
                  </button>
                  {actionButtons}
                </div>
              </div>

              {/* Content */}
              <div className="px-12 pb-8">
                {body}
                {footer}
              </div>
            </form>

            {/* Right Panel - Comments */}
            <div className="w-96 border-l border-gray-200 flex flex-col bg-white">
              <div className="px-6 border-b border-gray-200 flex items-center justify-between">
                <div className="flex items-center flex-1 gap-0">
                  {tabs.map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setActiveTabId(tab.id)}
                      className={`relative px-4 py-3.5 text-sm font-medium transition-all duration-200 ${
                        activeTabId === tab.id
                          ? "text-gray-900"
                          : "text-gray-600 hover:text-gray-900"
                      }`}
                    >
                      {tab.label}
                      {activeTabId === tab.id && (
                        <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-linear-to-r from-primary to-primary/80" />
                      )}
                    </button>
                  ))}
                </div>
                <button
                  onClick={onClose}
                  className="p-1.5 rounded-md hover:bg-gray-100 transition-colors shrink-0"
                  aria-label="Close"
                >
                  <X className="w-5 h-5 text-gray-400 hover:text-gray-600" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-6 bg-gray-50">
                {tabs.find((tab) => tab.id === activeTabId)?.content}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
};
