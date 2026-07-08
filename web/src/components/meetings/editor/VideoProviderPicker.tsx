/**
 * Video-conferencing selector: auto-generate a Jitsi room, paste an external
 * link (Google Meet / Zoom / Teams / other — brand auto-detected from the URL
 * and shown with its logo), or no video. Stores a VideoOption + meeting_url;
 * the brand is display-only (see providers.ts).
 */
import type { VideoOption } from "@/services/meetings.service";
import {
	GoogleMeetLogo,
	JitsiLogo,
	OtherProviderLogo,
	ProviderLogo,
	TeamsLogo,
	ZoomLogo,
} from "./ProviderLogos";
import { detectProvider, PROVIDER_LABELS } from "./providers";

interface VideoProviderPickerProps {
	option: VideoOption;
	meetingUrl: string;
	onOptionChange: (option: VideoOption) => void;
	onUrlChange: (url: string) => void;
}

export function VideoProviderPicker({
	option,
	meetingUrl,
	onOptionChange,
	onUrlChange,
}: VideoProviderPickerProps) {
	const detected = detectProvider(meetingUrl);

	return (
		<div className="space-y-2">
			<OptionCard
				selected={option === "jitsi"}
				onSelect={() => onOptionChange("jitsi")}
				icon={<JitsiLogo className="h-6 w-6" />}
				label="Generate a video room"
				hint="A private Jitsi link is created automatically — no account needed."
			/>

			<OptionCard
				selected={option === "external_link"}
				onSelect={() => onOptionChange("external_link")}
				icon={
					option === "external_link" && meetingUrl ? (
						<ProviderLogo id={detected} className="h-6 w-6" />
					) : (
						<div className="flex -space-x-1">
							<GoogleMeetLogo className="h-5 w-5" />
							<ZoomLogo className="h-5 w-5" />
							<TeamsLogo className="h-5 w-5" />
						</div>
					)
				}
				label="Paste a meeting link"
				hint="Use an existing Google Meet, Zoom, or Teams link."
			>
				{option === "external_link" && (
					<div className="mt-2 space-y-1">
						<input
							value={meetingUrl}
							onChange={(e) => onUrlChange(e.target.value)}
							placeholder="https://meet.google.com/…"
							className="w-full border-0 border-b border-gray-300 bg-transparent px-0 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-0"
						/>
						{meetingUrl && (
							<p className="flex items-center gap-1.5 text-xs text-gray-500">
								<ProviderLogo id={detected} className="h-4 w-4" />
								{detected === "other"
									? "Custom video link"
									: `Detected: ${PROVIDER_LABELS[detected]}`}
							</p>
						)}
					</div>
				)}
			</OptionCard>

			<OptionCard
				selected={option === "none"}
				onSelect={() => onOptionChange("none")}
				icon={<OtherProviderLogo className="h-6 w-6" />}
				label="No video link"
				hint="In-person, or add a link later."
			/>
		</div>
	);
}

function OptionCard({
	selected,
	onSelect,
	icon,
	label,
	hint,
	children,
}: {
	selected: boolean;
	onSelect: () => void;
	icon: React.ReactNode;
	label: string;
	hint: string;
	children?: React.ReactNode;
}) {
	return (
		<div
			className={`rounded-xl border px-3 py-2.5 transition-colors ${
				selected ? "border-primary bg-primary/5" : "border-gray-200"
			}`}
		>
			<button
				type="button"
				onClick={onSelect}
				className="flex w-full items-start gap-3 text-left"
			>
				<span className="mt-0.5 shrink-0">{icon}</span>
				<span className="min-w-0">
					<span className="block text-sm font-medium text-gray-800">
						{label}
					</span>
					<span className="block text-xs text-gray-500">{hint}</span>
				</span>
				<span
					className={`ml-auto mt-1 h-4 w-4 shrink-0 rounded-full border ${
						selected ? "border-primary bg-primary" : "border-gray-300"
					}`}
				/>
			</button>
			{children}
		</div>
	);
}
