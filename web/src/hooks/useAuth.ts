import { useEffect, useState } from "react";
import { getCachedGuestUserId, getOrCreateGuestUser } from "@/lib/guestAuth";
import { getAccessToken } from "@/lib/supabase";
import { useAuthStore, useUser } from "@/stores/authStore";

export interface UseAuthReturn {
	user: any;
	guestUserId: string | null;
	token: string | null;
	isAuthenticated: boolean;
	isLoading: boolean;
}

/**
 * Hook to get current user authentication state
 * Returns both authenticated user and guest user info along with token
 */
export function useAuth(): UseAuthReturn {
	const authenticatedUser = useUser();
	const { isLoading: authLoading } = useAuthStore();
	const [guestUserId, setGuestUserId] = useState<string | null>(null);
	const [token, setToken] = useState<string | null>(null);
	const [isLoading, setIsLoading] = useState(true);

	useEffect(() => {
		const initializeAuth = async () => {
			try {
				// Check for authenticated user token
				if (authenticatedUser) {
					const accessToken = await getAccessToken();
					setToken(accessToken || null);
				} else {
					// Get or create guest user
					const cachedGuestId = getCachedGuestUserId();
					if (cachedGuestId) {
						setGuestUserId(cachedGuestId);
					} else {
						const newGuestId = await getOrCreateGuestUser();
						setGuestUserId(newGuestId);
					}
					setToken(null);
				}
			} catch (error) {
				console.error("Error initializing auth:", error);
			} finally {
				setIsLoading(false);
			}
		};

		initializeAuth();
	}, [authenticatedUser]);

	return {
		user: authenticatedUser,
		guestUserId,
		token,
		isAuthenticated: !!authenticatedUser,
		isLoading: authLoading || isLoading,
	};
}
