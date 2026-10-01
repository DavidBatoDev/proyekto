import { missingForSend, sendBlockedMessage } from './contract-send-readiness';
import { contractFixture } from './contracts.service.test-fixtures';

describe('missingForSend', () => {
  it('is empty for a contract that can be signed', () => {
    expect(missingForSend(contractFixture())).toEqual([]);
    expect(sendBlockedMessage(contractFixture())).toBeNull();
  });

  it('names a missing start date and term', () => {
    const contract = contractFixture({
      service_start_date: null,
      term_count: null,
      service_end_date: null,
      contract_end_date: null,
    });
    expect(missingForSend(contract)).toEqual([
      'the service start date',
      'the term (how long the service runs)',
    ]);
    expect(sendBlockedMessage(contract)).toBe(
      'This contract cannot be sent yet. Add the service start date and the term (how long the service runs), then send it.',
    );
  });

  it('a start date without a term still has no end', () => {
    expect(
      missingForSend(
        contractFixture({ term_unit: null, service_end_date: null }),
      ),
    ).toEqual(['the term (how long the service runs)']);
  });

  it('asks for the amount the billing mode needs', () => {
    expect(
      missingForSend(
        contractFixture({ billing_mode: 'fixed', fixed_fee: null }),
      ),
    ).toEqual(['the fixed contract amount']);
    expect(
      missingForSend(
        contractFixture({
          billing_mode: 'hybrid',
          recurring_fee: null,
          client_hourly_rate: null,
        }),
      ),
    ).toEqual(['the monthly contract rate', 'the hourly contract rate']);
  });
});
