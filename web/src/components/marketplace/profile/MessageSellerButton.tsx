import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Loader2, MessageCircle } from "lucide-react";
import { useState } from "react";
import { readChatDraftText, seedChatDraftText } from "@/hooks/useChatDraft";
import { useToast } from "@/hooks/useToast";
import { chatKeys } from "@/queries/chat";
import { chatService } from "@/services/chat.service";
import { useAuthStore } from "@/stores/authStore";

/**
 * The profile-page DM ask, extracted from ContactSellerButton's flow but
 * without the service framing: resolve the DM (the backend allows it because
 * the recipient is an active seller), seed a greeting only when the composer
 * is empty — a typed draft is theirs — and open the inbox on that room.
 * Draft, never auto-send.
 *
 * Anonymous viewers go to signup with a redirect back here. Callers must not
 * render this for the owner — the backend refuses a self-DM.
 */
export function MessageSellerButton({
	sellerId,
	sellerName,
	redirectTo,
	className,
}: {
	sellerId: string;
	sellerName: string;
	/** Where signup should land the visitor afterwards, e.g. the profile URL. */
	redirectTo: string;
	className: string;
}) {
	const { isAuthenticated } = useAuthStore();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const toast = useToast();
	const [resolving, setResolving] = useState(false);

	if (!isAuthenticated) {
		return (
			<Link
				to="/auth/signup"
				search={{ redirect: redirectTo }}
				className={className}
			>
				<MessageCircle className="h-4 w-4" />
				Message {sellerName}
			</Link>
		);
	}

	const contact = async () => {
		setResolving(true);
		try {
			const room = await chatService.resolveDm(sellerId);
			const draftKey = `dm:${sellerId}`;
			if (!readChatDraftText(draftKey)) {
				seedChatDraftText(
					draftKey,
					`Hi ${sellerName} — I found your profile on Proyekto and would like to talk about working together.`,
				);
			}
			await queryClient.invalidateQueries({ queryKey: chatKeys.dmRooms() });
			await navigate({ to: "/inbox", search: { r: room.id } });
		} catch {
			toast.error("Could not open a conversation. Please try again.");
		} finally {
			setResolving(false);
		}
	};

	return (
		<button
			type="button"
			onClick={() => void contact()}
			disabled={resolving}
			className={`${className} cursor-pointer disabled:opacity-60`}
		>
			{resolving ? (
				<Loader2 className="h-4 w-4 animate-spin" />
			) : (
				<MessageCircle className="h-4 w-4" />
			)}
			Message {sellerName}
		</button>
	);
}
