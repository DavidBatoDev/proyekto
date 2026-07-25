/**
 * Default Service Agreement clauses, seeded onto every new contract and freely
 * editable per contract afterwards. Mirrors the agreement Prodigitality
 * currently drafts by hand in Google Docs, so a generated agreement reads the
 * same as the one the team already sends.
 *
 * `{{provider}}` / `{{client}}` are substituted at render time from the
 * contract's party fields; anything else is literal.
 */

export interface ContractClause {
  key: string;
  title: string;
  body: string;
  position: number;
}

/** A billable service on the contract, reusable as an invoice line item. */
export interface ContractService {
  id: string;
  name: string;
  description?: string;
  unit?: string;
  unit_rate: number;
  position: number;
}

const TEMPLATE: Array<Omit<ContractClause, 'position'>> = [
  {
    key: 'parties',
    title: 'Parties',
    body: 'This Service Agreement is entered into between {{provider}} as the service provider and {{client}} as the client.',
  },
  {
    key: 'scope',
    title: 'Scope of Services',
    body: '{{provider}} will provide the services described in the approved proposal and Statement of Work.',
  },
  {
    key: 'exclusions',
    title: 'Exclusions',
    body: 'The following are excluded unless separately agreed in writing: paid advertising budget, hosting fees, domain fees, email subscription fees, third-party software, premium plugins, photoshoots, video production, legal advice, advanced CRM automation, custom applications, and additional scope outside the approved proposal.',
  },
  {
    key: 'payment_terms',
    title: 'Payment Terms',
    body: 'Fees are payable per the billing schedule set out in this agreement. Work may be paused for delayed payments. Third-party costs and paid advertising budgets are separate from the professional fee.',
  },
  {
    key: 'client_responsibilities',
    title: 'Client Responsibilities',
    body: 'The client shall provide timely access, approvals, business information, credentials, company assets, service descriptions, compliance claims, and any other information required to complete the project.',
  },
  {
    key: 'provider_responsibilities',
    title: 'Service Provider Responsibilities',
    body: '{{provider}} shall provide strategy, recommendations, planning, delivery coordination, project management, and launch support based on the agreed scope.',
  },
  {
    key: 'intellectual_property',
    title: 'Intellectual Property',
    body: 'Upon full payment, final content, approved designs, and project deliverables specifically created for the client shall belong to the client. {{provider}} may retain ownership of internal templates, methods, reusable code libraries, frameworks, and project management processes used to deliver the work.',
  },
  {
    key: 'confidentiality',
    title: 'Confidentiality',
    body: 'Both parties agree to keep confidential business information, client lists, access credentials, pricing, internal documents, and strategic plans private unless disclosure is required by law or approved in writing.',
  },
  {
    key: 'change_requests',
    title: 'Change Requests',
    body: 'Any work outside the approved scope must be submitted as a change request. {{provider}} will assess the impact on cost, timeline, and deliverables before work begins. No out-of-scope work shall be assumed included unless approved in writing.',
  },
  {
    key: 'termination',
    title: 'Termination',
    body: 'Either party may terminate this agreement with written notice. The client remains responsible for payment of completed work, committed third-party costs, and any approved work already in progress. {{provider}} will provide reasonable handover of completed deliverables after outstanding payments are settled.',
  },
  {
    key: 'approval_and_delays',
    title: 'Approval and Delays',
    body: 'Client delays in providing content, feedback, access, or approvals may affect the project timeline. {{provider}} shall not be responsible for delays caused by missing client inputs or third-party platform issues.',
  },
];

/** A fresh, positioned copy of the default clause set. */
export function defaultContractClauses(): ContractClause[] {
  return TEMPLATE.map((clause, index) => ({ ...clause, position: index }));
}

/** Substitutes the party placeholders for rendering. */
export function renderClauseBody(
  body: string,
  parties: { provider?: string | null; client?: string | null },
): string {
  return body
    .replace(
      /\{\{provider\}\}/g,
      parties.provider?.trim() || 'the service provider',
    )
    .replace(/\{\{client\}\}/g, parties.client?.trim() || 'the client');
}
