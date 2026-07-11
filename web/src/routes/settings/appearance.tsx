import { createFileRoute, redirect } from "@tanstack/react-router";
import {
	Check,
	ChevronDown,
	Clipboard,
	Download,
	Palette,
	X,
} from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import { ModalPortal } from "@/components/common/ModalPortal";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { featureFlags } from "@/config/featureFlags";
import { useToast } from "@/hooks/useToast";
import { useAppearanceStore } from "@/stores/appearanceStore";
import { useAuthStore } from "@/stores/authStore";
import { THEME_OPTIONS } from "@/theme/presets";
import {
	normalizeHex,
	parseThemeShare,
	serializeThemeShare,
} from "@/theme/theme";
import type { HexColor } from "@/theme/types";

export const Route = createFileRoute("/settings/appearance")({
	beforeLoad: () => {
		if (!featureFlags.themeSystem) throw redirect({ to: "/dashboard" });
		if (!useAuthStore.getState().isAuthenticated) {
			throw redirect({ to: "/auth/login" });
		}
	},
	component: AppearanceSettingsPage,
});

function ColorField({
	label,
	value,
	onChange,
}: {
	label: string;
	value: HexColor;
	onChange: (value: HexColor) => void;
}) {
	const [draft, setDraft] = useState<string>(value);
	useEffect(() => setDraft(value), [value]);

	const commit = () => {
		const normalized = normalizeHex(draft);
		if (normalized) {
			setDraft(normalized);
			onChange(normalized);
		} else {
			setDraft(value);
		}
	};

	return (
		<div className="flex flex-col gap-3 border-b border-border px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-7">
			<label
				className="text-sm font-medium text-muted-foreground"
				htmlFor={`${label}-theme-color`}
			>
				{label}
			</label>
			<div className="flex h-11 w-full items-center overflow-hidden rounded-xl border border-input bg-card sm:w-[min(28rem,55%)]">
				<label
					className="relative flex h-full w-12 shrink-0 cursor-pointer items-center justify-center"
					style={{ backgroundColor: value }}
				>
					<Palette className="h-4 w-4 text-primary-foreground drop-shadow-sm" />
					<input
						id={`${label}-theme-color`}
						type="color"
						value={value}
						onChange={(event) =>
							onChange(event.target.value.toUpperCase() as HexColor)
						}
						className="absolute inset-0 cursor-pointer opacity-0"
						aria-label={`${label} color picker`}
					/>
				</label>
				<input
					value={draft}
					onChange={(event) => setDraft(event.target.value)}
					onBlur={commit}
					onKeyDown={(event) => {
						if (event.key === "Enter") event.currentTarget.blur();
					}}
					className="min-w-0 flex-1 bg-transparent px-4 text-sm font-semibold uppercase text-foreground outline-none"
					aria-label={`${label} hex color`}
					maxLength={7}
					spellCheck={false}
				/>
			</div>
		</div>
	);
}

function ContrastField({
	value,
	onChange,
}: {
	value: number;
	onChange: (value: number) => void;
}) {
	const id = useId();
	return (
		<div className="flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-7">
			<label className="text-sm font-medium text-muted-foreground" htmlFor={id}>
				Contrast
			</label>
			<div className="flex w-full items-center gap-4 sm:w-[min(28rem,55%)]">
				<input
					id={id}
					type="range"
					min={0}
					max={100}
					value={value}
					onChange={(event) => onChange(Number(event.target.value))}
					className="h-2 min-w-0 flex-1 cursor-pointer accent-primary"
				/>
				<output
					htmlFor={id}
					className="w-8 text-right text-sm font-medium text-foreground"
				>
					{value}
				</output>
			</div>
		</div>
	);
}

function Toggle({
	checked,
	onChange,
	label,
}: {
	checked: boolean;
	onChange: (checked: boolean) => void;
	label: string;
}) {
	return (
		<button
			type="button"
			role="switch"
			aria-checked={checked}
			aria-label={label}
			onClick={() => onChange(!checked)}
			className={`relative h-7 w-12 rounded-full transition-colors ${checked ? "bg-primary" : "bg-muted-foreground/40"}`}
		>
			<span
				className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${checked ? "translate-x-5" : "translate-x-1"}`}
			/>
		</button>
	);
}

function ImportThemeDialog({ onClose }: { onClose: () => void }) {
	const titleId = useId();
	const [raw, setRaw] = useState("");
	const [error, setError] = useState<string | null>(null);
	const preferences = useAppearanceStore((state) => state.preferences);
	const replacePreferences = useAppearanceStore(
		(state) => state.replacePreferences,
	);
	const parsed = useMemo(() => {
		if (!raw.trim()) return null;
		try {
			return parseThemeShare(raw.trim());
		} catch (caught) {
			return caught instanceof Error
				? caught
				: new Error("Theme data is invalid.");
		}
	}, [raw]);
	const validationError =
		error ?? (parsed instanceof Error ? parsed.message : null);

	const apply = () => {
		if (!parsed || parsed instanceof Error) {
			setError(
				parsed instanceof Error ? parsed.message : "Paste a theme first.",
			);
			return;
		}
		const next =
			parsed.theme === "custom"
				? parsed
				: { ...preferences, theme: parsed.theme };
		replacePreferences(next, { dirty: true });
		onClose();
	};

	return (
		<ModalPortal>
			<div
				className="fixed inset-0 z-[10010] flex items-center justify-center bg-(--app-overlay) p-4"
				role="presentation"
			>
				<div
					role="dialog"
					aria-modal="true"
					aria-labelledby={titleId}
					className="w-full max-w-lg rounded-2xl border border-border bg-popover p-6 text-popover-foreground shadow-(--app-shadow-lg)"
				>
					<div className="flex items-center justify-between gap-3">
						<div>
							<h2 id={titleId} className="text-lg font-semibold">
								Import theme
							</h2>
							<p className="mt-1 text-sm text-muted-foreground">
								Paste Proyekto theme JSON to preview and apply it.
							</p>
						</div>
						<button
							type="button"
							onClick={onClose}
							className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
							aria-label="Close import theme dialog"
						>
							<X className="h-5 w-5" />
						</button>
					</div>
					<textarea
						value={raw}
						onChange={(event) => {
							setRaw(event.target.value);
							setError(null);
						}}
						className="mt-5 h-40 w-full resize-none rounded-xl border border-input bg-background p-3 font-mono text-xs text-foreground outline-none focus:ring-2 focus:ring-ring/50"
						placeholder='{"version":1,"theme":"custom",...}'
						maxLength={4096}
					/>
					{validationError && (
						<p className="mt-2 text-sm text-destructive">{validationError}</p>
					)}
					{parsed && !(parsed instanceof Error) && (
						<div className="mt-3 flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-sm">
							<Check className="h-4 w-4 text-success" />
							Ready to apply{" "}
							{
								THEME_OPTIONS.find((option) => option.id === parsed.theme)
									?.label
							}
							.
						</div>
					)}
					<div className="mt-5 flex justify-end gap-2">
						<button
							type="button"
							onClick={onClose}
							className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted"
						>
							Cancel
						</button>
						<button
							type="button"
							onClick={apply}
							disabled={!parsed || parsed instanceof Error}
							className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
						>
							Apply theme
						</button>
					</div>
				</div>
			</div>
		</ModalPortal>
	);
}

function AppearanceSettingsPage() {
	const preferences = useAppearanceStore((state) => state.preferences);
	const setTheme = useAppearanceStore((state) => state.setTheme);
	const updateCustom = useAppearanceStore((state) => state.updateCustom);
	const updateSidebar = useAppearanceStore((state) => state.updateSidebar);
	const saving = useAppearanceStore((state) => state.saving);
	const dirty = useAppearanceStore((state) => state.dirty);
	const lastError = useAppearanceStore((state) => state.lastError);
	const [importOpen, setImportOpen] = useState(false);
	const toast = useToast();

	const copyCurrentTheme = async () => {
		const payload = serializeThemeShare(preferences);
		try {
			await navigator.clipboard.writeText(payload);
			toast.success("Theme copied to clipboard");
		} catch {
			const textArea = document.createElement("textarea");
			textArea.value = payload;
			textArea.style.position = "fixed";
			textArea.style.opacity = "0";
			document.body.appendChild(textArea);
			textArea.select();
			document.execCommand("copy");
			textArea.remove();
			toast.success("Theme copied to clipboard");
		}
	};

	return (
		<DashboardShell>
			<div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-10 lg:py-12">
				<div className="mb-8 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
					<div>
						<p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
							Account settings
						</p>
						<h1 className="mt-2 text-3xl font-semibold tracking-tight text-foreground">
							Appearance
						</h1>
						<p className="mt-2 max-w-2xl text-sm text-muted-foreground">
							Choose how Proyekto looks on this device and every device
							connected to your account.
						</p>
					</div>
					<p
						className={`text-xs ${lastError ? "text-destructive" : "text-muted-foreground"}`}
						aria-live="polite"
					>
						{lastError
							? "Saved on this device; cloud sync will retry."
							: saving
								? "Saving…"
								: dirty
									? "Waiting to sync…"
									: "Saved"}
					</p>
				</div>

				<section className="overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-(--app-shadow-sm)">
					<div className="flex flex-col gap-4 px-5 py-6 sm:flex-row sm:items-center sm:justify-between sm:px-7">
						<div>
							<h2 className="text-base font-semibold">Interface theme</h2>
							<p className="mt-1 text-sm text-muted-foreground">
								Select or customize your interface color scheme
							</p>
						</div>
						<label className="relative w-full sm:w-auto">
							<span className="sr-only">Interface theme</span>
							<span className="pointer-events-none absolute left-3 top-1/2 flex -translate-y-1/2 items-center gap-2 rounded-lg border border-border bg-background px-2 py-1 text-sm">
								<span className="h-2 w-2 rounded-full bg-primary" /> Aa
							</span>
							<select
								value={preferences.theme}
								onChange={(event) =>
									setTheme(event.target.value as typeof preferences.theme)
								}
								className="h-12 w-full appearance-none rounded-xl border border-input bg-card pl-[4.5rem] pr-10 text-sm font-medium text-foreground outline-none focus:ring-2 focus:ring-ring/50 sm:min-w-56"
							>
								{THEME_OPTIONS.map((option) => (
									<option key={option.id} value={option.id}>
										{option.label}
									</option>
								))}
							</select>
							<ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
						</label>
					</div>

					{preferences.theme === "custom" && (
						<div className="border-t border-border">
							<ColorField
								label="Accent"
								value={preferences.custom.accent}
								onChange={(accent) => updateCustom({ accent })}
							/>
							<ColorField
								label="Background"
								value={preferences.custom.background}
								onChange={(background) => updateCustom({ background })}
							/>
							<ContrastField
								value={preferences.custom.contrast}
								onChange={(contrast) => updateCustom({ contrast })}
							/>
						</div>
					)}
				</section>

				{preferences.theme === "custom" && (
					<section className="mt-5 overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-(--app-shadow-sm)">
						<div className="flex items-center justify-between gap-4 px-5 py-6 sm:px-7">
							<div>
								<h2 className="text-base font-semibold">
									Custom sidebar theme
								</h2>
								<p className="mt-1 text-sm text-muted-foreground">
									Use independent colors for navigation surfaces.
								</p>
							</div>
							<Toggle
								checked={preferences.custom.sidebar.enabled}
								onChange={(enabled) => {
									const sidebar = preferences.custom.sidebar;
									const isPristine =
										sidebar.accent === "#6D78D5" &&
										sidebar.background === "#FFFFFF" &&
										sidebar.contrast === 30;
									updateSidebar(
										enabled && isPristine
											? {
													enabled,
													accent: preferences.custom.accent,
													background: preferences.custom.background,
													contrast: preferences.custom.contrast,
												}
											: { enabled },
									);
								}}
								label="Custom sidebar theme"
							/>
						</div>
						{preferences.custom.sidebar.enabled && (
							<div className="border-t border-border">
								<ColorField
									label="Sidebar accent"
									value={preferences.custom.sidebar.accent}
									onChange={(accent) => updateSidebar({ accent })}
								/>
								<ColorField
									label="Sidebar background"
									value={preferences.custom.sidebar.background}
									onChange={(background) => updateSidebar({ background })}
								/>
								<ContrastField
									value={preferences.custom.sidebar.contrast}
									onChange={(contrast) => updateSidebar({ contrast })}
								/>
							</div>
						)}
					</section>
				)}

				<section className="mt-5 rounded-2xl border border-border bg-card px-5 py-6 text-card-foreground shadow-(--app-shadow-sm) sm:px-7">
					<div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
						<div>
							<h2 className="text-base font-semibold">Sharing</h2>
							<p className="mt-1 text-sm text-muted-foreground">
								Move a theme between accounts or share it with someone else.
							</p>
						</div>
						<div className="flex flex-col gap-2 sm:flex-row">
							<button
								type="button"
								onClick={() => setImportOpen(true)}
								className="inline-flex items-center justify-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm font-medium hover:bg-muted"
							>
								<Download className="h-4 w-4" /> Import theme
							</button>
							<button
								type="button"
								onClick={copyCurrentTheme}
								className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-(--primary-dark)"
							>
								<Clipboard className="h-4 w-4" /> Copy current theme
							</button>
						</div>
					</div>
				</section>
			</div>
			{importOpen && <ImportThemeDialog onClose={() => setImportOpen(false)} />}
		</DashboardShell>
	);
}
