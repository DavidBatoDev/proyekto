import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
	throw new Error("Missing Supabase environment variables");
}

// Create Supabase client
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
	auth: {
		autoRefreshToken: true,
		persistSession: true,
		detectSessionInUrl: true,
	},
});

/**
 * Get the current session's access token
 */
export async function getAccessToken(): Promise<string | null> {
	const {
		data: { session },
	} = await supabase.auth.getSession();
	return session?.access_token ?? null;
}

/**
 * Get the current authenticated user
 */
export async function getCurrentUser() {
	const {
		data: { user },
		error,
	} = await supabase.auth.getUser();
	if (error) throw error;
	return user;
}

/**
 * Get the current user's profile
 */
export async function getCurrentProfile() {
	const user = await getCurrentUser();
	if (!user) return null;

	const { data, error } = await supabase
		.from("profiles")
		.select("*")
		.eq("id", user.id)
		.single();

	if (error) throw error;
	return data;
}
