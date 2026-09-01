import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AtSign, Bell, BellOff, Check, ChevronDown } from "lucide-react";
import { useRef, useState } from "react";
import { useDismissOnOutside } from "@/hooks/useDismissOnOutside";
import { useToast } from "@/hooks/useToast";
import {
	type ChatNotificationLevel,
	chatService,
} from "@/services/chat.service";

const OPTIONS: {
	level: ChatNotificationLevel;
	label: string;
	hint: string;
	icon: typeof Bell;
}[] = [
	{
		level: "all",
		label: "All messages",
		hint: "Notify me about every message here",
		icon: Bell,
	},
	{
		level: "mentions",
		label: "Mentions only",
		hint: "Only when someone @mentions me",
		icon: AtSign,
	},
	{
		level: "none",
		label: "Nothing",
		hint: "Mute this conversation",
		icon: BellOff,
	},
];

/**
 * Per-room notification control.
 *
 * Every room notifies on every message by default, which is the right call at
 * Proyekto's current volume but has to be escapable — otherwise the answer to a
 * busy channel is "turn off Proyekto" rather than "mute the room".
 *
 * Owns its own query so the header does not have to thread state through; the
 * preference is per-viewer and cheap.
 */
export function RoomNotificationMenu({ roomId }: { roomId: string }) {
	const [open, setOpen] = useState(false);
	const containerRef = useRef<HTMLDivElement>(null);
	const queryClient = useQueryClient();
	const toast = useToast();

	useDismissOnOutside(open, containerRef, () => setOpen(false));

	const { data } = useQuery({
		queryKey: ["chat", "room-notifications", roomId],
		queryFn: () => chatService.getRoomNotificationLevel(roomId),
		staleTime: 60_000,
	});

	const mutation = useMutation({
		mutationFn: (level: ChatNotificationLevel) =>
			chatService.setRoomNotificationLevel(roomId, level),
		onSuccess: (next) => {
			queryClient.setQueryData(["chat", "room-notifications", roomId], next);
			setOpen(false);
		},
		onError: () => toast.error("Could not change notifications for this room."),
	});

	const current = data?.level ?? "all";
	const Icon =
		current === "none" ? BellOff : current === "mentions" ? AtSign : Bell;

	return (
		<div className="relative" ref={containerRef}>
			<button
				type="button"
				onClick={() => setOpen((value) => !value)}
				aria-haspopup="menu"
				aria-expanded={open}
				aria-label="Notification settings for this conversation"
				className="inline-flex h-8 items-center gap-1 rounded-md border border-slate-200 px-2 text-slate-600 hover:bg-slate-50"
			>
				<Icon className="h-4 w-4" />
				<ChevronDown className="h-3 w-3" />
			</button>

			{open && (
				<div
					role="menu"
					className="absolute right-0 z-20 mt-1 w-64 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg"
				>
					{OPTIONS.map((option) => {
						const OptionIcon = option.icon;
						const active = current === option.level;
						return (
							<button
								type="button"
								role="menuitem"
								key={option.level}
								disabled={mutation.isPending}
								onClick={() => mutation.mutate(option.level)}
								className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-slate-50 disabled:opacity-50"
							>
								<OptionIcon className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
								<span className="min-w-0 flex-1">
									<span className="block text-sm font-medium text-slate-900">
										{option.label}
									</span>
									<span className="block text-xs text-slate-500">
										{option.hint}
									</span>
								</span>
								{active && (
									<Check className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
								)}
							</button>
						);
					})}
				</div>
			)}
		</div>
	);
}
