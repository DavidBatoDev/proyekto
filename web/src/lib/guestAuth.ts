// Guest User Authentication Utility
// Handles guest user creation and session management for anonymous roadmap creation

import { supabase } from "./supabase";
import { apiClient } from "@/api";

const GUEST_SESSION_KEY = "proyekto_guest_session_id";
const LEGACY_GUEST_SESSION_KEY = "prdigy_guest_session_id";
const GUEST_USER_ID_KEY = "proyekto_guest_user_id";
const LEGACY_GUEST_USER_ID_KEY = "prdigy_guest_user_id";

function getStorageItemWithLegacyFallback(
  primaryKey: string,
  legacyKey: string,
): string | null {
  if (typeof window === "undefined") return null;

  const primaryValue = localStorage.getItem(primaryKey);
  if (primaryValue !== null) {
    return primaryValue;
  }

  const legacyValue = localStorage.getItem(legacyKey);
  if (legacyValue !== null) {
    localStorage.setItem(primaryKey, legacyValue);
    localStorage.removeItem(legacyKey);
  }

  return legacyValue;
}

// Cache for in-flight guest user creation promise to prevent concurrent duplicates
let guestUserCreationPromise: Promise<string | null> | null = null;

/**
 * Generates a unique guest session ID
 */
export function generateGuestSessionId(): string {
  return `guest_${crypto.randomUUID()}`;
}

/**
 * Gets the current guest session ID from localStorage
 */
export function getGuestSessionId(): string | null {
  return getStorageItemWithLegacyFallback(
    GUEST_SESSION_KEY,
    LEGACY_GUEST_SESSION_KEY,
  );
}

/**
 * Sets the guest session ID in localStorage
 */
export function setGuestSessionId(sessionId: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(GUEST_SESSION_KEY, sessionId);
}

/**
 * Gets the cached guest user ID from localStorage
 */
export function getCachedGuestUserId(): string | null {
  return getStorageItemWithLegacyFallback(
    GUEST_USER_ID_KEY,
    LEGACY_GUEST_USER_ID_KEY,
  );
}

/**
 * Sets the guest user ID in localStorage
 */
export function setCachedGuestUserId(userId: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(GUEST_USER_ID_KEY, userId);
}

/**
 * Clears guest session data from localStorage
 */
export function clearGuestSession(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(GUEST_SESSION_KEY);
  localStorage.removeItem(GUEST_USER_ID_KEY);
  localStorage.removeItem(LEGACY_GUEST_SESSION_KEY);
  localStorage.removeItem(LEGACY_GUEST_USER_ID_KEY);
}

/**
 * Checks if the current session is a guest session
 */
export function isGuestSession(): boolean {
  return getGuestSessionId() !== null;
}

/**
 * Creates a new guest user profile in the database
 */
export async function createGuestProfile(
  sessionId: string,
): Promise<string | null> {
  try {
    const response = await apiClient.post("/api/guests/create", {
      session_id: sessionId,
    });

    return response.data.data.user_id;
  } catch (error) {
    console.error("Exception creating guest profile:", error);
    return null;
  }
}

/**
 * Gets the guest user ID from the database by session ID
 */
export async function getGuestUserId(
  sessionId: string,
): Promise<string | null> {
  try {
    const response = await apiClient.get(
      `/api/guests/by-session/${encodeURIComponent(sessionId)}`,
    );

    return response.data.data.user_id;
  } catch (error: any) {
    if (error.response?.status === 404) {
      return null;
    }
    console.error("Exception getting guest user ID:", error);
    return null;
  }
}

/**
 * Gets or creates a guest user for the current session
 * Returns the guest user ID
 *
 * Uses promise caching to prevent concurrent calls from creating duplicate guest users
 */
export async function getOrCreateGuestUser(): Promise<string | null> {
  // If there's already a creation in progress, wait for it
  if (guestUserCreationPromise) {
    return guestUserCreationPromise;
  }

  // Validate any cached guest session/user before trusting localStorage
  const cachedSessionId = getGuestSessionId();
  const cachedUserId = getCachedGuestUserId();

  if (cachedSessionId) {
    const userIdFromSession = await getGuestUserId(cachedSessionId);
    if (!userIdFromSession) {
      // Session is stale, reset localStorage so we can create a fresh guest user
      clearGuestSession();
    } else {
      if (cachedUserId !== userIdFromSession) {
        setCachedGuestUserId(userIdFromSession);
      }
      return userIdFromSession;
    }
  } else if (cachedUserId) {
    const isValidGuest = await isGuestUser(cachedUserId);
    if (isValidGuest) {
      return cachedUserId;
    }
    clearGuestSession();
  }

  // Create the promise and cache it
  guestUserCreationPromise = (async () => {
    try {
      // Check if we have a guest session ID
      let sessionId = getGuestSessionId();

      if (sessionId) {
        // Try to get existing guest user
        const userId = await getGuestUserId(sessionId);
        if (userId) {
          setCachedGuestUserId(userId);
          return userId;
        }
      }

      // Create new guest session and user
      sessionId = generateGuestSessionId();
      setGuestSessionId(sessionId);

      const userId = await createGuestProfile(sessionId);
      if (userId) {
        setCachedGuestUserId(userId);
        return userId;
      }

      return null;
    } finally {
      // Clear the promise cache after completion
      guestUserCreationPromise = null;
    }
  })();

  return guestUserCreationPromise;
}

/**
 * Checks if a user ID belongs to a guest user
 */
export async function isGuestUser(userId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("is_guest")
      .eq("id", userId)
      .single();

    if (error) {
      console.error("Error checking if user is guest:", error);
      return false;
    }

    return data?.is_guest === true;
  } catch (error) {
    console.error("Exception checking if user is guest:", error);
    return false;
  }
}

/**
 * Gets guest user info including session ID
 */
export async function getGuestUserInfo(userId: string): Promise<{
  isGuest: boolean;
  sessionId: string | null;
} | null> {
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("is_guest, guest_session_id")
      .eq("id", userId)
      .single();

    if (error) {
      console.error("Error getting guest user info:", error);
      return null;
    }

    return {
      isGuest: data?.is_guest === true,
      sessionId: data?.guest_session_id || null,
    };
  } catch (error) {
    console.error("Exception getting guest user info:", error);
    return null;
  }
}
