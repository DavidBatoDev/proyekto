/**
 * Auth initialization component
 * Call this in your root layout or App.tsx
 */

import { useEffect } from "react";
import { useAuthStore } from "../../stores/authStore";
import { LoadingScreen } from "../layout/LoadingScreen";

interface AuthInitializerProps {
	children: React.ReactNode;
}

export function AuthInitializer({ children }: AuthInitializerProps) {
	const initialize = useAuthStore((state) => state.initialize);
	const isLoading = useAuthStore((state) => state.isLoading);

	useEffect(() => {
		initialize();
	}, [initialize]);

	// Show loading screen while auth is initializing
	if (isLoading) {
		return <LoadingScreen />;
	}

	return <>{children}</>;
}
