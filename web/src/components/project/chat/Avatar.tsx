export function ChatAvatar({
  name,
  avatarUrl,
  size = "md",
}: {
  name: string;
  avatarUrl?: string | null;
  size?: "sm" | "md" | "lg";
}) {
  const initials = name
    .split(" ")
    .map((part) => part[0] || "")
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const sizeClass =
    size === "sm" ? "w-7 h-7 text-[11px]" : size === "lg" ? "w-10 h-10 text-xs" : "w-8 h-8 text-[11px]";

  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={name}
        className={`${sizeClass} rounded-full object-cover object-top shrink-0`}
      />
    );
  }

  return (
    <div
      className={`${sizeClass} rounded-full bg-orange-100 text-orange-600 font-semibold flex items-center justify-center shrink-0`}
    >
      {initials || "?"}
    </div>
  );
}
