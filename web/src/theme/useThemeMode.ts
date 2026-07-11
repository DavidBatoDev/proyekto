import { useMemo } from "react";
import { useAppearanceStore } from "@/stores/appearanceStore";
import { resolveTheme } from "./theme";

export function useThemeMode() {
	const preferences = useAppearanceStore((state) => state.preferences);
	return useMemo(() => resolveTheme(preferences).mode, [preferences]);
}
