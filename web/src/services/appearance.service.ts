import apiClient from "@/api/axios";
import type { AppearancePreferencesV1 } from "@/theme/types";

export async function saveAppearancePreferences(
	preferences: AppearancePreferencesV1,
): Promise<AppearancePreferencesV1> {
	const response = await apiClient.put(
		"/api/users/me/preferences/appearance",
		preferences,
	);
	return response.data.data as AppearancePreferencesV1;
}
