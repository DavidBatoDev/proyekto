/**
 * Simplified, brand-colored badge icons for video providers — a rounded tile in
 * each provider's brand color with a generic camera/people glyph (not a
 * pixel-exact trademarked mark). Used by the video-provider picker and event
 * cards so a pasted Meet/Zoom/Teams link is visually branded.
 */
import { Video } from "lucide-react";
import type { ProviderId } from "./providers";

interface LogoProps {
	className?: string;
}

function Tile({
	color,
	children,
	className,
}: {
	color: string;
	children: React.ReactNode;
	className?: string;
}) {
	return (
		<svg
			viewBox="0 0 24 24"
			className={className ?? "h-6 w-6"}
			aria-hidden="true"
		>
			<rect x="0" y="0" width="24" height="24" rx="6" fill={color} />
			{children}
		</svg>
	);
}

// A simple white video-camera glyph (body + lens triangle) centered in a tile.
function CameraGlyph() {
	return (
		<>
			<rect x="5" y="8" width="9" height="8" rx="1.5" fill="#fff" />
			<path d="M15 11.2 L19 8.8 V15.2 L15 12.8 Z" fill="#fff" />
		</>
	);
}

export function GoogleMeetLogo({ className }: LogoProps) {
	// Google green tile; the multi-color accent nods to the brand palette.
	return (
		<Tile color="#00832d" className={className}>
			<rect x="5" y="8" width="8.5" height="8" rx="1.5" fill="#fff" />
			<path d="M14.5 11 L19 8.5 V15.5 L14.5 13 Z" fill="#ffba00" />
			<path d="M14.5 11 L19 8.5 V12 L14.5 12 Z" fill="#00ac47" />
			<rect x="5" y="8" width="3" height="8" rx="1.5" fill="#4285f4" />
		</Tile>
	);
}

export function ZoomLogo({ className }: LogoProps) {
	return (
		<Tile color="#2d8cff" className={className}>
			<CameraGlyph />
		</Tile>
	);
}

export function TeamsLogo({ className }: LogoProps) {
	// Purple tile with a white "people" glyph.
	return (
		<Tile color="#5b5fc7" className={className}>
			<circle cx="10" cy="9" r="2.4" fill="#fff" />
			<circle cx="15.5" cy="9.5" r="1.8" fill="#fff" opacity="0.85" />
			<path d="M6 17 c0-2.4 2-4 4-4 s4 1.6 4 4 z" fill="#fff" />
			<path
				d="M14 17 c0-1.8 1-3.2 2.6-3.2 c1.4 0 2.4 1.2 2.4 3.2 z"
				fill="#fff"
				opacity="0.85"
			/>
		</Tile>
	);
}

export function JitsiLogo({ className }: LogoProps) {
	return (
		<Tile color="#1d76ba" className={className}>
			<CameraGlyph />
		</Tile>
	);
}

export function OtherProviderLogo({ className }: LogoProps) {
	return (
		<span
			className={`inline-flex items-center justify-center rounded-md bg-gray-100 text-gray-500 ${
				className ?? "h-6 w-6"
			}`}
		>
			<Video className="h-3.5 w-3.5" />
		</span>
	);
}

const LOGOS: Record<ProviderId, (props: LogoProps) => React.ReactElement> = {
	google_meet: GoogleMeetLogo,
	zoom: ZoomLogo,
	teams: TeamsLogo,
	jitsi: JitsiLogo,
	other: OtherProviderLogo,
};

export function ProviderLogo({
	id,
	className,
}: {
	id: ProviderId;
	className?: string;
}) {
	const Logo = LOGOS[id] ?? OtherProviderLogo;
	return <Logo className={className} />;
}
