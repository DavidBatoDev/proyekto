import { useQuery } from "@tanstack/react-query";
import {
	type ConsultantDirectoryParams,
	consultantKeys,
	fetchConsultantDirectory,
	fetchConsultantDirectoryFacets,
	fetchConsultantProfile,
	fetchConsultants,
} from "../queries/consultants";

/**
 * `enabled` exists so a caller that only needs this list as a FALLBACK can hold
 * the request until it knows the primary source came back empty, rather than
 * firing both on every page load. Defaults to true, so existing call sites are
 * unchanged.
 */
export function useConsultantsQuery(options: { enabled?: boolean } = {}) {
	return useQuery({
		queryKey: consultantKeys.list(),
		queryFn: fetchConsultants,
		enabled: options.enabled !== false,
		staleTime: 1000 * 60 * 5, // 5 minutes
	});
}

export function useConsultantProfileQuery(userId: string) {
	return useQuery({
		queryKey: consultantKeys.detail(userId),
		queryFn: () => fetchConsultantProfile(userId),
		enabled: !!userId,
		staleTime: 1000 * 60 * 5, // 5 minutes
		retry: 1,
	});
}

export function useConsultantDirectoryQuery(
	params: ConsultantDirectoryParams,
	options: { enabled?: boolean } = {},
) {
	return useQuery({
		queryKey: consultantKeys.directory(params),
		queryFn: () => fetchConsultantDirectory(params),
		enabled: options.enabled !== false,
		staleTime: 1000 * 60 * 5, // 5 minutes
	});
}

/**
 * The browse rail's options. Held long: the facet set only moves when a
 * consultant is verified or edits their profile, and the rail must render
 * with the first paint rather than after a round trip.
 */
export function useConsultantDirectoryFacetsQuery() {
	return useQuery({
		queryKey: consultantKeys.facets(),
		queryFn: fetchConsultantDirectoryFacets,
		staleTime: 1000 * 60 * 30,
	});
}
