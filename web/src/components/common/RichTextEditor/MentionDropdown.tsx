import { useEffect, useRef } from "react";
import type { MentionUser } from "./types";

interface MentionDropdownProps {
  users: MentionUser[];
  query: string;
  position: { top: number; left: number };
  onSelect: (user: MentionUser) => void;
  onClose: () => void;
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
}

export function MentionDropdown({
  users,
  query,
  position,
  onSelect,
  onClose,
  activeIndex,
  onActiveIndexChange,
}: MentionDropdownProps) {
  const filtered = users.filter((u) =>
    u.display_name.toLowerCase().includes(query.toLowerCase()),
  );
  const listRef = useRef<HTMLUListElement>(null);

  // Scroll active item into view
  useEffect(() => {
    const el = listRef.current?.children[activeIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  // Close on outside click
  useEffect(() => {
    const handleClick = () => onClose();
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  if (filtered.length === 0) return null;

  return (
    <ul
      ref={listRef}
      onMouseDown={(e) => e.preventDefault()} // prevent editor blur
      style={{ top: position.top, left: position.left }}
      className="fixed z-[200] bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[180px] max-w-[260px] max-h-48 overflow-y-auto"
    >
      {filtered.map((user, idx) => {
        const initials = user.display_name
          .split(" ")
          .map((p) => p[0])
          .join("")
          .slice(0, 2)
          .toUpperCase();

        return (
          <li
            key={user.id}
            onMouseEnter={() => onActiveIndexChange(idx)}
            onMouseDown={() => onSelect(user)}
            className={`flex items-center gap-2 px-3 py-2 cursor-pointer text-sm ${
              idx === activeIndex
                ? "bg-orange-50 text-orange-700"
                : "text-gray-700 hover:bg-gray-50"
            }`}
          >
            {user.avatar_url ? (
              <img
                src={user.avatar_url}
                alt={user.display_name}
                className="w-6 h-6 rounded-full shrink-0"
              />
            ) : (
              <span className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center text-[10px] font-semibold text-gray-600 shrink-0">
                {initials}
              </span>
            )}
            <span className="truncate">{user.display_name}</span>
          </li>
        );
      })}
    </ul>
  );
}
