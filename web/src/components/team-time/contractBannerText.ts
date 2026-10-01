/**
 * The project Time page's contract-enforcement banner. Contracts are web-only
 * (lib/platformSurfaces.ts), so the installed app explains the block without
 * naming them.
 */
export function contractBannerText(enforce: boolean, native: boolean): string {
	if (native) {
		return enforce
			? "This team needs to set you up before you can track time on this project. Ask the team owner."
			: "This team asks to set you up before you track time here. You can still log time for now.";
	}
	return enforce
		? "Time tracking on this project requires a signed contract. Ask the team to send you one — until it is signed, new time logs are blocked."
		: "This team asks for a signed contract before tracking time here. You can still log time for now, but your logs may be flagged until a contract is signed.";
}
