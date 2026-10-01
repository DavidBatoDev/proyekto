import { useQueryClient } from "@tanstack/react-query";
import { useRouterState } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AppDialog } from "@/components/common/AppDialog";
import { useProfileQuery } from "@/hooks/useProfileQuery";
import { isGuestSession } from "@/lib/guestAuth";
import { profileKeys, updateProfileData } from "@/queries/profile";
import { useAuthStore } from "@/stores/authStore";
import type { Profile } from "@/types";
import {
	DISPLAY_NAME_MAX_LENGTH,
	type DisplayNameProfile,
	needsDisplayName,
	suggestedDisplayName,
	validateDisplayName,
} from "./displayNameGate.logic";

/**
 * A blocking prompt for anyone signed in without a display name: after
 * sign-up, after an OAuth or invite sign-in, and for existing accounts that
 * never set one. It cannot be dismissed; the name is what contracts, seats,
 * invites and chat show for this person instead of their email. The copy
 * stays free of contract wording because the prompt also runs in the app.
 */
export function DisplayNameGate() {
	const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
	const user = useAuthStore((state) => state.user);
	const { data: profile } = useProfileQuery();
	const pathname = useRouterState({ select: (s) => s.location.pathname });
	const queryClient = useQueryClient();
	const [name, setName] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const inputRef = useRef<HTMLInputElement | null>(null);

	const open =
		isAuthenticated &&
		Boolean(user) &&
		!isGuestSession() &&
		needsDisplayName(profile as DisplayNameProfile | null, pathname);

	useEffect(() => {
		if (open) setName(suggestedDisplayName(profile as DisplayNameProfile));
	}, [open, profile]);

	const save = async () => {
		if (!user) return;
		const checked = validateDisplayName(name);
		if (!checked.ok) {
			setError(checked.error);
			return;
		}
		setSaving(true);
		setError(null);
		try {
			const updated = await updateProfileData(user.id, {
				display_name: checked.value,
			} as Partial<Profile>);
			queryClient.setQueryData(profileKeys.byUser(user.id), updated);
			useAuthStore.getState().setProfile(updated);
		} catch (err) {
			setError(
				err instanceof Error ? err.message : "Could not save your name.",
			);
		} finally {
			setSaving(false);
		}
	};

	return (
		<AppDialog
			open={open}
			onClose={() => undefined}
			hideCloseButton
			busy
			size="sm"
			zIndex={1300}
			initialFocusRef={inputRef}
			title="What should people call you?"
			description="This is the name your teammates see on invites, messages and shared work. You can change it later in your profile."
		>
			<form
				onSubmit={(event) => {
					event.preventDefault();
					void save();
				}}
				className="space-y-3"
			>
				<label className="block">
					<span className="mb-1 block text-xs font-semibold text-muted-foreground">
						Display name
					</span>
					<input
						ref={inputRef}
						value={name}
						maxLength={DISPLAY_NAME_MAX_LENGTH}
						autoComplete="name"
						disabled={saving}
						onChange={(event) => {
							setName(event.target.value);
							setError(null);
						}}
						placeholder="e.g. Jamie Cruz"
						aria-invalid={Boolean(error)}
						className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30"
					/>
				</label>
				{error && (
					<p role="alert" className="text-xs text-red-600">
						{error}
					</p>
				)}
				<button
					type="submit"
					disabled={saving || !name.trim()}
					className="app-cta inline-flex w-full items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
				>
					{saving && <Loader2 className="h-4 w-4 animate-spin" />}
					Continue
				</button>
			</form>
		</AppDialog>
	);
}
