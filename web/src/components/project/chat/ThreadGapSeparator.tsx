export function ThreadGapSeparator({ label }: { label: string }) {
  return (
    <div className="my-2 flex items-center gap-2">
      <div className="h-px flex-1 bg-gray-300/60" />
      <span className="text-[12px] font-medium text-gray-400">{label}</span>
      <div className="h-px flex-1 bg-gray-300/60" />
    </div>
  );
}
