import { useQuery } from "@tanstack/react-query";
import { fetchTalentProfile, talentKeys } from "@/queries/talent";

export function useTalentProfileQuery(
	userId: string,
	options?: { noStore?: boolean },
) {
	return useQuery({
		queryKey: talentKeys.detail(userId),
		queryFn: () => fetchTalentProfile(userId, options),
		enabled: !!userId,
		staleTime: 1000 * 60 * 5, // 5 minutes
		retry: 1,
	});
}
