/**
 * The business that operates Proyekto. One place, because the legal pages,
 * the footers and the contact page all name it, and a store reviewer checks
 * that they agree with each other and with the developer account.
 *
 * The backend keeps a mirror for email footers:
 * backend/src/common/company.ts. Change both together.
 */
export const COMPANY = {
	legalName: "Proyekto Business Services",
	addressLines: ["Level 4, 80 Ann Street", "Brisbane QLD 4000", "Australia"],
	email: "support@proyekto.tech",
} as const;

/** "Level 4, 80 Ann Street, Brisbane QLD 4000, Australia" */
export const COMPANY_ADDRESS = COMPANY.addressLines.join(", ");
