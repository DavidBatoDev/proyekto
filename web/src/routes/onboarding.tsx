import { createFileRoute, redirect } from "@tanstack/react-router";
import { useAuthStore } from "@/stores/authStore";
import { fetchProfile } from "@/queries/profile";

/**
 * Legacy /onboarding route.
 *
 * Replaced by /welcome (the 4-slide activation deck) and the consultant lane's
 * /consultant/apply form. Kept alive only as a redirect handler so in-flight
 * email links, bookmarks, and old tab references continue to resolve.
 *
 * Routing rules:
 *   - unauthenticated → /auth/login
 *   - authenticated, lane="consultant" → /consultant/apply
 *   - authenticated, anything else → /welcome
 */
export const Route = createFileRoute("/onboarding")({
  beforeLoad: () => {
    const { isAuthenticated, isLoading } = useAuthStore.getState();
    if (!isLoading && !isAuthenticated) {
      throw redirect({ to: "/auth/login" });
    }
  },
  loader: async () => {
    const { user, setProfile } = useAuthStore.getState();
    if (!user) {
      throw redirect({ to: "/auth/login" });
    }

    const profile = await fetchProfile(user.id);
    setProfile(profile);

    const lane = (
      profile?.settings as { onboarding?: { lane?: string } } | null | undefined
    )?.onboarding?.lane;

    if (lane === "consultant") {
      throw redirect({ to: "/consultant/apply" });
    }
    throw redirect({ to: "/welcome" });
  },
  component: () => null,
});
