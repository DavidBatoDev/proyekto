/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TeamMember, TeamMemberRate } from "@/services/teams.service";
import { DEFAULT_RATE_TYPE_DRAFT } from "./MemberRateTypeFields";
import {
	AddRateModal,
	type AddRateModalProps,
	DeleteRateModal,
	EditRateModal,
	type EditRateModalProps,
	TEAM_RATE_COPY,
} from "./TeamRateModals";

const member: TeamMember = {
	id: "tm-1",
	team_id: "team-1",
	user_id: "user-1",
	role: "member",
	position: null,
	joined_at: "2026-09-01T00:00:00.000Z",
	user: {
		id: "user-1",
		display_name: "Maria Santos",
		avatar_url: null,
		email: "maria@example.test",
		first_name: null,
		last_name: null,
	},
};

const rate: TeamMemberRate = {
	id: "rate-1",
	team_id: "team-1",
	user_id: "user-1",
	project_id: "p1",
	rate_type: "hourly",
	fixed_amount: null,
	fixed_period: "month",
	hourly_rate: 25,
	training_hourly_rate: 15,
	currency: "PHP",
	custom_id: null,
	start_date: "2026-09-01",
	end_date: null,
	weekly_limit_hours: null,
	monthly_limit_hours: null,
	overtime_requires_approval: false,
	created_at: "2026-09-01T00:00:00.000Z",
	updated_at: "2026-09-01T00:00:00.000Z",
};

function addProps(
	overrides: Partial<AddRateModalProps> = {},
): AddRateModalProps {
	return {
		isOpen: true,
		canManageRates: true,
		eligibleMembers: [member],
		loadingMembers: false,
		savingRate: false,
		newRateMemberUserId: "user-1",
		newRateCustomId: "",
		newRateValue: "25",
		newRateTrainingValue: "15",
		newRateCurrency: "PHP",
		newRateStartDate: "2026-10-01",
		newRateEndDate: "",
		attachedProjects: [
			{ id: "p1", title: "Acme Website" },
			{ id: "p2", title: "Internal ops" },
		],
		coveredProjectIds: ["p1"],
		scopeMode: "all",
		selectedProjectIds: [],
		rateTypeDraft: DEFAULT_RATE_TYPE_DRAFT,
		onChangeRateTypeDraft: vi.fn(),
		onClose: vi.fn(),
		onCreateRate: vi.fn(),
		onChangeMemberUserId: vi.fn(),
		onChangeCustomId: vi.fn(),
		onChangeRateValue: vi.fn(),
		onChangeRateTrainingValue: vi.fn(),
		onChangeRateCurrency: vi.fn(),
		onChangeStartDate: vi.fn(),
		onChangeEndDate: vi.fn(),
		onChangeScopeMode: vi.fn(),
		onChangeSelectedProjectIds: vi.fn(),
		...overrides,
	};
}

function editProps(
	overrides: Partial<EditRateModalProps> = {},
): EditRateModalProps {
	return {
		isOpen: true,
		canManageRates: true,
		editingRate: rate,
		memberLabel: "Maria Santos",
		editingRateCustomId: "",
		editingRateValue: "25",
		editingRateTrainingValue: "15",
		editingRateCurrency: "PHP",
		editingRateStartDate: "2026-09-01",
		editingRateEndDate: "",
		savingRate: false,
		rateTypeDraft: DEFAULT_RATE_TYPE_DRAFT,
		onChangeRateTypeDraft: vi.fn(),
		onClose: vi.fn(),
		onSave: vi.fn(),
		onRequestDelete: vi.fn(),
		onChangeCustomId: vi.fn(),
		onChangeRateValue: vi.fn(),
		onChangeRateTrainingValue: vi.fn(),
		onChangeRateCurrency: vi.fn(),
		onChangeStartDate: vi.fn(),
		onChangeEndDate: vi.fn(),
		...overrides,
	};
}

afterEach(() => cleanup());

describe("AddRateModal", () => {
	it("is a named dialog that never says a rate is needed to track time", () => {
		render(<AddRateModal {...addProps()} />);

		expect(screen.getByRole("dialog", { name: "Add a rate" })).toBeTruthy();
		expect(screen.getByText(TEAM_RATE_COPY.addSubtitle)).toBeTruthy();
		const text = document.body.textContent ?? "";
		expect(text).not.toMatch(/cannot start timers|My Logs|time logs?\b/i);
	});

	it("marks projects that already have a current rate and saves the rest", () => {
		const props = addProps();
		render(<AddRateModal {...props} />);

		expect(screen.getByText("Has a current rate")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Save rate" }));
		expect(props.onCreateRate).toHaveBeenCalledTimes(1);
	});

	it("can't save until the required fields are in", () => {
		render(<AddRateModal {...addProps({ newRateStartDate: "" })} />);
		const save = screen.getByRole("button", {
			name: "Save rate",
		}) as HTMLButtonElement;
		expect(save.disabled).toBe(true);
	});

	it("explains that an end date stops the rate on that day", () => {
		render(<AddRateModal {...addProps({ newRateEndDate: "2026-12-31" })} />);
		expect(screen.getByText(TEAM_RATE_COPY.endDateTitle)).toBeTruthy();
		expect(screen.getByText(TEAM_RATE_COPY.endDateBody)).toBeTruthy();
	});

	it("says so when the team has no projects", () => {
		render(<AddRateModal {...addProps({ attachedProjects: [] })} />);
		expect(screen.getByText(TEAM_RATE_COPY.noProjects)).toBeTruthy();
	});

	it("renders nothing for someone who can't manage rates", () => {
		render(<AddRateModal {...addProps({ canManageRates: false })} />);
		expect(screen.queryByRole("dialog")).toBeNull();
	});
});

describe("EditRateModal", () => {
	it("warns only when the edit adds an end date", () => {
		const { rerender } = render(<EditRateModal {...editProps()} />);
		expect(screen.getByRole("dialog", { name: "Edit rate" })).toBeTruthy();
		expect(screen.queryByText(TEAM_RATE_COPY.endDateTitle)).toBeNull();

		rerender(
			<EditRateModal {...editProps({ editingRateEndDate: "2026-12-31" })} />,
		);
		expect(screen.getByText(TEAM_RATE_COPY.endDateTitle)).toBeTruthy();
	});

	it("saves and asks to delete", () => {
		const props = editProps();
		render(<EditRateModal {...props} />);
		fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
		fireEvent.click(screen.getByRole("button", { name: "Delete rate" }));
		expect(props.onSave).toHaveBeenCalledTimes(1);
		expect(props.onRequestDelete).toHaveBeenCalledTimes(1);
	});
});

describe("DeleteRateModal", () => {
	it("deletes only after DELETE is typed", () => {
		const onConfirmDelete = vi.fn();
		const { rerender } = render(
			<DeleteRateModal
				isOpen
				targetLabel="Maria Santos"
				verificationText=""
				deletingRate={false}
				onClose={vi.fn()}
				onChangeVerificationText={vi.fn()}
				onConfirmDelete={onConfirmDelete}
			/>,
		);
		const button = () =>
			screen.getByRole("button", { name: "Delete rate" }) as HTMLButtonElement;
		expect(screen.getByRole("dialog", { name: "Delete rate" })).toBeTruthy();
		expect(button().disabled).toBe(true);

		rerender(
			<DeleteRateModal
				isOpen
				targetLabel="Maria Santos"
				verificationText="delete"
				deletingRate={false}
				onClose={vi.fn()}
				onChangeVerificationText={vi.fn()}
				onConfirmDelete={onConfirmDelete}
			/>,
		);
		fireEvent.click(button());
		expect(onConfirmDelete).toHaveBeenCalledTimes(1);
	});
});
