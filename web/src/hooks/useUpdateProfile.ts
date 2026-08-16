/**
 * Profile Update Mutation Hook
 * TanStack Query mutation for updating profile with optimistic updates
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { profileKeys, updateProfileData } from "../queries/profile";
import { useAuthStore } from "../stores/authStore";
import type { Profile } from "../types";
import { useToast } from "./useToast";

export function useUpdateProfile() {
	const queryClient = useQueryClient();
	const user = useAuthStore((state) => state.user);
	const toast = useToast();

	return useMutation({
		mutationFn: (updates: Partial<Profile>) => {
			if (!user) throw new Error("User not authenticated");
			return updateProfileData(user.id, updates);
		},
		onMutate: async (updates) => {
			// Cancel outgoing queries
			await queryClient.cancelQueries({
				queryKey: profileKeys.byUser(user?.id ?? ""),
			});

			// Snapshot previous value
			const previousProfile = queryClient.getQueryData<Profile | null>(
				profileKeys.byUser(user?.id ?? ""),
			);

			// Optimistically update to the new value
			if (previousProfile) {
				queryClient.setQueryData<Profile | null>(
					profileKeys.byUser(user?.id ?? ""),
					{ ...previousProfile, ...updates },
				);
			}

			// Return context with previous value
			return { previousProfile };
		},
		onError: (error, _updates, context) => {
			// Rollback to previous value on error
			if (context?.previousProfile) {
				queryClient.setQueryData(
					profileKeys.byUser(user?.id ?? ""),
					context.previousProfile,
				);
			}
			toast.error(
				error instanceof Error ? error.message : "Failed to update profile",
			);
		},
		onSuccess: (data) => {
			// Update cache with server data
			queryClient.setQueryData(profileKeys.byUser(user?.id ?? ""), data);
			toast.success("Profile updated successfully");
		},
	});
}
