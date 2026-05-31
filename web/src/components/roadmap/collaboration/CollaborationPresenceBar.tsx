import type { CollaboratorInfo } from "@/hooks/useRoadmapCollaboration";

interface Props {
	collaborators: CollaboratorInfo[];
}

function getInitials(name: string): string {
	return name
		.split(/\s+/)
		.map((p) => p[0] ?? "")
		.join("")
		.slice(0, 2)
		.toUpperCase() || "?";
}

export function CollaborationPresenceBar({ collaborators }: Props) {
	if (collaborators.length === 0) return null;

	const visible = collaborators.slice(0, 5);
	const overflow = collaborators.length - visible.length;

	return (
		<div className="flex items-center gap-1" title="Collaborators currently viewing">
			{visible.map((c) => (
				<div
					key={c.userId}
					className="relative group"
					title={c.name}
				>
					{c.avatarUrl ? (
						<img
							src={c.avatarUrl}
							alt={c.name}
							className="w-6 h-6 rounded-full object-cover ring-2 ring-white shadow-sm"
							style={{ ringColor: c.color } as React.CSSProperties}
						/>
					) : (
						<div
							className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold text-white ring-2 ring-white shadow-sm"
							style={{ backgroundColor: c.color }}
						>
							{getInitials(c.name)}
						</div>
					)}
					{/* Tooltip — shows below the avatar to stay within the container */}
					<div className="absolute top-full left-1/2 -translate-x-1/2 mt-1.5 px-2 py-0.5 bg-gray-900 text-white text-[11px] rounded whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity shadow-lg z-50">
						{c.name}
					</div>
				</div>
			))}
			{overflow > 0 && (
				<div className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center text-[9px] font-bold text-gray-600 ring-2 ring-white shadow-sm">
					+{overflow}
				</div>
			)}
		</div>
	);
}
