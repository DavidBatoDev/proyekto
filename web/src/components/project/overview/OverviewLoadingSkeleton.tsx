export function OverviewLoadingSkeleton() {
  return (
    <div className="h-full w-full overflow-y-auto px-5 py-6 md:px-8 md:py-8">
      <div className="grid animate-pulse grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="app-surface-card space-y-7 p-6 md:p-8">
          <header className="space-y-3 pb-1">
            <div className="h-10 w-80 max-w-full rounded bg-slate-200" />
            <div className="h-4 w-72 max-w-full rounded bg-slate-200" />
          </header>

          <section className="space-y-4 border-b border-slate-200 pb-7">
            <div className="h-6 w-44 rounded bg-slate-200" />
            <div className="space-y-2">
              <div className="h-4 w-full rounded bg-slate-200" />
              <div className="h-4 w-[92%] rounded bg-slate-200" />
              <div className="h-4 w-[84%] rounded bg-slate-200" />
            </div>
          </section>

          <section className="space-y-4 border-b border-slate-200 pb-7">
            <div className="h-6 w-52 rounded bg-slate-200" />
            <div className="space-y-2">
              <div className="h-4 w-full rounded bg-slate-200" />
              <div className="h-4 w-[88%] rounded bg-slate-200" />
              <div className="h-4 w-[76%] rounded bg-slate-200" />
            </div>
          </section>

          <section className="space-y-4 border-b border-slate-200 pb-7">
            <div className="h-6 w-44 rounded bg-slate-200" />
            <div className="space-y-2">
              <div className="h-4 w-full rounded bg-slate-200" />
              <div className="h-4 w-[90%] rounded bg-slate-200" />
            </div>
          </section>

          <section className="space-y-4 border-b border-slate-200 pb-7">
            <div className="h-6 w-40 rounded bg-slate-200" />
            <div className="space-y-2">
              <div className="h-4 w-full rounded bg-slate-200" />
              <div className="h-4 w-[85%] rounded bg-slate-200" />
            </div>
          </section>
        </div>

        <aside className="sticky top-6 self-start space-y-5">
          <div className="app-surface-card p-5">
            <div className="mb-4 h-6 w-28 rounded bg-slate-200" />
            <div className="space-y-3">
              {Array.from({ length: 6 }).map((_, index) => (
                <div key={index} className="flex items-start gap-3">
                  <div className="h-8 w-8 shrink-0 rounded-full bg-slate-200" />
                  <div className="space-y-2 w-full">
                    <div className="h-4 w-[85%] rounded bg-slate-200" />
                    <div className="h-3 w-24 rounded bg-slate-200" />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="app-surface-card p-5">
            <div className="mb-3 h-6 w-28 rounded bg-slate-200" />
            <div className="flex items-center gap-2">
              {Array.from({ length: 4 }).map((_, index) => (
                <div
                  key={index}
                  className={`h-9 w-9 rounded-full bg-slate-200 ${index > 0 ? "-ml-2" : ""}`}
                />
              ))}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
