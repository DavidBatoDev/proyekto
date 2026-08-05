import { describe, expect, it } from "vitest";
import {
	findContractVariables,
	renderContractVariables,
	resolveContractVariable,
} from "./contract-variables";

const values = {
	provider_name: "Northstar Studio",
	client_name: "Heavenly Glow",
	client_tin: "123-456-789",
};

describe("contract variables", () => {
	it("resolves legacy and named variables from the Parties form", () => {
		expect(resolveContractVariable("{{provider}}", values)).toBe(
			"Northstar Studio",
		);
		expect(resolveContractVariable("{{client_tin}}", values)).toBe(
			"123-456-789",
		);
	});

	it("filters variables by label and current value", () => {
		expect(
			findContractVariables("tin", values).map((item) => item.token),
		).toContain("{{client_tin}}");
		expect(
			findContractVariables("heavenly", values).map((item) => item.token),
		).toContain("{{client_name}}");
	});

	it("keeps source tokens while exposing their live display values", () => {
		const parts = renderContractVariables(
			"For {{client_name}}, TIN {{client_tin}}.",
			values,
		);
		expect(parts).toContainEqual({
			token: "{{client_name}}",
			label: "Heavenly Glow",
			key: "{{client_name}}-1",
		});
		expect(parts).toContainEqual({
			token: "{{client_tin}}",
			label: "123-456-789",
			key: "{{client_tin}}-3",
		});
	});
});
