import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	fetchMyMarketplaceSurvey,
	type MarketplaceSurvey,
	marketplaceSurveyKeys,
	type SaveMarketplaceSurveyInput,
	saveMarketplaceSurvey,
	skipMarketplaceSurvey,
} from "@/queries/marketplaceSurvey";
import { useIsAuthenticated } from "@/stores/authStore";

/**
 * The caller's own intake survey.
 *
 * `enabled` on authentication rather than on a user id: the storefront is a
 * public route, and firing this for an anonymous visitor would be a guaranteed
 * 401 on the front door. `undefined` data therefore means "not loaded or not
 * applicable", and `null` means "loaded, never answered" — a distinction
 * `surveyIsOutstanding` in `@/lib/marketplaceSurvey` depends on.
 */
export function useMarketplaceSurveyQuery(options: { enabled?: boolean } = {}) {
	const isAuthenticated = useIsAuthenticated();
	return useQuery<MarketplaceSurvey | null>({
		queryKey: marketplaceSurveyKeys.mine(),
		queryFn: fetchMyMarketplaceSurvey,
		enabled: isAuthenticated && options.enabled !== false,
		// Answers change once, by hand, in a modal this same client owns. There is
		// no other writer to race, so refetching on focus would be pure noise.
		staleTime: 1000 * 60 * 30,
		refetchOnWindowFocus: false,
		retry: 1,
	});
}

export function useSaveMarketplaceSurvey() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (input: SaveMarketplaceSurveyInput) =>
			saveMarketplaceSurvey(input),
		onSuccess: (survey) => {
			// Seeded rather than invalidated: the response is the whole row, and the
			// storefront re-renders off this cache the moment the modal closes.
			queryClient.setQueryData(marketplaceSurveyKeys.mine(), survey);
		},
	});
}

export function useSkipMarketplaceSurvey() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: skipMarketplaceSurvey,
		onSuccess: (survey) => {
			queryClient.setQueryData(marketplaceSurveyKeys.mine(), survey);
		},
	});
}
