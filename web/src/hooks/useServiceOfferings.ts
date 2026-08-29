import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	type CreateServiceOfferingPayload,
	createServiceOffering,
	deleteServiceOffering,
	fetchMyServiceOfferings,
	fetchPublicServiceOffering,
	fetchPublicServiceOfferingsByUser,
	fetchServiceLikeState,
	type OfferingPackagePayload,
	replaceServiceOfferingPackages,
	serviceOfferingKeys,
	setServiceLiked,
	type UpdateServiceOfferingPayload,
	updateServiceOffering,
} from "@/queries/serviceOfferings";

export function useMyServiceOfferingsQuery(enabled = true) {
	return useQuery({
		queryKey: serviceOfferingKeys.mine(),
		queryFn: fetchMyServiceOfferings,
		enabled,
	});
}

export function usePublicServiceOfferingQuery(id: string) {
	return useQuery({
		queryKey: serviceOfferingKeys.publicDetail(id),
		queryFn: () => fetchPublicServiceOffering(id),
		enabled: !!id,
		staleTime: 60 * 1000,
	});
}

export function usePublicServiceOfferingsByUserQuery(
	userId: string | undefined,
) {
	return useQuery({
		queryKey: serviceOfferingKeys.publicByUser(userId ?? ""),
		queryFn: () => fetchPublicServiceOfferingsByUser(userId ?? ""),
		enabled: !!userId,
		staleTime: 60 * 1000,
	});
}

/** One invalidation for every owner write: the catalog + any public copies. */
function useInvalidateOfferings() {
	const queryClient = useQueryClient();
	return () =>
		queryClient.invalidateQueries({ queryKey: ["service-offerings"] });
}

export function useCreateServiceOfferingMutation() {
	const invalidate = useInvalidateOfferings();
	return useMutation({
		mutationFn: (payload: CreateServiceOfferingPayload) =>
			createServiceOffering(payload),
		onSuccess: () => void invalidate(),
	});
}

export function useUpdateServiceOfferingMutation() {
	const invalidate = useInvalidateOfferings();
	return useMutation({
		mutationFn: ({
			id,
			payload,
		}: {
			id: string;
			payload: UpdateServiceOfferingPayload;
		}) => updateServiceOffering(id, payload),
		onSuccess: () => void invalidate(),
	});
}

export function useReplaceOfferingPackagesMutation() {
	const invalidate = useInvalidateOfferings();
	return useMutation({
		mutationFn: ({
			id,
			packages,
		}: {
			id: string;
			packages: OfferingPackagePayload[];
		}) => replaceServiceOfferingPackages(id, packages),
		onSuccess: () => void invalidate(),
	});
}

export function useDeleteServiceOfferingMutation() {
	const invalidate = useInvalidateOfferings();
	return useMutation({
		mutationFn: (id: string) => deleteServiceOffering(id),
		onSuccess: () => void invalidate(),
	});
}

/**
 * The viewer's own like state. Signed-out visitors never fetch it — the
 * count they see comes from the public detail payload, and the button sends
 * them to sign-up instead of calling an authed route.
 */
export function useServiceLikeQuery(id: string, enabled: boolean) {
	return useQuery({
		queryKey: serviceOfferingKeys.like(id),
		queryFn: () => fetchServiceLikeState(id),
		enabled: enabled && !!id,
		staleTime: 60 * 1000,
	});
}

export function useSetServiceLikedMutation(id: string) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (liked: boolean) => setServiceLiked(id, liked),
		onSuccess: (state) => {
			// The server's count is authoritative — other people are liking too.
			queryClient.setQueryData(serviceOfferingKeys.like(id), state);
		},
	});
}
