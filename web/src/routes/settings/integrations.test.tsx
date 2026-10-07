/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";

const mocks = vi.hoisted(() => ({
	native: false,
	status: {
		isPending: false,
		isError: false,
		data: undefined as
			| { enabled: boolean; connected: boolean; googleEmail?: string | null }
			| undefined,
		refetch: vi.fn(),
	},
	connect: vi.fn(),
	disconnect: vi.fn(),
	connectResult: vi.fn(),
	toastSuccess: vi.fn(),
	toastError: vi.fn(),
}));

vi.mock("@/lib/platform", () => ({ isNativeApp: () => mocks.native }));

vi.mock("@/hooks/useMeetings", () => ({
	useGoogleCalendarStatus: () => mocks.status,
	useConnectGoogleCalendar: () => ({
		connect: mocks.connect,
		connecting: false,
		error: null,
	}),
	useDisconnectGoogleCalendar: () => ({
		mutate: mocks.disconnect,
		isPending: false,
	}),
	useGoogleConnectResult: mocks.connectResult,
}));

vi.mock("@/hooks/useToast", () => ({
	useToast: () => ({ success: mocks.toastSuccess, error: mocks.toastError }),
}));

// Partial: createFileRoute needs the real router internals.
vi.mock("@tanstack/react-router", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	Link: ({ to, children }: { to: string; children?: ReactNode }) => (
		<a href={to}>{children}</a>
	),
}));

import { Route } from "./integrations";

beforeAll(async () => {
	const component = Route.options.component as unknown as {
		preload?: () => Promise<void>;
	};
	await component.preload?.();
}, 30_000);

function renderPage() {
	const Page = Route.options.component as ComponentType;
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return render(
		<QueryClientProvider client={client}>
			<Page />
		</QueryClientProvider>,
	);
}

beforeEach(() => {
	mocks.native = false;
	mocks.status.isPending = false;
	mocks.status.isError = false;
	mocks.status.data = { enabled: true, connected: false };
	vi.clearAllMocks();
});

afterEach(cleanup);

describe("Settings → Integrations", () => {
	it("handles the return from Google's consent screen", () => {
		renderPage();
		expect(mocks.connectResult).toHaveBeenCalled();
	});

	it("offers Connect when Google Calendar isn't connected", () => {
		renderPage();
		fireEvent.click(
			screen.getByRole("button", { name: "Connect Google Calendar" }),
		);
		expect(mocks.connect).toHaveBeenCalledTimes(1);
		expect(screen.getByText(/hasn't verified Proyekto yet/)).toBeTruthy();
	});

	it("shows the connected account and confirms before disconnecting", () => {
		mocks.status.data = {
			enabled: true,
			connected: true,
			googleEmail: "me@example.com",
		};
		renderPage();

		expect(screen.getByText("me@example.com")).toBeTruthy();
		expect(screen.getByText("Connected")).toBeTruthy();
		expect(
			screen.queryByRole("button", { name: "Connect Google Calendar" }),
		).toBeNull();

		fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
		// The first click only asks; nothing is disconnected yet.
		expect(mocks.disconnect).not.toHaveBeenCalled();
		expect(screen.getByText("Disconnect Google Calendar?")).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "Keep connected" }));
		expect(screen.queryByText("Disconnect Google Calendar?")).toBeNull();

		fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
		fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
		expect(mocks.disconnect).toHaveBeenCalledTimes(1);
	});

	it("says so when the integration isn't available", () => {
		mocks.status.data = { enabled: false, connected: false };
		renderPage();
		expect(
			screen.getByText("Google Calendar isn't available right now."),
		).toBeTruthy();
		expect(
			screen.queryByRole("button", { name: "Connect Google Calendar" }),
		).toBeNull();
	});

	it("points the mobile app to the web, where Google allows sign-in", () => {
		mocks.native = true;
		renderPage();
		expect(
			screen.queryByRole("button", { name: "Connect Google Calendar" }),
		).toBeNull();
		expect(
			screen.getByText(/open proyekto.tech in a web browser/),
		).toBeTruthy();
	});

	it("still lets the mobile app disconnect", () => {
		mocks.native = true;
		mocks.status.data = { enabled: true, connected: true, googleEmail: null };
		renderPage();
		expect(screen.getByRole("button", { name: "Disconnect" })).toBeTruthy();
	});
});
