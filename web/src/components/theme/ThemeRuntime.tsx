import { createTheme, ThemeProvider } from "@mui/material/styles";
import { useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useEffect, useMemo, useRef } from "react";
import { featureFlags } from "@/config/featureFlags";
import { useProfileQuery } from "@/hooks/useProfileQuery";
import { profileKeys } from "@/queries/profile";
import { saveAppearancePreferences } from "@/services/appearance.service";
import { useAppearanceStore } from "@/stores/appearanceStore";
import { useAuthStore } from "@/stores/authStore";
import { DEFAULT_APPEARANCE, PRESET_THEMES } from "@/theme/presets";
import {
	APPEARANCE_STORAGE_KEY,
	applyAppearanceToDocument,
	normalizeAppearance,
	resolveTheme,
} from "@/theme/theme";
import { THEME_IDS, type ThemeId } from "@/theme/types";
import type { Profile } from "@/types";

export function ThemeRuntime({ children }: { children: ReactNode }) {
	const preferences = useAppearanceStore((state) => state.preferences);
	const dirty = useAppearanceStore((state) => state.dirty);
	const ownerUserId = useAppearanceStore((state) => state.ownerUserId);
	const replacePreferences = useAppearanceStore(
		(state) => state.replacePreferences,
	);
	const hydrateFromCache = useAppearanceStore(
		(state) => state.hydrateFromCache,
	);
	const markSaving = useAppearanceStore((state) => state.markSaving);
	const markSaved = useAppearanceStore((state) => state.markSaved);
	const markSaveError = useAppearanceStore((state) => state.markSaveError);
	const user = useAuthStore((state) => state.user);
	const profileQuery = useProfileQuery();
	const queryClient = useQueryClient();
	const reconciledUserRef = useRef<string | null>(null);
	const auditThemeValue =
		typeof window === "undefined"
			? null
			: window.sessionStorage.getItem("proyekto.theme-audit");
	const auditTheme: ThemeId | null = THEME_IDS.includes(
		auditThemeValue as ThemeId,
	)
		? (auditThemeValue as ThemeId)
		: null;

	const activePreferences = featureFlags.themeSystem
		? auditTheme
			? { ...preferences, theme: auditTheme }
			: preferences
		: DEFAULT_APPEARANCE;
	const resolved = useMemo(
		() => resolveTheme(activePreferences),
		[activePreferences],
	);
	const muiTheme = useMemo(() => {
		const fallback =
			activePreferences.theme === "custom"
				? resolved.tokens
				: PRESET_THEMES[activePreferences.theme].tokens;
		return createTheme({
			palette: {
				mode: resolved.mode,
				primary: {
					main: fallback.primary,
					contrastText: fallback.primaryForeground,
				},
				background: { default: fallback.background, paper: fallback.card },
				text: {
					primary: fallback.foreground,
					secondary: fallback.mutedForeground,
				},
				divider: fallback.border,
				error: { main: fallback.destructive },
			},
			shape: { borderRadius: 10 },
		});
	}, [activePreferences.theme, resolved]);

	useEffect(() => {
		applyAppearanceToDocument(activePreferences);
	}, [activePreferences]);

	useEffect(() => {
		const onStorage = (event: StorageEvent) => {
			if (event.key === APPEARANCE_STORAGE_KEY) hydrateFromCache();
		};
		window.addEventListener("storage", onStorage);
		return () => window.removeEventListener("storage", onStorage);
	}, [hydrateFromCache]);

	useEffect(() => {
		if (!user) {
			reconciledUserRef.current = null;
			return;
		}
		if (!profileQuery.data || reconciledUserRef.current === user.id) return;
		const serverAppearance = normalizeAppearance(
			profileQuery.data.settings?.appearance,
		);
		if (!(dirty && ownerUserId === user.id)) {
			replacePreferences(
				serverAppearance ?? structuredClone(DEFAULT_APPEARANCE),
				{
					dirty: false,
					ownerUserId: user.id,
				},
			);
		}
		reconciledUserRef.current = user.id;
	}, [dirty, ownerUserId, profileQuery.data, replacePreferences, user]);

	useEffect(() => {
		if (
			!featureFlags.themeSystem ||
			!user ||
			!dirty ||
			reconciledUserRef.current !== user.id
		)
			return;
		const timeout = window.setTimeout(() => {
			markSaving();
			void saveAppearancePreferences(preferences)
				.then((saved) => {
					queryClient.setQueryData<Profile | null>(
						profileKeys.byUser(user.id),
						(current) =>
							current
								? {
										...current,
										settings: { ...current.settings, appearance: saved },
									}
								: current,
					);
					markSaved(user.id);
				})
				.catch((error: unknown) => {
					markSaveError(
						error instanceof Error
							? error.message
							: "Could not sync appearance settings.",
					);
				});
		}, 350);
		return () => window.clearTimeout(timeout);
	}, [
		dirty,
		markSaveError,
		markSaved,
		markSaving,
		preferences,
		queryClient,
		user,
	]);

	return <ThemeProvider theme={muiTheme}>{children}</ThemeProvider>;
}
