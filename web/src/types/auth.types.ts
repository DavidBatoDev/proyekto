/**
 * Auth-related types
 */

import type { Session, User } from "@supabase/supabase-js";
import type { Profile } from "./profile.types";

// Re-export Supabase types
export type { Session, User };

// Auth response
export interface AuthResponse {
	user: User | null;
	session: Session | null;
}

// Auth error
export interface AuthError {
	message: string;
	status?: number;
}

// Auth state
export interface AuthState {
	user: User | null;
	profile: Profile | null;
	session: Session | null;
	isLoading: boolean;
	isAuthenticated: boolean;
}

// Login credentials
export interface LoginCredentials {
	email: string;
	password: string;
}

// Signup credentials
export interface SignupCredentials {
	email: string;
	password: string;
	display_name?: string;
}

// Profile update data
export interface ProfileUpdateData {
	display_name?: string;
	avatar_url?: string;
	bio?: string;
}
