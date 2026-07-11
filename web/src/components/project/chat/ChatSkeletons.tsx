function PulseBlock({
  className,
  animated = true,
}: {
  className: string;
  animated?: boolean;
}) {
  return (
    <div className={`${className} bg-gray-200 ${animated ? "animate-pulse" : ""}`} />
  );
}

export function ChatSidebarSkeleton({ animated = true }: { animated?: boolean }) {
  return (
    <aside className="fixed md:static z-40 top-0 left-0 h-full w-[320px] border-r border-gray-200 bg-[#f8f8f9]">
      <div className="h-full overflow-y-auto">
        <div className="px-4 py-3 border-b border-gray-200 bg-[#f8f8f9] space-y-3">
          <PulseBlock className="h-7 w-44 rounded-md" animated={animated} />
          <div className="flex items-center justify-between">
            <PulseBlock className="h-3 w-10 rounded" animated={animated} />
            <PulseBlock className="h-5 w-9 rounded-full" animated={animated} />
          </div>
        </div>

        <div className="p-4">
          <PulseBlock className="h-10 w-full rounded-xl" animated={animated} />
        </div>

        <div className="px-4 pt-2 pb-5 border-t border-gray-200/80 space-y-2">
          <PulseBlock className="h-3 w-16 rounded" animated={animated} />
          <PulseBlock className="h-9 w-full rounded-lg" animated={animated} />
        </div>

        <div className="px-3 pb-4">
          <PulseBlock className="h-3 w-24 rounded mb-2" animated={animated} />
          <div className="space-y-2">
            {Array.from({ length: 7 }).map((_, index) => (
              <div key={`chat-sidebar-skeleton-${index}`} className="rounded-lg px-2 py-2.5">
                <div className="flex items-start gap-2.5">
                  <PulseBlock className="h-9 w-9 rounded-full shrink-0" animated={animated} />
                  <div className="min-w-0 flex-1 space-y-2">
                    <PulseBlock className="h-3.5 w-32 rounded" animated={animated} />
                    <PulseBlock className="h-3 w-44 rounded" animated={animated} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </aside>
  );
}

export function ChatCenterShellSkeleton({ animated = true }: { animated?: boolean }) {
  return (
    <>
      <header className="border-b border-gray-200 bg-white px-4 py-3 md:px-6 md:py-4 sticky top-0 z-10">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <PulseBlock className="h-10 w-10 rounded-full shrink-0" animated={animated} />
            <div className="min-w-0 space-y-2">
              <PulseBlock className="h-3 w-24 rounded" animated={animated} />
              <PulseBlock className="h-6 w-48 rounded" animated={animated} />
            </div>
          </div>
          <PulseBlock className="h-9 w-9 rounded-lg shrink-0" animated={animated} />
        </div>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-3 py-4 md:px-6 md:py-5">
        <div className="w-full max-w-4xl mr-auto min-w-0 space-y-4">
          {Array.from({ length: 9 }).map((_, index) => (
            <div key={`chat-center-skeleton-${index}`} className="flex items-start gap-3">
              <PulseBlock className="h-10 w-10 rounded-full shrink-0" animated={animated} />
              <div className="flex-1 min-w-0 space-y-2 pt-1">
                <PulseBlock className="h-3.5 w-48 rounded" animated={animated} />
                <PulseBlock className="h-3 w-[82%] rounded" animated={animated} />
                <PulseBlock className="h-3 w-[64%] rounded" animated={animated} />
              </div>
            </div>
          ))}
        </div>
      </div>

      <footer className="sticky bottom-0 border-t border-gray-200 bg-white px-3 py-3 md:px-6">
        <div className="rounded-3xl border border-border bg-muted px-3 py-2">
          <div className="flex items-center justify-between gap-3">
            <PulseBlock className="h-6 w-[72%] rounded" animated={animated} />
            <div className="inline-flex items-center gap-2">
              <PulseBlock className="h-8 w-8 rounded-full" animated={animated} />
              <PulseBlock className="h-9 w-9 rounded-full" animated={animated} />
            </div>
          </div>
        </div>
      </footer>
    </>
  );
}

export function ChatProfilePanelSkeleton({ animated = true }: { animated?: boolean }) {
  return (
    <div className="h-full flex flex-col">
      <div className="sticky top-0 z-10 border-b border-gray-200 bg-white/90 backdrop-blur px-3 py-3">
        <div className="flex items-center justify-between gap-2">
          <PulseBlock className="h-3 w-24 rounded" animated={animated} />
          <PulseBlock className="h-8 w-8 rounded-md" animated={animated} />
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-3 pt-3 pb-4">
        <PulseBlock className="h-3 w-28 rounded mb-2" animated={animated} />
        <div className="rounded-xl border border-gray-200 bg-white p-1.5 space-y-1.5">
          {Array.from({ length: 8 }).map((_, index) => (
            <div key={`chat-profile-skeleton-${index}`} className="rounded-lg px-2 py-2">
              <div className="flex items-center gap-2">
                <PulseBlock className="h-8 w-8 rounded-full shrink-0" animated={animated} />
                <div className="space-y-1.5">
                  <PulseBlock className="h-3.5 w-28 rounded" animated={animated} />
                  <PulseBlock className="h-3 w-24 rounded" animated={animated} />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
