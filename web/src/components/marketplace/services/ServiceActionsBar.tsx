import { useNavigate } from "@tanstack/react-router";
import { Check, Heart, Share2 } from "lucide-react";
import { useState } from "react";
import {
	useServiceLikeQuery,
	useSetServiceLikedMutation,
} from "@/hooks/useServiceOfferings";
import { useToast } from "@/hooks/useToast";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/authStore";

/**
 * Save and share, pinned above the packages rail.
 *
 * The count shown is the server's, not a local guess: other people are
 * liking the same service, so an optimistic ±1 would drift from the real
 * number the moment two viewers overlap. Signed-out visitors still see the
 * count (it rides on the public payload) and are sent to sign-up on tap
 * rather than hitting an authed route.
 */
export function ServiceActionsBar({
	serviceId,
	publicLikeCount,
}: {
	serviceId: string;
	publicLikeCount: number;
}) {
	const { isAuthenticated } = useAuthStore();
	const navigate = useNavigate();
	const toast = useToast();
	const [copied, setCopied] = useState(false);

	const likeQuery = useServiceLikeQuery(serviceId, isAuthenticated);
	const likeMutation = useSetServiceLikedMutation(serviceId);

	const liked = likeQuery.data?.liked ?? false;
	const count = likeQuery.data?.like_count ?? publicLikeCount;

	const toggleLike = () => {
		if (!isAuthenticated) {
			void navigate({
				to: "/auth/signup",
				search: { redirect: `/marketplace/services/${serviceId}` },
			});
			return;
		}
		likeMutation.mutate(!liked);
	};

	const share = async () => {
		const url = window.location.href;
		// The native sheet where there is one (mobile, Safari); a copied link
		// everywhere else, which is what people do with the sheet anyway.
		if (navigator.share) {
			try {
				await navigator.share({ url, title: document.title });
				return;
			} catch {
				// Cancelled or unavailable — fall through to copying.
			}
		}
		try {
			await navigator.clipboard.writeText(url);
			setCopied(true);
			window.setTimeout(() => setCopied(false), 2000);
		} catch {
			toast.error("Could not copy the link. Copy it from the address bar.");
		}
	};

	return (
		<div className="flex items-center justify-end gap-2">
			<button
				type="button"
				onClick={toggleLike}
				disabled={likeMutation.isPending}
				aria-pressed={liked}
				aria-label={liked ? "Remove from saved" : "Save this service"}
				title={liked ? "Saved" : "Save this service"}
				className={cn(
					"inline-flex cursor-pointer items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-60",
					liked ? "text-primary" : "text-muted-foreground",
				)}
			>
				<Heart className={cn("h-4 w-4", liked && "fill-current")} />
				{count > 0 && (
					<span className="tabular-nums text-foreground">{count}</span>
				)}
			</button>

			<button
				type="button"
				onClick={() => void share()}
				aria-label="Share this service"
				title="Share this service"
				className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted"
			>
				{copied ? (
					<>
						<Check className="h-4 w-4 text-primary" />
						<span className="text-foreground">Copied</span>
					</>
				) : (
					<Share2 className="h-4 w-4" />
				)}
			</button>
		</div>
	);
}
