import { useQuery } from "@tanstack/react-query";
import {
	consultantKeys,
	fetchConsultantProfile,
	fetchConsultants,
} from "../queries/consultants";

export function useConsultantsQuery() {
	return useQuery({
		queryKey: consultantKeys.list(),
		queryFn: fetchConsultants,
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
