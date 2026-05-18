import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const PROJECT_SETTINGS_STORAGE_KEY = 'proyekto-project-settings-storage';
const LEGACY_PROJECT_SETTINGS_STORAGE_KEY = 'prdigy-project-settings-storage';

function migrateLegacyProjectSettingsStorage(): void {
  if (typeof window === 'undefined') return;

  const currentValue = localStorage.getItem(PROJECT_SETTINGS_STORAGE_KEY);
  if (currentValue !== null) {
    return;
  }

  const legacyValue = localStorage.getItem(LEGACY_PROJECT_SETTINGS_STORAGE_KEY);
  if (legacyValue !== null) {
    localStorage.setItem(PROJECT_SETTINGS_STORAGE_KEY, legacyValue);
    localStorage.removeItem(LEGACY_PROJECT_SETTINGS_STORAGE_KEY);
  }
}

migrateLegacyProjectSettingsStorage();

interface ProjectSettingsState {
  isSidebarExpanded: boolean;
  toggleSidebar: () => void;
  setSidebarExpanded: (expanded: boolean) => void;
}

export const useProjectSettingsStore = create<ProjectSettingsState>()(
  persist(
    (set) => ({
      isSidebarExpanded: true,
      toggleSidebar: () =>
        set((state) => ({ isSidebarExpanded: !state.isSidebarExpanded })),
      setSidebarExpanded: (expanded) => set({ isSidebarExpanded: expanded }),
    }),
    {
      name: PROJECT_SETTINGS_STORAGE_KEY,
    }
  )
);
