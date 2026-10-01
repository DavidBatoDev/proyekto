/**
 * The business that operates Proyekto, for the postal line every email
 * carries. Mirrors web/src/lib/company.ts — change both together.
 */
export const COMPANY = {
  legalName: 'Proyekto Business Services',
  addressLines: ['Level 4, 80 Ann Street', 'Brisbane QLD 4000', 'Australia'],
  email: 'support@proyekto.tech',
} as const;

/** "Level 4, 80 Ann Street, Brisbane QLD 4000, Australia" */
export const COMPANY_ADDRESS = COMPANY.addressLines.join(', ');
