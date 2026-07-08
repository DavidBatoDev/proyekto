/**
 * A searchable timezone combobox over the platform's IANA zone list, showing
 * each zone's GMT offset. Value/onChange use IANA identifiers (e.g.
 * "Asia/Manila"). Defaults, when unset, are the viewer's local zone.
 */
import { Globe, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AnchoredPopover } from "@/components/common/AnchoredPopover";
import { listTimeZones, timeZoneOffsetLabel } from "@/lib/datetime";

interface TimezoneSelectProps {
	value: string;
	onChange: (value: string) => void;
	/** The date the meeting occurs on, so offsets reflect its DST state. */
	at?: Date;
	disabled?: boolean;
}

function zoneLabel(zone: string): string {
	return zone.replace(/_/g, " ");
}

export function TimezoneSelect({
	value,
	onChange,
	at,
	disabled,
}: TimezoneSelectProps) {
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const triggerRef = useRef<HTMLButtonElement>(null);
	const searchRef = useRef<HTMLInputElement>(null);

	// Move focus into the search box once the popover has mounted.
	useEffect(() => {
		if (open) {
			const id = requestAnimationFrame(() => searchRef.current?.focus());
			return () => cancelAnimationFrame(id);
		}
	}, [open]);

	const zones = useMemo(() => listTimeZones(), []);
	const filtered = useMemo(() => {
		const q = query.trim().toLowerCase();
		const matches = q
			? zones.filter((z) => z.toLowerCase().includes(q))
			: zones;
		return matches.slice(0, 200);
	}, [zones, query]);

	const openPicker = () => {
		setQuery("");
		setOpen(true);
	};

	const select = (zone: string) => {
		onChange(zone);
		setOpen(false);
	};

	return (
		<>
			<button
				ref={triggerRef}
				type="button"
				disabled={disabled}
				onClick={() => (open ? setOpen(false) : openPicker())}
				className={`flex w-full items-center gap-2 rounded-xl border border-gray-300 px-3 py-2.5 text-left text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-primary/50 ${
					disabled ? "cursor-not-allowed opacity-50" : "hover:bg-gray-50"
				}`}
			>
				<Globe className="h-4 w-4 shrink-0 text-gray-400" />
				<span className="truncate text-gray-800">{zoneLabel(value)}</span>
				<span className="ml-auto shrink-0 text-xs text-gray-400">
					{timeZoneOffsetLabel(value, at)}
				</span>
			</button>

			<AnchoredPopover
				anchorRef={triggerRef}
				open={open}
				onClose={() => setOpen(false)}
				maxHeight={300}
				ariaLabel="Select a timezone"
			>
				<div className="sticky top-0 border-b border-gray-100 bg-white p-2">
					<div className="flex items-center gap-2 rounded-lg border border-gray-200 px-2 py-1.5">
						<Search className="h-3.5 w-3.5 text-gray-400" />
						<input
							ref={searchRef}
							value={query}
							onChange={(e) => setQuery(e.target.value)}
							placeholder="Search timezones…"
							className="w-full bg-transparent text-sm outline-none placeholder:text-gray-400"
						/>
					</div>
				</div>
				<div className="py-1">
					{filtered.length === 0 ? (
						<p className="px-3 py-2 text-sm text-gray-400">No matches.</p>
					) : (
						filtered.map((zone) => (
							<button
								key={zone}
								type="button"
								onMouseDown={(e) => e.preventDefault()}
								onClick={() => select(zone)}
								className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors ${
									zone === value
										? "bg-primary/10 font-medium text-primary"
										: "text-gray-700 hover:bg-gray-100"
								}`}
							>
								<span className="truncate">{zoneLabel(zone)}</span>
								<span className="ml-auto shrink-0 text-xs text-gray-400">
									{timeZoneOffsetLabel(zone, at)}
								</span>
							</button>
						))
					)}
				</div>
			</AnchoredPopover>
		</>
	);
}
