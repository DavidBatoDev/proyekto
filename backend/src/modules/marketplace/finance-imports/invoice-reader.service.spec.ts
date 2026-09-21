import { ConfigService } from '@nestjs/config';
import {
  InvoiceReaderService,
  type ReadPaymentFields,
} from './invoice-reader.service';

function buildReader(apiKey: string | undefined = 'sk-test') {
  return new InvoiceReaderService({
    get: jest.fn().mockReturnValue(apiKey),
  } as unknown as ConfigService);
}

function replyWith(content: unknown, ok = true) {
  return jest.spyOn(global, 'fetch').mockResolvedValue({
    ok,
    status: ok ? 200 : 500,
    json: () =>
      Promise.resolve({
        choices: [{ message: { content: JSON.stringify(content) } }],
      }),
  } as Response);
}

const PNG = Buffer.from('not-really-a-png');

afterEach(() => jest.restoreAllMocks());

describe('InvoiceReaderService.readImage', () => {
  it('reads a PESONet credit, keeping what arrived apart from what was sent', async () => {
    const fetchSpy = replyWith({
      payment_date: '2026-06-26',
      settled_amount: 158870.12,
      settled_currency: 'php',
      reference: 'SUPPLIER /OCMT/AUD3840,00/',
      original_amount: '3,840.00',
      original_currency: 'AUD',
      sender: null,
      confidence: { payment_date: 0.9, settled_amount: 0.95, sender: 0.8 },
    });

    const read = (await buildReader().readImage(
      PNG,
      'image/jpeg',
      'payment_proof',
    )) as ReadPaymentFields;

    expect(read.settled_amount).toEqual({ value: '158870.12', confidence: 0.95 });
    expect(read.settled_currency.value).toBe('PHP');
    expect(read.original_amount.value).toBe('3840');
    expect(read.original_currency.value).toBe('AUD');
    expect(read.payment_date.value).toBe('2026-06-26');
    // A null field carries no confidence, whatever the model claimed for it.
    expect(read.sender).toEqual({ value: null, confidence: 0 });

    const body = JSON.parse(
      (fetchSpy.mock.calls[0][1] as RequestInit).body as string,
    ) as { messages: Array<{ content: unknown }> };
    const parts = body.messages[1].content as Array<{
      type: string;
      image_url?: { url: string };
    }>;
    expect(parts[1].image_url?.url).toMatch(/^data:image\/jpeg;base64,/);
  });

  it('blanks anything that does not validate rather than booking a guess', async () => {
    replyWith({
      payment_date: 'June 26',
      settled_amount: -5,
      settled_currency: 'pesos',
      reference: '   ',
    });

    const read = (await buildReader().readImage(
      PNG,
      'image/png',
      'payment_proof',
    )) as ReadPaymentFields;

    expect(read.payment_date.value).toBeNull();
    expect(read.settled_amount.value).toBeNull();
    expect(read.settled_currency.value).toBeNull();
    expect(read.reference.value).toBeNull();
  });

  it('never throws: an upstream failure becomes a note', async () => {
    replyWith({}, false);

    const read = await buildReader().readImage(PNG, 'image/png', 'invoice');

    expect(read.note).toMatch(/could not be read automatically/);
  });

  it('makes no call for a type or size it cannot take', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');
    const reader = buildReader();

    expect(reader.canReadImage('image/heic', 1024)).toBe(false);
    expect(reader.canReadImage('image/png', 9 * 1024 * 1024)).toBe(false);
    const read = await reader.readImage(PNG, 'image/heic', 'payment_proof');

    expect(read.note).toMatch(/cannot be read automatically/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('still imports with no API key: the draft is simply blank', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');

    const read = await buildReader('').readImage(PNG, 'image/png', 'invoice');

    expect(read.note).toMatch(/unavailable/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
