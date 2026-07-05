/**
 * Protected Route Component
 * Use this to protect routes that require authentication
 */

import { useAuthStore } from "../../stores/authStore";
import type { PersonaType } from "../../types";
import { useEffect, useRef } from "react";
import { useNavigate } from "@tanstack/react-router";

interface ProtectedRouteProps {
	children: React.ReactNode;
	requiredPersona?: PersonaType[];
	fallback?: React.ReactNode;
	loadingFallback?: React.ReactNode;
	redirectUnauthenticated?: boolean;
}

export function ProtectedRoute({
	children,
	requiredPersona,
	fallback = <div>Please log in to access this page</div>,
	loadingFallback = <div>Loading...</div>,
	redirectUnauthenticated = true,
}: ProtectedRouteProps) {
	const navigate = useNavigate();
	const navigateRef = useRef(navigate);
	const redirectedRef = useRef(false);
	const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
	const isLoading = useAuthStore((state) => state.isLoading);
	const profile = useAuthStore((state) => state.profile);

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

	// Check persona requirements
	if (requiredPersona && profile) {
		if (!requiredPersona.includes(profile.active_persona)) {
			return (
				<div>
					Access denied. Required persona: {requiredPersona.join(" or ")}
				</div>
			);
		}
	}

	return <>{children}</>;
}
