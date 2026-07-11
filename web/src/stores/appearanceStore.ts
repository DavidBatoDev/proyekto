import { create } from "zustand";
import {
	applyAppearanceToDocument,
	readAppearanceCache,
	writeAppearanceCache,
} from "@/theme/theme";
import type { AppearancePreferencesV1, ThemeId } from "@/theme/types";

interface AppearanceState {
	preferences: AppearancePreferencesV1;
	dirty: boolean;
	ownerUserId: string | null;
	saving: boolean;
	lastError: string | null;
	setTheme: (theme: ThemeId) => void;
	updateCustom: (patch: Partial<AppearancePreferencesV1["custom"]>) => void;
	updateSidebar: (
		patch: Partial<AppearancePreferencesV1["custom"]["sidebar"]>,
	) => void;
	replacePreferences: (
		preferences: AppearancePreferencesV1,
		options?: { dirty?: boolean; ownerUserId?: string | null },
	) => void;
	hydrateFromCache: () => void;
	setOwnerUserId: (ownerUserId: string | null) => void;
	markSaving: () => void;
	markSaved: (ownerUserId: string) => void;
	markSaveError: (message: string) => void;
}

const initial = readAppearanceCache();
applyAppearanceToDocument(initial.preferences);

function persist(
	preferences: AppearancePreferencesV1,
	dirty: boolean,
	ownerUserId: string | null,
): void {
	applyAppearanceToDocument(preferences);
	writeAppearanceCache({ version: 1, preferences, dirty, ownerUserId });
}

export const useAppearanceStore = create<AppearanceState>((set, get) => ({
	preferences: initial.preferences,
	dirty: initial.dirty,
	ownerUserId: initial.ownerUserId,
	saving: false,
	lastError: null,
	setTheme: (theme) => {
		const state = get();
		const preferences = { ...state.preferences, theme };
		persist(preferences, true, state.ownerUserId);
		set({ preferences, dirty: true, lastError: null });
	},
	updateCustom: (patch) => {
		const state = get();
		const preferences = {
			...state.preferences,
			custom: { ...state.preferences.custom, ...patch },
		};
		persist(preferences, true, state.ownerUserId);
		set({ preferences, dirty: true, lastError: null });
	},
	updateSidebar: (patch) => {
		const state = get();
		const preferences = {
			...state.preferences,
			custom: {
				...state.preferences.custom,
				sidebar: { ...state.preferences.custom.sidebar, ...patch },
			},
		};
		persist(preferences, true, state.ownerUserId);
		set({ preferences, dirty: true, lastError: null });
	},
	replacePreferences: (preferences, options) => {
		const state = get();
		const dirty = options?.dirty ?? false;
		const ownerUserId =
			options?.ownerUserId === undefined
				? state.ownerUserId
				: options.ownerUserId;
		persist(preferences, dirty, ownerUserId);
		set({ preferences, dirty, ownerUserId, saving: false, lastError: null });
	},
	hydrateFromCache: () => {
		const cache = readAppearanceCache();
		applyAppearanceToDocument(cache.preferences);
		set({
			preferences: cache.preferences,
			dirty: cache.dirty,
			ownerUserId: cache.ownerUserId,
			saving: false,
			lastError: null,
		});
	},
	setOwnerUserId: (ownerUserId) => {
		const state = get();
		persist(state.preferences, state.dirty, ownerUserId);
		set({ ownerUserId });
	},
	markSaving: () => set({ saving: true, lastError: null }),
	markSaved: (ownerUserId) => {
		const state = get();
		persist(state.preferences, false, ownerUserId);
		set({ dirty: false, saving: false, lastError: null, ownerUserId });
	},
	markSaveError: (message) =>
		set({ saving: false, lastError: message, dirty: true }),
}));
