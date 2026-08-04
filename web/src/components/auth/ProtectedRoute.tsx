/**
 * Protected Route Component
 * Use this to protect routes that require authentication
 */

import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { useAuthStore } from "../../stores/authStore";

interface ProtectedRouteProps {
	children: React.ReactNode;
	fallback?: React.ReactNode;
	loadingFallback?: React.ReactNode;
	redirectUnauthenticated?: boolean;
}

export function ProtectedRoute({
	children,
	fallback = <div>Please log in to access this page</div>,
	loadingFallback = <div>Loading...</div>,
	redirectUnauthenticated = true,
}: ProtectedRouteProps) {
	const navigate = useNavigate();
	const navigateRef = useRef(navigate);
	const redirectedRef = useRef(false);
	const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
	const isLoading = useAuthStore((state) => state.isLoading);

	useEffect(() => {
		navigateRef.current = navigate;
	}, [navigate]);

	useEffect(() => {
		if (isAuthenticated) {
			redirectedRef.current = false;
			return;
		}

		if (isLoading || !redirectUnauthenticated || redirectedRef.current) {
			return;
		}

		redirectedRef.current = true;

		const redirect =
			typeof window === "undefined"
				? "/dashboard"
				: `${window.location.pathname}${window.location.search}${window.location.hash}`;

		void navigateRef.current({
			to: "/auth/login",
			search: { redirect },
			replace: true,
		});
	}, [isAuthenticated, isLoading, redirectUnauthenticated]);

	if (isLoading) {
		return <>{loadingFallback}</>;
	}

	if (!isAuthenticated) {
		if (redirectUnauthenticated) {
			return <>{loadingFallback}</>;
		}

		return <>{fallback}</>;
	}

	return <>{children}</>;
}
