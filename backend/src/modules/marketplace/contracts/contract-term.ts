import {
  addDays,
  addMonthsClamped,
  parseIsoDate,
  toIsoDate,
} from './billing-period';

export type ContractTermUnit = 'month' | 'year';

export interface ContractTermInput {
  serviceStartDate: string;
  termCount: number;
  termUnit: ContractTermUnit;
  /**
   * Wind-down days after the last service day during which the agreement is
   * still in force (handover, final payment). 0 = contract ends with service.
   */
  windDownDays?: number;
}

export interface ContractTerm {
  serviceStartDate: string;
  serviceEndDate: string;
  contractEndDate: string;
}

/**
 * Last service day = start + term − 1 day.
 *
 * A 12-month term starting 2026-08-01 runs through 2027-07-31, not 2027-08-01:
 * the client is buying 12 whole months, so the end date is exclusive-minus-one.
 * Month arithmetic clamps (Jan 31 + 1 month = Feb 28/29), so a term starting on
 * the 31st never rolls into the following month.
 */
export function computeContractTerm(input: ContractTermInput): ContractTerm {
  const { serviceStartDate, termCount, termUnit, windDownDays = 0 } = input;
  if (!Number.isInteger(termCount) || termCount <= 0) {
    throw new Error('Contract term count must be a positive whole number.');
  }
  const start = parseIsoDate(serviceStartDate);
  const months = termUnit === 'year' ? termCount * 12 : termCount;
  const serviceEnd = addDays(addMonthsClamped(start, months), -1);
  const contractEnd =
    windDownDays > 0 ? addDays(serviceEnd, windDownDays) : serviceEnd;

  return {
    serviceStartDate: toIsoDate(start),
    serviceEndDate: toIsoDate(serviceEnd),
    contractEndDate: toIsoDate(contractEnd),
  };
}

/** True when `date` falls inside the contract's service window (inclusive). */
export function isWithinServiceWindow(
  term: Pick<ContractTerm, 'serviceStartDate' | 'serviceEndDate'>,
  date: string,
): boolean {
  const day = date.slice(0, 10);
  return day >= term.serviceStartDate && day <= term.serviceEndDate;
}
