import { createFileRoute, redirect } from "@tanstack/react-router";
import { SignupForm } from "../../components/auth/signup/SignupForm";
import { SignupLayout } from "../../components/auth/signup/SignupLayout";
import { parseInviteEmailParam } from "../../lib/inviteEmailParam";
import { useAuthStore } from "../../stores/authStore";

export const Route = createFileRoute("/auth/signup")({
	// Old marketing links may still carry ?lane= / ?intent= — both are
	// silently dropped; signup is lane-free.
	validateSearch: (
		search: Record<string, unknown>,
	): {
		redirect?: string;
		email?: string;
	} => {
		return {
			redirect: (search.redirect as string) || undefined,
			// Validated, not cast — see parseInviteEmailParam.
			email: parseInviteEmailParam(search.email),
		};
	},
	beforeLoad: () => {
		const { isAuthenticated, isLoading } = useAuthStore.getState();
		const isInSignupFlow = sessionStorage.getItem("isInSignupFlow") === "true";
		if (!isLoading && isAuthenticated && !isInSignupFlow) {
			throw redirect({ to: "/dashboard" });
		}
	},
	component: RouteComponent,
});

function RouteComponent() {
	const search = Route.useSearch();

	if (search.redirect) {
		sessionStorage.setItem("signup_redirect", search.redirect);
	}

	return (
		<SignupLayout>
			<SignupForm />
		</SignupLayout>
	);
}
