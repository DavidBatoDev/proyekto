import { Camera, Loader2 } from "lucide-react";
import { useState } from "react";
import { UploadModal } from "@/components/profile/UploadModal";
import { TeamAvatar } from "@/components/team/TeamAvatar";
import { useToast } from "@/hooks/useToast";
import type { Team } from "@/services/teams.service";
import { uploadService } from "@/services/upload.service";
import { useTeamPatch } from "./useTeamPatch";

/**
 * The team avatar, changeable from the Overview instead of only from
 * Settings → General. Same upload path as that page; the new part is the hover
 * affordance, since a picture that is also a button has to say so.
 */
export function TeamAvatarField({
	team,
	canEdit,
}: {
	team: Team;
	canEdit: boolean;
}) {
	const toast = useToast();
	const patch = useTeamPatch(team.id);
	const [open, setOpen] = useState(false);
	const [isUploading, setIsUploading] = useState(false);

	const handleUpload = async (files: File[]) => {
		const file = files[0];
		if (!file) return;
		setIsUploading(true);
		let url: string;
		try {
			url = await uploadService.upload("avatars", file);
		} catch (err) {
			toast.error((err as Error).message || "Couldn't upload image.");
			setIsUploading(false);
			return;
		}
		try {
			await patch.mutateAsync({ avatar_url: url });
			setOpen(false);
		} catch {
			// useTeamPatch already surfaced the error.
		} finally {
			setIsUploading(false);
		}
	};

	if (!canEdit) {
		return <TeamAvatar team={team} size="lg" />;
	}

	return (
		<>
			<button
				type="button"
				onClick={() => setOpen(true)}
				aria-label="Change team photo"
				className="group relative shrink-0 rounded-2xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
			>
				<TeamAvatar team={team} size="lg" />
				<span className="absolute inset-0 flex items-center justify-center rounded-2xl bg-foreground/55 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
					{isUploading || patch.isPending ? (
						<Loader2 className="h-5 w-5 animate-spin text-background" />
					) : (
						<Camera className="h-5 w-5 text-background" />
					)}
				</span>
			</button>

			{open && (
				<UploadModal
					isOpen={open}
					onClose={() => setOpen(false)}
					title="Team photo"
					accept="image/jpeg,image/png,image/webp"
					maxFiles={1}
					aspectHint="1:1 (square)"
					onUpload={(files) => void handleUpload(files)}
					isUploading={isUploading}
				/>
			)}
		</>
	);
}
