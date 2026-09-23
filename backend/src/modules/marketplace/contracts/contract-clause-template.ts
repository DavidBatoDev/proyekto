/**
 * Default agreement clauses, one set per relationship kind, seeded onto every
 * new contract and freely editable per contract afterwards.
 *
 * - client_services (Client hires Consultant): the Service Agreement
 *   Prodigitality drafts by hand in Google Docs.
 * - talent_services (Consultant hires Talent): the Consulting Agreement
 *   Prodigitality signs with its own consultants. There the hirer seat is
 *   "the Company" and the talent is "the Consultant" — the legal names in that
 *   paper, not Proyekto's roles.
 *
 * Party variables are substituted at render time from the contract's party
 * fields: `{{client}}` is always the HIRER seat's block and `{{provider}}` the
 * PROVIDER seat's, whatever the kind. Figures (rate, currency, dates) live in
 * the Commercial Terms and are referenced rather than repeated, so a clause
 * can never disagree with the terms it sits under.
 */

export interface ContractClause {
  key: string;
  /** Optional parent clause key. Missing/null clauses are top-level sections. */
  parent_key?: string | null;
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

const SERVICE_AGREEMENT: Array<Omit<ContractClause, 'position'>> = [
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

type ClauseDraft = Omit<ContractClause, 'position'>;

const article = (key: string, title: string, body = ''): ClauseDraft => ({
  key,
  title,
  body,
});

const section = (
  parent: string,
  key: string,
  title: string,
  body: string,
): ClauseDraft => ({ key, parent_key: parent, title, body });

/**
 * Transcribed from Prodigitality's signed consulting agreement. The wording is
 * kept; only the parties became variables, and the fixed figures (the hourly
 * rate, the effective date) now point at the Commercial Terms that hold them.
 */
const CONSULTING_AGREEMENT: ClauseDraft[] = [
  article(
    'parties',
    'Parties',
    'This Consulting Agreement is made and entered into by and between {{client}} (the "Company") and {{provider}} (the "Consultant"), effective on the service start date set out in the Commercial Terms.',
  ),
  article('scope_of_work', 'Article 1 — Scope of Work'),
  section(
    'scope_of_work',
    'services',
    '1.1 Services',
    'The Company has engaged the Consultant to provide services in connection with the Company\'s business. The Consultant will provide the services described in this Agreement and such other services as the Company may reasonably request (collectively, the "consulting services").',
  ),
  section(
    'scope_of_work',
    'time_and_availability',
    '1.2 Time and Availability',
    'The Consultant will devote the hours agreed with the Company to performing the services stated herein. The Consultant shall have discretion in selecting the dates and times it performs such consulting services throughout the week, giving due regard to the needs of the Company\'s business.',
  ),
  section(
    'scope_of_work',
    'confidentiality_reliance',
    '1.3 Confidentiality',
    'In order for the Consultant to perform the consulting services, it may be necessary for the Company to provide the Consultant with Confidential Information (as defined below) regarding the Company\'s business and products. The Company will rely heavily upon the Consultant\'s integrity and prudent judgment to use this information only in the best interests of the Company.',
  ),
  section(
    'scope_of_work',
    'standard_of_conduct',
    '1.4 Standard of Conduct',
    'In rendering consulting services under this Agreement, the Consultant shall conform to high professional standards of work and business ethics. The Consultant shall not use time, materials, or equipment of the Company without the prior written consent of the Company. In no event shall the Consultant take any action or accept any assistance or engage in any activity that would result in any university, governmental body, research institute or other person, entity, or organization acquiring any rights of any nature in the results of work performed by or for the Company.',
  ),
  section(
    'scope_of_work',
    'outside_services',
    '1.5 Outside Services',
    'The Consultant shall not use the service of any other person, entity, or organization in the performance of the Consultant\'s duties without the prior written consent of an officer of the Company. Should the Company consent to the use by the Consultant of the services of any other person, entity, or organization, no information regarding the services to be performed under this Agreement shall be disclosed to that person, entity, or organization until such person, entity, or organization has executed an agreement to protect the confidentiality of the Company\'s Confidential Information and the Company\'s absolute and complete ownership of all right, title, and interest in the work performed under this Agreement.',
  ),
  section(
    'scope_of_work',
    'reports',
    '1.6 Reports',
    'The Consultant shall periodically provide the Company with written reports of his or her observations and conclusions regarding the consulting services. Upon the termination of this Agreement, the Consultant shall, upon the request of the Company, prepare a final report of the Consultant\'s activities.',
  ),
  article('independent_contractor', 'Article 2 — Independent Contractor'),
  section(
    'independent_contractor',
    'contractor_status',
    '2.1 Independent Contractor',
    'The Consultant is an independent contractor and is not an employee, partner, or co-venturer of, or in any other service relationship with, the Company. The manner in which the Consultant\'s services are rendered shall be within the Consultant\'s sole control and discretion. The Consultant is not authorized to speak for, represent, or obligate the Company in any manner without the prior express written authorization from an officer of the Company.',
  ),
  section(
    'independent_contractor',
    'benefits',
    '2.2 Benefits',
    'The Consultant and the Consultant\'s employees will not be eligible for, and shall not participate in, any employee pension, health, welfare, or other fringe benefit plan of the Company. No workers\' compensation insurance shall be obtained by the Company covering the Consultant or the Consultant\'s employees.',
  ),
  article('compensation', 'Article 3 — Compensation for Consulting Services'),
  section(
    'compensation',
    'compensation_rate',
    '3.1 Compensation',
    'The Company shall pay the Consultant at the rate set out in the Commercial Terms for services rendered to the Company under this Agreement, on the payment schedule agreed between the parties. Compensation will be given upon presentation of documentation of the total number of hours spent during the period, as recorded and approved in Proyekto.',
  ),
  section(
    'compensation',
    'reimbursement',
    '3.2 Reimbursement',
    'The Company agrees to reimburse the Consultant for all actual reasonable and necessary expenditures which are directly related to the consulting services, including expenses related to travel, telephone calls, and postal expenditures. Expenses incurred by the Consultant will be reimbursed by the Company within 15 days of the Consultant\'s proper written request for reimbursement. All expenditures must be approved prior to incurring them.',
  ),
  article('term_and_termination', 'Article 4 — Term and Termination'),
  section(
    'term_and_termination',
    'term',
    '4.1 Term',
    'This Agreement shall be effective as of the service start date set out in the Commercial Terms and shall continue in full force and effect for the service period stated there, or until further notice. The Company and the Consultant may negotiate to extend the term of this Agreement and the terms and conditions under which the relationship shall continue.',
  ),
  section(
    'term_and_termination',
    'termination_for_cause',
    '4.2 Termination',
    'The Company may terminate this Agreement for "Cause," after giving the Consultant written notice of the reason. Cause means: (1) the Consultant has breached the provisions of Article 5 or 7 of this Agreement in any respect, or materially breached any other provision of this Agreement and the breach continues for 30 days following receipt of a notice from the Company; (2) the Consultant has committed fraud, misappropriation, or embezzlement in connection with the Company\'s business; (3) the Consultant has been convicted of a felony; or (4) the Consultant\'s use of narcotics, liquor, or illicit drugs has a detrimental effect on the performance of his or her responsibilities, as determined by the Company.',
  ),
  section(
    'term_and_termination',
    'responsibility_upon_termination',
    '4.3 Responsibility upon Termination',
    'Any equipment provided by the Company to the Consultant in connection with or furtherance of the Consultant\'s services under this Agreement, including, but not limited to, computers, laptops, and personal management tools, shall, immediately upon the termination of this Agreement, be returned to the Company.',
  ),
  section(
    'term_and_termination',
    'survival',
    '4.4 Survival',
    'The provisions of Articles 5, 6, 7, and 8 of this Agreement shall survive the termination of this Agreement and remain in full force and effect thereafter.',
  ),
  article('confidential_information', 'Article 5 — Confidential Information'),
  section(
    'confidential_information',
    'obligation_of_confidentiality',
    '5.1 Obligation of Confidentiality',
    'In performing consulting services under this Agreement, the Consultant may be exposed to and will be required to use certain Confidential Information of the Company. The Consultant agrees that the Consultant will not, and the Consultant\'s employees, agents, or representatives will not, use, directly or indirectly, such Confidential Information for the benefit of any person, entity, or organization other than the Company, or disclose such Confidential Information without the written authorization of the Company, either during or after the term of this Agreement, for as long as such information retains the characteristics of Confidential Information.',
  ),
  section(
    'confidential_information',
    'definition',
    '5.2 Definition',
    '"Confidential Information" means information not generally known and proprietary to the Company or to a third party for whom the Company is performing work, including, without limitation, information concerning any patents or trade secrets, confidential or secret designs, processes, formulae, source codes, plans, devices or material, research and development, proprietary software, analysis, techniques, materials, or designs (whether or not patented or patentable), directly or indirectly useful in any aspect of the business of the Company, any vendor names, customer and supplier lists, databases, management systems and sales and marketing plans of the Company, any confidential secret development or research work of the Company, or any other confidential information or proprietary aspects of the business of the Company. All information which the Consultant acquires or becomes acquainted with during the period of this Agreement, whether developed by the Consultant or by others, which the Consultant has a reasonable basis to believe to be Confidential Information, or which is treated by the Company as being Confidential Information, shall be presumed to be Confidential Information.',
  ),
  section(
    'confidential_information',
    'property_of_the_company',
    '5.3 Property of the Company',
    'The Consultant agrees that all plans, manuals, and specific materials developed by the Consultant on behalf of the Company in connection with services rendered under this Agreement are and shall remain the exclusive property of the Company. Promptly upon the expiration or termination of this Agreement, or upon the request of the Company, the Consultant shall return to the Company all documents and tangible items, including samples, provided to the Consultant or created by the Consultant for use in connection with services to be rendered hereunder, including, without limitation, all Confidential Information, together with all copies and abstracts thereof.',
  ),
  article(
    'rights_and_data',
    'Article 6 — Rights and Data',
    'All drawings, models, designs, formulas, methods, documents, and tangible items prepared for and submitted to the Company by the Consultant in connection with the services rendered under this Agreement shall belong exclusively to the Company and shall be deemed to be works made for hire (the "Deliverable Items"). To the extent that any of the Deliverable Items may not, by operation of law, be works made for hire, the Consultant hereby assigns to the Company the ownership of copyright or mask work in the Deliverable Items, and the Company shall have the right to obtain and hold in its own name any trademark, copyright, or mask work registration, and any other registrations and similar protection which may be available in the Deliverable Items. The Consultant agrees to give the Company or its designees all assistance reasonably required to perfect such rights.',
  ),
  article(
    'non_solicitation',
    'Article 7 — Conflict of Interest and Non-Solicitation',
    'The Consultant covenants and agrees that during the term of this Agreement, the Consultant will not, directly or indirectly, through an existing corporation, unincorporated business, affiliated party, successor employer, or otherwise, solicit, hire for employment or work with, on a part-time, consulting, advising, or any other basis, other than on behalf of the Company, any employee or independent contractor employed by the Company while the Consultant is performing services for the Company.',
  ),
  article(
    'injunctive_relief',
    'Article 8 — Right to Injunctive Relief',
    'The Consultant acknowledges that the terms of Articles 5, 6, and 7 of this Agreement are reasonably necessary to protect the legitimate interests of the Company, are reasonable in scope and duration, and are not unduly restrictive. The Consultant further acknowledges that a breach of any of the terms of Articles 5, 6, or 7 of this Agreement will render irreparable harm to the Company, that a remedy at law for breach of the Agreement is inadequate, and that the Company shall therefore be entitled to seek any and all equitable relief, including, but not limited to, injunctive relief, and any other remedy that may be available under any applicable law or agreement between the parties. Both damages and injunctive relief shall be proper modes of relief and are not to be considered as alternative remedies.',
  ),
  article('general_provisions', 'Article 9 — General Provisions'),
  section(
    'general_provisions',
    'construction_of_terms',
    '9.1 Construction of Terms',
    'If any provision of this Agreement is held unenforceable by a court of competent jurisdiction, that provision shall be severed and shall not affect the validity or enforceability of the remaining provisions.',
  ),
  section(
    'general_provisions',
    'governing_law',
    '9.2 Governing Law',
    'This Agreement shall be governed by and construed in accordance with the internal laws (and not the laws of conflicts) of the Republic of the Philippines.',
  ),
  section(
    'general_provisions',
    'complete_agreement',
    '9.3 Complete Agreement',
    'This Agreement constitutes the complete agreement and sets forth the entire understanding and agreement of the parties as to the subject matter of this Agreement and supersedes all prior discussions and understandings in respect to the subject of this Agreement, whether written or oral.',
  ),
  section(
    'general_provisions',
    'dispute_resolution',
    '9.4 Dispute Resolution',
    'If there is any dispute or controversy between the parties arising out of or relating to this Agreement, the parties agree that such dispute or controversy will be arbitrated, and such arbitration will be the exclusive dispute resolution method under this Agreement. The decision and award determined by such arbitration will be final and binding upon both parties. All costs and expenses, including reasonable attorney\'s fees and expert\'s fees, of all parties incurred in any dispute that is determined or settled by arbitration will be borne by the party determined to be liable in respect of such dispute; provided, however, that if complete liability is not assessed against only one party, the parties will share the total costs in proportion to their respective amounts of liability so determined. Except where clearly prevented by the area in dispute, both parties agree to continue performing their respective obligations under this Agreement until the dispute is resolved.',
  ),
  section(
    'general_provisions',
    'modification',
    '9.5 Modification',
    'No modification, termination, or attempted waiver of this Agreement, or any provision thereof, shall be valid unless in writing signed by the party against whom the same is sought to be enforced.',
  ),
  section(
    'general_provisions',
    'waiver_of_breach',
    '9.6 Waiver of Breach',
    'The waiver by a party of a breach of any provision of this Agreement by the other party shall not operate or be construed as a waiver of any other or subsequent breach by the party in breach.',
  ),
  section(
    'general_provisions',
    'successors_and_assigns',
    '9.7 Successors and Assigns',
    'This Agreement may not be assigned by either party without the prior written consent of the other party; provided, however, that the Agreement shall be assignable by the Company without the Consultant\'s consent in the event the Company is acquired by or merged into another corporation or business entity. The benefits and obligations of this Agreement shall be binding upon and inure to the parties hereto, their successors and assigns.',
  ),
  section(
    'general_provisions',
    'no_conflict',
    '9.8 No Conflict',
    'The Consultant warrants that the Consultant has not previously assumed any obligations inconsistent with those undertaken by the Consultant under this Agreement.',
  ),
];

export type AgreementKind = 'client_services' | 'talent_services';

const AGREEMENTS: Record<AgreementKind, { title: string; clauses: ClauseDraft[] }> =
  {
    client_services: { title: 'Service Agreement', clauses: SERVICE_AGREEMENT },
    talent_services: {
      title: 'Consulting Agreement',
      clauses: CONSULTING_AGREEMENT,
    },
  };

/**
 * The title a new contract of this kind is issued under. Stored on the
 * contract at creation (`document_title`), so a later template change never
 * retitles a paper someone already signed.
 */
export function agreementTitle(kind: AgreementKind = 'client_services'): string {
  return AGREEMENTS[kind].title;
}

/** A fresh, positioned copy of the default clause set for this kind. */
export function defaultContractClauses(
  kind: AgreementKind = 'client_services',
): ContractClause[] {
  return AGREEMENTS[kind].clauses.map((clause, index) => ({
    ...clause,
    position: index,
  }));
}

/** Substitutes the party placeholders for rendering. */
export function renderClauseBody(
  body: string,
  parties: {
    provider?: string | null;
    client?: string | null;
    providerName?: string | null;
    providerAddress?: string | null;
    providerEmail?: string | null;
    providerTin?: string | null;
    providerKind?: string | null;
    clientName?: string | null;
    clientContactName?: string | null;
    clientAddress?: string | null;
    clientEmail?: string | null;
    clientTin?: string | null;
  },
): string {
  const values: Record<string, string> = {
    '{{provider}}':
      parties.provider?.trim() ||
      parties.providerName?.trim() ||
      'the service provider',
    '{{client}}':
      parties.client?.trim() || parties.clientName?.trim() || 'the client',
    '{{provider_name}}':
      parties.providerName?.trim() ||
      parties.provider?.trim() ||
      'Service Provider',
    '{{provider_address}}':
      parties.providerAddress?.trim() || 'Service provider address',
    '{{provider_email}}':
      parties.providerEmail?.trim() || 'Service provider email',
    '{{provider_tin}}': parties.providerTin?.trim() || 'Service provider TIN',
    '{{provider_kind}}':
      parties.providerKind?.trim() === 'agency'
        ? 'Agency or company'
        : parties.providerKind?.trim() === 'individual'
          ? 'Individual contractor'
          : 'Service provider type',
    '{{client_name}}':
      parties.clientName?.trim() || parties.client?.trim() || 'Client',
    '{{client_contact_name}}':
      parties.clientContactName?.trim() || 'Client contact person',
    '{{client_address}}': parties.clientAddress?.trim() || 'Client address',
    '{{client_email}}': parties.clientEmail?.trim() || 'Client email',
    '{{client_tin}}': parties.clientTin?.trim() || 'Client TIN',
  };
  return Object.entries(values).reduce(
    (rendered, [token, value]) => rendered.replaceAll(token, value),
    body,
  );
}
