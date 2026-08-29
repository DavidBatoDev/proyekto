import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Loader2, MessageCircle, Pencil } from "lucide-react";
import { useState } from "react";
import { readChatDraftText, seedChatDraftText } from "@/hooks/useChatDraft";
import { useToast } from "@/hooks/useToast";
import { chatKeys } from "@/queries/chat";
import type { ServiceOfferingPackage } from "@/queries/serviceOfferings";
import { chatService } from "@/services/chat.service";
import { useAuthStore } from "@/stores/authStore";
import { contactSellerMessage } from "./contactSellerMessage";

/**
 * The service page's ask. Three branches:
 * - anonymous → signup with a redirect back here (StartSellingCtaButton's
 *   pattern — the login page drops return-to on its own);
 * - the seller looking at their own page → edit, never a self-DM;
 * - a signed-in buyer → resolve the DM, seed a draft naming the service and
 *   chosen tier (only when the composer is empty — a typed draft is theirs),
 *   and open the inbox on that room. Draft, never auto-send: repeat clicks
 *   must not spam the seller.
 */
export function ContactSellerButton({
	serviceId,
	sellerId,
	serviceTitle,
	currency,
	selectedPackage,
	label = "Contact about this package",
}: {
	serviceId: string;
	sellerId: string;
	serviceTitle: string;
	currency: string;
	selectedPackage?: Pick<ServiceOfferingPackage, "title" | "price"> | null;
	label?: string;
}) {
	const { isAuthenticated, user } = useAuthStore();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const toast = useToast();
	const [resolving, setResolving] = useState(false);

	const classes =
		"inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60";

	if (!isAuthenticated) {
		return (
			<Link
				to="/auth/signup"
				search={{ redirect: `/marketplace/services/${serviceId}` }}
				className={classes}
			>
				<MessageCircle className="h-4 w-4" />
				{label}
			</Link>
		);
	}

	if (user?.id === sellerId) {
		return (
			<Link
				to="/marketplace/services/$serviceId/edit"
				params={{ serviceId }}
				className={classes}
			>
				<Pencil className="h-4 w-4" />
				Edit this service
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
					contactSellerMessage(serviceTitle, currency, selectedPackage),
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
			className={classes}
		>
			{resolving ? (
				<Loader2 className="h-4 w-4 animate-spin" />
			) : (
				<MessageCircle className="h-4 w-4" />
			)}
			{label}
		</button>
	);
}
