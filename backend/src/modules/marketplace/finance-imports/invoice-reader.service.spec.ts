import { BadGatewayException } from '@nestjs/common';
import type { AgentInternalClient } from '../../../common/agent/agent-internal.client';
import {
  InvoiceReaderService,
  type ReadPaymentFields,
} from './invoice-reader.service';

/**
 * The reader now runs on the agent service (POST /documents/read-json), so
 * these specs stub the agent client rather than fetch/OpenAI.
 */
function buildReader(
  post: jest.Mock = jest.fn(),
  configured = true,
): { reader: InvoiceReaderService; post: jest.Mock } {
  const agent = {
    isConfigured: configured,
    post,
  } as unknown as AgentInternalClient;
  return { reader: new InvoiceReaderService(agent), post };
}

function replyWith(data: unknown) {
  return jest.fn().mockResolvedValue({ data, model: 'gpt-5.6-luna' });
}

const PNG = Buffer.from('not-really-a-png');

describe('InvoiceReaderService.readImage', () => {
  it('reads a PESONet credit, keeping what arrived apart from what was sent', async () => {
    const { reader, post } = buildReader(
      replyWith({
        payment_date: '2026-06-26',
        settled_amount: 158870.12,
        settled_currency: 'php',
        reference: 'SUPPLIER /OCMT/AUD3840,00/',
        original_amount: '3,840.00',
        original_currency: 'AUD',
        sender: null,
        confidence: { payment_date: 0.9, settled_amount: 0.95, sender: 0.8 },
      }),
    );

    const read = (await reader.readImage(
      PNG,
      'image/jpeg',
      'payment_proof',
    )) as ReadPaymentFields;

    expect(read.settled_amount).toEqual({
      value: '158870.12',
      confidence: 0.95,
    });
    expect(read.settled_currency.value).toBe('PHP');
    expect(read.original_amount.value).toBe('3840');
    expect(read.original_currency.value).toBe('AUD');
    expect(read.payment_date.value).toBe('2026-06-26');
    // A null field carries no confidence, whatever the model claimed for it.
    expect(read.sender).toEqual({ value: null, confidence: 0 });

    // The image goes to the agent, not to OpenAI with the backend's key.
    expect(post).toHaveBeenCalledWith(
      '/documents/read-json',
      expect.objectContaining({
        system: expect.stringContaining('bank record'),
        image_data_url: expect.stringMatching(/^data:image\/jpeg;base64,/),
      }),
      expect.any(Object),
    );
  });

  it('blanks anything that does not validate rather than booking a guess', async () => {
    const { reader } = buildReader(
      replyWith({
        payment_date: 'June 26',
        settled_amount: -5,
        settled_currency: 'pesos',
        reference: '   ',
      }),
    );

    const read = (await reader.readImage(
      PNG,
      'image/png',
      'payment_proof',
    )) as ReadPaymentFields;

    expect(read.payment_date.value).toBeNull();
    expect(read.settled_amount.value).toBeNull();
    expect(read.settled_currency.value).toBeNull();
    expect(read.reference.value).toBeNull();
  });

  it('never throws: an agent failure becomes a note', async () => {
    const { reader } = buildReader(
      jest.fn().mockRejectedValue(new BadGatewayException('down')),
    );

    const read = await reader.readImage(PNG, 'image/png', 'invoice');

    expect(read.note).toMatch(/could not be read automatically/);
  });

  it('makes no call for a type or size it cannot take', async () => {
    const { reader, post } = buildReader();

    expect(reader.canReadImage('image/heic', 1024)).toBe(false);
    expect(reader.canReadImage('image/png', 9 * 1024 * 1024)).toBe(false);
    const read = await reader.readImage(PNG, 'image/heic', 'payment_proof');

    expect(read.note).toMatch(/cannot be read automatically/);
    expect(post).not.toHaveBeenCalled();
  });

  it('still imports with no agent configured: the draft is simply blank', async () => {
    const { reader, post } = buildReader(jest.fn(), false);

    const read = await reader.readImage(PNG, 'image/png', 'invoice');

    expect(read.note).toMatch(/unavailable/);
    expect(post).not.toHaveBeenCalled();
  });

  it('sends a PDF text layer as text', async () => {
    const { reader, post } = buildReader(
      replyWith({ number: 'INV-1', total: 10, confidence: { number: 1 } }),
    );

    const read = await reader.read('Invoice INV-1 total 10');

    expect(read.number.value).toBe('INV-1');
    expect(post).toHaveBeenCalledWith(
      '/documents/read-json',
      expect.objectContaining({ text: 'Invoice INV-1 total 10' }),
      expect.any(Object),
    );
  });
});
