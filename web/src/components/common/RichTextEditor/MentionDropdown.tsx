import { Mail } from "lucide-react";
import { useEffect, useRef } from "react";
import type { MentionTarget } from "./mentionCandidates";

interface MentionDropdownProps {
	/**
	 * Already filtered and ordered by `buildMentionCandidates`. This component
	 * deliberately does no filtering of its own — it used to, and a second copy
	 * of the predicate is how the highlighted row and the Enter-selected row
	 * drift apart.
	 */
	candidates: MentionTarget[];
	position: { top: number; left: number };
	onSelect: (target: MentionTarget) => void;
	onClose: () => void;
	activeIndex: number;
	onActiveIndexChange: (index: number) => void;
}

export function MentionDropdown({
	candidates,
	position,
	onSelect,
	onClose,
	activeIndex,
	onActiveIndexChange,
}: MentionDropdownProps) {
	const listRef = useRef<HTMLUListElement>(null);

	// Scroll active item into view
	useEffect(() => {
		const el = listRef.current?.children[activeIndex] as
			| HTMLElement
			| undefined;
		el?.scrollIntoView({ block: "nearest" });
	}, [activeIndex]);

	// Close on outside click
	useEffect(() => {
		const handleClick = () => onClose();
		document.addEventListener("mousedown", handleClick);
		return () => document.removeEventListener("mousedown", handleClick);
	}, [onClose]);

	if (candidates.length === 0) return null;

	return (
		<ul
			ref={listRef}
			onMouseDown={(e) => e.preventDefault()} // prevent editor blur
			style={{ top: position.top, left: position.left }}
			className="fixed z-[200] bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[180px] max-w-[280px] max-h-48 overflow-y-auto"
		>
			{candidates.map((candidate, idx) => {
				const isActive = idx === activeIndex;
				const rowClass = `flex items-center gap-2 px-3 py-2 cursor-pointer text-sm ${
					isActive
						? "bg-orange-50 text-orange-700"
						: "text-gray-700 hover:bg-gray-50"
				}`;

				if (candidate.kind === "email") {
					return (
						<li
							key={`invite:${candidate.email}`}
							onMouseEnter={() => onActiveIndexChange(idx)}
							onMouseDown={() => onSelect(candidate)}
							className={rowClass}
						>
							<span className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
								<Mail className="w-3.5 h-3.5 text-primary" />
							</span>
							<span className="truncate">
								Invite <strong>{candidate.email}</strong>
							</span>
						</li>
					);
				}

				const { user } = candidate;
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
						onMouseDown={() => onSelect(candidate)}
						className={rowClass}
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
