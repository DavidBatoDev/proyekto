export function ThreadDateSeparator({ label }: { label: string }) {
  return (
    <div className="my-3 flex items-center gap-3">
      <div className="h-px flex-1 bg-gray-300/70" />
      <span className="text-xs font-semibold text-gray-500 md:text-sm">{label}</span>
      <div className="h-px flex-1 bg-gray-300/70" />
    </div>
  );
}
