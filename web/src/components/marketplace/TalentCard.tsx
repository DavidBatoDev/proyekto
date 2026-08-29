import { Link } from "@tanstack/react-router";
import { Briefcase, CheckCircle2, Star } from "lucide-react";
import type { MarketplaceTalentCard } from "@/services/profile.service";

interface TalentCardProps {
	talent: MarketplaceTalentCard;
	onInvite: (talent: MarketplaceTalentCard) => void;
}

function availabilityLabel(status: string) {
	if (status === "available")
		return { text: "Available", cls: "bg-green-100 text-green-700" };
	if (status === "partially_available")
		return { text: "Partially Available", cls: "bg-amber-100 text-amber-700" };
	return { text: "Unavailable", cls: "bg-gray-100 text-gray-700" };
}

export function TalentCard({ talent, onInvite }: TalentCardProps) {
	const fullName = talent.display_name || "Talent";
	const initial = fullName.slice(0, 1).toUpperCase();
	const availability = availabilityLabel(talent.availability);

	return (
		<div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 flex flex-col gap-4">
			<div className="flex items-start gap-3">
				{talent.avatar_url ? (
					<img
						src={talent.avatar_url}
						alt={fullName}
						className="w-14 h-14 rounded-full object-cover"
					/>
				) : (
					<div className="w-14 h-14 rounded-full bg-gray-800 text-white font-semibold flex items-center justify-center">
						{initial}
					</div>
				)}

				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-2">
						<h3 className="text-base font-semibold text-gray-900 truncate">
							{fullName}
						</h3>
						{talent.is_email_verified && (
							<CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
						)}
					</div>
					<p className="text-sm text-gray-500 truncate">
						{talent.headline || "No headline yet"}
					</p>
					<div className="mt-2 flex items-center gap-3 text-xs text-gray-500">
						<span className="inline-flex items-center gap-1">
							<Star className="w-3.5 h-3.5 text-amber-500" />
							{talent.avg_rating.toFixed(1)}
						</span>
						<span className={`px-2 py-0.5 rounded-full ${availability.cls}`}>
							{availability.text}
						</span>
					</div>
				</div>
			</div>

			<div className="flex items-center gap-2 text-sm text-gray-600">
				<Briefcase className="w-4 h-4" />
				<span>
					{talent.hourly_rate
						? `${talent.currency} ${talent.hourly_rate}/hr`
						: "Rate not set"}
				</span>
			</div>

			<div className="flex flex-wrap gap-2">
				{talent.skills.slice(0, 3).map((skill) => (
					<span
						key={skill.id}
						className="text-xs px-2.5 py-1 rounded-full bg-gray-100 text-gray-700"
					>
						{skill.name}
					</span>
				))}
				{talent.skills.length === 0 && (
					<span className="text-xs px-2.5 py-1 rounded-full bg-gray-100 text-gray-500">
						No skills listed
					</span>
				)}
			</div>

			<div className="mt-1 flex gap-2">
				<Link
					to="/marketplace/talent/$profileId"
					params={{ profileId: talent.id }}
					className="flex-1 text-center px-3 py-2 rounded-xl border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50"
				>
					View Profile
				</Link>
				<button
					type="button"
					onClick={() => onInvite(talent)}
					className="flex-1 px-3 py-2 rounded-xl bg-[#ff9933] text-white text-sm font-medium hover:bg-[#f28a22]"
				>
					Invite
				</button>
			</div>
		</div>
	);
}
