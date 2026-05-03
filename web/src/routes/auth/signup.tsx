import { createFileRoute, redirect } from "@tanstack/react-router";
import { useAuthStore } from "../../stores/authStore";
import { SignupLayout } from "../../components/auth/signup/SignupLayout";
import { SignupForm } from "../../components/auth/signup/SignupForm";

export const Route = createFileRoute("/auth/signup")({
  validateSearch: (
    search: Record<string, unknown>,
  ): {
    redirect?: string;
    intent?: "client" | "freelancer";
    lane?: "client_freelancer" | "consultant";
  } => {
    const rawIntent = search.intent as string | undefined;
    const intent =
      rawIntent === "client" || rawIntent === "freelancer"
        ? rawIntent
        : undefined;
    const rawLane = search.lane as string | undefined;
    const lane =
      rawLane === "client_freelancer" || rawLane === "consultant"
        ? rawLane
        : undefined;
    return {
      redirect: (search.redirect as string) || undefined,
      intent,
      lane,
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
