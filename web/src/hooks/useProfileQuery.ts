/**
 * Profile Query Hook
 * TanStack Query hook for fetching profile with Zustand sync
 */

import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { fetchProfile, profileKeys } from "../queries/profile";
import { useAuthStore } from "../stores/authStore";

export function useProfileQuery() {
	const user = useAuthStore((state) => state.user);
	const setProfile = useAuthStore((state) => state.setProfile);

	const query = useQuery({
		queryKey: profileKeys.byUser(user?.id ?? ""),
		queryFn: () => fetchProfile(user!.id),
		enabled: !!user,
		staleTime: 1000 * 60, // 1 minute
		refetchOnWindowFocus: true,
		retry: 2,
	});

	// Sync successful data to Zustand
	useEffect(() => {
		if (query.data !== undefined) {
			setProfile(query.data);
		}
	}, [query.data, setProfile]);

	return query;
}
