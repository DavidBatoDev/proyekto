import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "@/lib/supabase";

export function useNotificationsRealtime(userId?: string | null) {
	const queryClient = useQueryClient();

	useEffect(() => {
		if (!userId) return;

		const channel = supabase
			.channel(`notifications:${userId}`)
			.on(
				"postgres_changes",
				{
					event: "*",
					schema: "public",
					table: "notifications",
					filter: `user_id=eq.${userId}`,
				},
				() => {
					void queryClient.invalidateQueries({ queryKey: ["notifications"] });
					void queryClient.invalidateQueries({
						queryKey: ["notifications", "unread-count"],
					});
				},
			)
			.subscribe();

		return () => {
			void supabase.removeChannel(channel);
		};
	}, [queryClient, userId]);
}
