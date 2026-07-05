/**
 * Auth Store - Zustand
 * Centralized authentication state management
 */

import { create } from "zustand";
import { supabase } from "../lib/supabase";
import type { Profile, Session, User } from "../types";

/**
 * Best-effort removal of this device's FCM token on logout, so a signed-out
 * device stops receiving pushes. Runs while the user is still authenticated (the
 * DELETE needs the JWT). Dynamic-imported + native-gated so the web bundle and
 * web logout flow are unaffected. All errors are swallowed to keep logout
 * idempotent.
 */
async function unregisterCurrentDeviceToken(): Promise<void> {
  try {
    const { isNativePlatform, getToken } = await import(
      "../services/pushNotifications"
    );
    if (!isNativePlatform()) return;
    const token = await getToken();
    if (!token) return;
    const { deviceTokensService } = await import(
      "../services/deviceTokens.service"
    );
    await deviceTokensService.unregister(token);
  } catch {
    // ignore — logout must stay idempotent
  }
}

interface AuthState {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  isLoading: boolean;
  isAuthenticated: boolean;
}

interface AuthActions {
  initialize: () => Promise<void>;
  setProfile: (profile: Profile | null) => void;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

type AuthStore = AuthState & AuthActions;

export const useAuthStore = create<AuthStore>((set) => ({
  // Initial state
  user: null,
  session: null,
  profile: null,
  isLoading: true,
  isAuthenticated: false,

  // Initialize auth - call this once when app starts
  initialize: async () => {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      set({
        session,
        user: session?.user ?? null,
        isAuthenticated: !!session?.user,
        isLoading: false,
      });

      // Listen for auth changes
      supabase.auth.onAuthStateChange(async (_event, session) => {
        set({
          session,
          user: session?.user ?? null,
          isAuthenticated: !!session?.user,
          isLoading: false,
        });

        if (!session?.user) {
          set({
            profile: null,
            isLoading: false,
          });
        }
      });
    } catch (error) {
      console.error("Auth initialization error:", error);
      set({ isLoading: false });
    }
  },

  // Set profile (called by useProfileQuery)
  setProfile: (profile) => {
    set({ profile });
  },

  // Sign in with email and password
  signIn: async (email: string, password: string) => {
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) throw error;

      // Auth state will be updated by onAuthStateChange listener
      // Migration will be handled by MigrationHandler component
    } catch (error) {
      throw error;
    }
  },

  // Sign up with email and password
  signUp: async (email: string, password: string) => {
    try {
      const result = await supabase.auth.signUp({
        email,
        password,
      });
      if (result.error) throw result.error;

      // Auth state will be updated by onAuthStateChange listener
      // Migration will be handled by MigrationHandler component
    } catch (error) {
      throw error;
    }
  },

  // Sign out
  signOut: async () => {
    const clearAuthState = () => {
      set({
        session: null,
        user: null,
        profile: null,
        isAuthenticated: false,
        isLoading: false,
      });
    };

    const isSessionMissingError = (error: unknown) => {
      if (!(error instanceof Error)) return false;
      return (
        error.name === "AuthSessionMissingError" ||
        /auth session missing/i.test(error.message)
      );
    };

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        clearAuthState();
        return;
      }

      // Drop this device's push token before the JWT is cleared (native only).
      await unregisterCurrentDeviceToken();

      const { error } = await supabase.auth.signOut({ scope: "local" });
      if (error && !isSessionMissingError(error)) throw error;

      // Keep logout UX idempotent even if auth listener is delayed.
      clearAuthState();
    } catch (error) {
      if (isSessionMissingError(error)) {
        clearAuthState();
        return;
      }
      throw error;
    }
  },
}));

// Selectors for common use cases
export const useUser = () => useAuthStore((state) => state.user);
export const useProfile = () => useAuthStore((state) => state.profile);
export const useSession = () => useAuthStore((state) => state.session);
export const useIsAuthenticated = () =>
  useAuthStore((state) => state.isAuthenticated);
export const useIsLoading = () => useAuthStore((state) => state.isLoading);
