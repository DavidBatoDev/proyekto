import { useQuery } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { useAuthStore } from "../stores/authStore";

export type FreelancerRequirement =
  | "identity"
  | "rate_settings"
  | "portfolio"
  | "profile_basics";

export interface FreelancerEligibility {
  eligible: boolean;
  missing: FreelancerRequirement[];
}

/**
 * Mirrors `backend/src/modules/profile/freelancer-eligibility.service.ts`.
 * The backend remains the source of truth for the `switchPersona('freelancer')`
 * enforcement gate; this hook drives the dashboard checklist UI so users can
 * see what's left without waiting for a backend roundtrip.
 *
 * If the two ever diverge, the backend wins — the user just sees a slightly
 * stale checklist for one render cycle.
 */
export function useFreelancerEligibility(): {
  data: FreelancerEligibility | undefined;
  isLoading: boolean;
  isError: boolean;
} {
  const user = useAuthStore((state) => state.user);
  const userId = user?.id;

  const query = useQuery({
    queryKey: ["freelancer-eligibility", userId ?? ""],
    enabled: !!userId,
    staleTime: 30 * 1000,
    queryFn: async (): Promise<FreelancerEligibility> => {
      if (!userId) return { eligible: false, missing: [] };

      const [identity, rate, portfolio, basics] = await Promise.all([
        hasVerifiedIdentity(userId),
        hasRateSettings(userId),
        hasPortfolioItem(userId),
        hasProfileBasics(userId),
      ]);

      const missing: FreelancerRequirement[] = [];
      if (!identity) missing.push("identity");
      if (!rate) missing.push("rate_settings");
      if (!portfolio) missing.push("portfolio");
      if (!basics) missing.push("profile_basics");

      return { eligible: missing.length === 0, missing };
    },
  });

  return {
    data: query.data,
    isLoading: query.isPending,
    isError: query.isError,
  };
}

async function hasVerifiedIdentity(userId: string): Promise<boolean> {
  const { count: docCount } = await supabase
    .from("user_identity_documents")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("is_verified", true);
  if ((docCount ?? 0) > 0) return true;

  const { count: verCount } = await supabase
    .from("user_verifications")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("type", "identity")
    .eq("status", "verified");
  return (verCount ?? 0) > 0;
}

async function hasRateSettings(userId: string): Promise<boolean> {
  const { data } = await supabase
    .from("user_rate_settings")
    .select("hourly_rate, currency, availability")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) return false;
  return (
    data.hourly_rate !== null &&
    data.hourly_rate !== undefined &&
    typeof data.currency === "string" &&
    data.currency.trim().length > 0 &&
    typeof data.availability === "string" &&
    data.availability.trim().length > 0
  );
}

async function hasPortfolioItem(userId: string): Promise<boolean> {
  const { count } = await supabase
    .from("user_portfolios")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId);
  return (count ?? 0) >= 1;
}

async function hasProfileBasics(userId: string): Promise<boolean> {
  const { data } = await supabase
    .from("profiles")
    .select("headline, bio, country")
    .eq("id", userId)
    .maybeSingle();
  if (!data) return false;
  return (
    typeof data.headline === "string" &&
    data.headline.trim().length > 0 &&
    typeof data.bio === "string" &&
    data.bio.trim().length > 0 &&
    typeof data.country === "string" &&
    data.country.trim().length > 0
  );
}
