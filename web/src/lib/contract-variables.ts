export interface ContractVariableValues {
	provider_name?: string | null;
	provider_address?: string | null;
	provider_email?: string | null;
	provider_tin?: string | null;
	provider_kind?: string | null;
	client_name?: string | null;
	client_contact_name?: string | null;
	client_address?: string | null;
	client_email?: string | null;
	client_tin?: string | null;
}

export interface ContractVariableDefinition {
	token: string;
	label: string;
	key: keyof ContractVariableValues;
	fallback: string;
}

export const CONTRACT_VARIABLES: ContractVariableDefinition[] = [
	{
		token: "{{provider_name}}",
		label: "Service provider name",
		key: "provider_name",
		fallback: "Service Provider",
	},
	{
		token: "{{provider_address}}",
		label: "Service provider address",
		key: "provider_address",
		fallback: "Service provider address",
	},
	{
		token: "{{provider_email}}",
		label: "Service provider email",
		key: "provider_email",
		fallback: "Service provider email",
	},
	{
		token: "{{provider_tin}}",
		label: "Service provider TIN",
		key: "provider_tin",
		fallback: "Service provider TIN",
	},
	{
		token: "{{provider_kind}}",
		label: "Service provider type",
		key: "provider_kind",
		fallback: "Service provider type",
	},
	{
		token: "{{client_name}}",
		label: "Client name",
		key: "client_name",
		fallback: "Client",
	},
	{
		token: "{{client_contact_name}}",
		label: "Client contact person",
		key: "client_contact_name",
		fallback: "Client contact person",
	},
	{
		token: "{{client_address}}",
		label: "Client address",
		key: "client_address",
		fallback: "Client address",
	},
	{
		token: "{{client_email}}",
		label: "Client email",
		key: "client_email",
		fallback: "Client email",
	},
	{
		token: "{{client_tin}}",
		label: "Client TIN",
		key: "client_tin",
		fallback: "Client TIN",
	},
];

const LEGACY_TOKENS: Record<string, keyof ContractVariableValues> = {
	"{{provider}}": "provider_name",
	"{{client}}": "client_name",
};

const TOKEN_PATTERN = new RegExp(
	`(${[...CONTRACT_VARIABLES.map((item) => item.token), ...Object.keys(LEGACY_TOKENS)].map((token) => token.replace(/[{}]/g, "\\$&")).join("|")})`,
	"g",
);

export function resolveContractVariable(
	token: string,
	values: ContractVariableValues,
): string | null {
	const definition = CONTRACT_VARIABLES.find((item) => item.token === token);
	if (definition) {
		const value = values[definition.key]?.trim();
		if (definition.key === "provider_kind" && value) {
			return value === "agency" ? "Agency or company" : "Individual contractor";
		}
		return value || definition.fallback;
	}
	const legacyKey = LEGACY_TOKENS[token];
	if (!legacyKey) return null;
	return (
		values[legacyKey]?.trim() ||
		(legacyKey === "provider_name" ? "Service Provider" : "Client")
	);
}

export function renderContractVariables(
	value: string,
	values: ContractVariableValues,
) {
	return value.split(TOKEN_PATTERN).map((part, index) => {
		const resolved = resolveContractVariable(part, values);
		if (resolved === null) return part;
		return {
			token: part,
			label: resolved,
			key: `${part}-${index}`,
		};
	});
}

export function findContractVariables(
	query: string,
	values: ContractVariableValues,
) {
	const needle = query.trim().toLowerCase();
	return CONTRACT_VARIABLES.filter((item) => {
		if (!needle) return true;
		return (
			item.label.toLowerCase().includes(needle) ||
			(values[item.key] ?? "").toLowerCase().includes(needle)
		);
	});
}
