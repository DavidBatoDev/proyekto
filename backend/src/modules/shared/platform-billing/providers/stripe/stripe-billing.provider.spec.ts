import {
  STRIPE_PRORATION,
  StripeBillingProvider,
  translateStripeEvent,
} from './stripe-billing.provider';

const CONFIG: Record<string, string> = {
  STRIPE_WEBHOOK_SECRET: 'whsec_test',
  STRIPE_PRICE_PRO_MONTHLY: 'price_pro_month',
  STRIPE_PRICE_PRO_YEARLY: 'price_pro_year',
  STRIPE_PRICE_BUSINESS_MONTHLY: 'price_business_month',
  STRIPE_PRICE_BUSINESS_YEARLY: 'price_business_year',
};

function buildStripeSubscription(status = 'active') {
  return {
    id: 'sub_1',
    status,
    customer: 'cus_1',
    cancel_at_period_end: false,
    canceled_at: null,
    trial_end: null,
    metadata: { workspace_id: 'ws-1' },
    items: {
      data: [
        {
          id: 'si_1',
          quantity: 3,
          price: { id: 'price_pro_year' },
          current_period_start: 1_760_000_000,
          current_period_end: 1_762_000_000,
        },
      ],
    },
  };
}

function buildStripe() {
  return {
    customers: { create: jest.fn().mockResolvedValue({ id: 'cus_new' }) },
    checkout: {
      sessions: {
        create: jest
          .fn()
          .mockResolvedValue({ url: 'https://checkout.stripe.test/cs_1' }),
      },
    },
    billingPortal: {
      sessions: {
        create: jest
          .fn()
          .mockResolvedValue({ url: 'https://billing.stripe.test/p_1' }),
      },
    },
    subscriptions: {
      retrieve: jest.fn().mockResolvedValue(buildStripeSubscription()),
      cancel: jest.fn().mockResolvedValue({}),
    },
    subscriptionItems: { update: jest.fn().mockResolvedValue({}) },
    invoices: { createPreview: jest.fn() },
    webhooks: { constructEvent: jest.fn() },
  };
}

function buildProvider() {
  const stripe = buildStripe();
  const config = { get: (key: string) => CONFIG[key] };
  return {
    stripe,
    provider: new StripeBillingProvider(stripe as never, config as never),
  };
}

function stripeEvent(type: string, object: Record<string, unknown>) {
  return {
    id: 'evt_1',
    type,
    api_version: '2026-08-26.dahlia',
    created: 1_760_000_000,
    data: { object },
  } as never;
}

describe('StripeBillingProvider — seat proration', () => {
  /**
   * How the neutral Linear policy is spelled in Stripe. Each row is a promise
   * made in user-facing copy, so a change here changes what customers were
   * told: in particular credit_next_invoice must never become
   * 'always_invoice', which on a decrease refunds the card.
   */
  it('maps the neutral policy onto Stripe proration_behavior', () => {
    expect(STRIPE_PRORATION).toEqual({
      next_invoice: 'none',
      charge_now: 'always_invoice',
      credit_next_invoice: 'create_prorations',
    });
  });

  it.each(Object.entries(STRIPE_PRORATION))(
    'sends %s as %s on the seat item',
    async (proration, behaviour) => {
      const { provider, stripe } = buildProvider();

      await provider.updateSeatQuantity({
        subscriptionId: 'sub_1',
        seatItemId: 'si_1',
        quantity: 6,
        proration: proration as keyof typeof STRIPE_PRORATION,
      });

      expect(stripe.subscriptionItems.update).toHaveBeenCalledWith(
        'si_1',
        { quantity: 6, proration_behavior: behaviour },
        { idempotencyKey: 'seat-sync:si_1:6' },
      );
    },
  );

  it('keys idempotency on the target quantity, so a double-fire cannot double-prorate', async () => {
    const { provider, stripe } = buildProvider();
    const input = {
      subscriptionId: 'sub_1',
      seatItemId: 'si_1',
      quantity: 6,
      proration: 'charge_now' as const,
    };

    await provider.updateSeatQuantity(input);
    await provider.updateSeatQuantity(input);

    const [first, second] = stripe.subscriptionItems.update.mock.calls;
    expect(first[2]).toEqual(second[2]);
  });

  it('refuses to update without a seat item rather than guessing one', async () => {
    const { provider } = buildProvider();

    await expect(
      provider.updateSeatQuantity({
        subscriptionId: 'sub_1',
        seatItemId: null,
        quantity: 6,
        proration: 'next_invoice',
      }),
    ).rejects.toThrow(/no seat item/);
  });
});

describe('StripeBillingProvider — subscription reads', () => {
  it('translates a subscription into the neutral shape', async () => {
    const { provider } = buildProvider();

    expect(await provider.getSubscription('sub_1')).toEqual({
      id: 'sub_1',
      customerId: 'cus_1',
      status: 'active',
      seatItemId: 'si_1',
      priceId: 'price_pro_year',
      quantity: 3,
      currentPeriodStart: new Date(1_760_000_000_000).toISOString(),
      currentPeriodEnd: new Date(1_762_000_000_000).toISOString(),
      cancelAtPeriodEnd: false,
      canceledAt: null,
      trialEnd: null,
      workspaceId: 'ws-1',
    });
  });

  it('reports a status outside the normalized vocabulary as null', async () => {
    const { provider, stripe } = buildProvider();
    stripe.subscriptions.retrieve.mockResolvedValue(
      buildStripeSubscription('some_future_status'),
    );

    expect((await provider.getSubscription('sub_1')).status).toBeNull();
  });

  it('resolves prices from the STRIPE_ env prefix', () => {
    const { provider } = buildProvider();
    expect(provider.resolvePriceId('pro', 'year')).toBe('price_pro_year');
    expect(provider.resolvePlanForPrice('price_business_month')).toEqual({
      plan: 'business',
      interval: 'month',
    });
  });
});

describe('StripeBillingProvider — checkout', () => {
  const input = {
    workspaceId: 'ws-1',
    workspaceName: 'Acme',
    workspaceSlug: 'acme',
    existingCustomerId: null,
    receiptEmail: 'owner@acme.test',
    priceId: 'price_pro_month',
    quantity: 4,
    successUrl: 'https://app.test/ok',
    cancelUrl: 'https://app.test/no',
  };

  it('creates one customer per workspace, idempotently, and reports it', async () => {
    const { provider, stripe } = buildProvider();

    const result = await provider.createCheckout(input);

    expect(stripe.customers.create).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ workspace_id: 'ws-1' }),
      }),
      { idempotencyKey: 'workspace-customer:ws-1' },
    );
    expect(result).toEqual({
      url: 'https://checkout.stripe.test/cs_1',
      customerId: 'cus_new',
    });
  });

  it('reuses an existing customer and locks the seat quantity', async () => {
    const { provider, stripe } = buildProvider();

    await provider.createCheckout({ ...input, existingCustomerId: 'cus_1' });

    expect(stripe.customers.create).not.toHaveBeenCalled();
    expect(stripe.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: 'cus_1',
        client_reference_id: 'ws-1',
        subscription_data: { metadata: { workspace_id: 'ws-1' } },
        line_items: [
          {
            price: 'price_pro_month',
            quantity: 4,
            adjustable_quantity: { enabled: false },
          },
        ],
      }),
    );
  });
});

describe('translateStripeEvent', () => {
  it('reads a checkout completion into checkout_completed', () => {
    const event = translateStripeEvent(
      stripeEvent('checkout.session.completed', {
        id: 'cs_1',
        client_reference_id: 'ws-1',
        subscription: 'sub_1',
        customer: 'cus_1',
      }),
    );
    expect(event.meaning).toEqual({
      kind: 'checkout_completed',
      workspaceId: 'ws-1',
      subscriptionId: 'sub_1',
      customerId: 'cus_1',
    });
    expect(event.id).toBe('evt_1');
    expect(event.createdAt).toBe(new Date(1_760_000_000_000).toISOString());
  });

  it.each([
    'customer.subscription.created',
    'customer.subscription.updated',
    'customer.subscription.trial_will_end',
  ])('reads %s as subscription_changed', (type) => {
    expect(
      translateStripeEvent(stripeEvent(type, { id: 'sub_1' })).meaning,
    ).toEqual({ kind: 'subscription_changed', subscriptionId: 'sub_1' });
  });

  it('reads a deletion as subscription_ended', () => {
    expect(
      translateStripeEvent(
        stripeEvent('customer.subscription.deleted', {
          id: 'sub_1',
          canceled_at: 1_760_000_000,
        }),
      ).meaning,
    ).toEqual({
      kind: 'subscription_ended',
      subscriptionId: 'sub_1',
      canceledAt: new Date(1_760_000_000_000).toISOString(),
    });
  });

  it('reads a failed invoice as payment_failed with its amount', () => {
    const event = translateStripeEvent(
      stripeEvent('invoice.payment_failed', {
        id: 'in_1',
        customer: 'cus_1',
        subscription: 'sub_1',
        amount_due: 1200,
        currency: 'usd',
        hosted_invoice_url: 'https://invoice.test/in_1',
      }),
    );
    expect(event.meaning).toEqual({
      kind: 'payment_failed',
      customerId: 'cus_1',
      subscriptionId: 'sub_1',
      amountDueCents: 1200,
      currency: 'usd',
      invoiceUrl: 'https://invoice.test/in_1',
    });
  });

  it('marks an event type it does not act on as unhandled', () => {
    expect(
      translateStripeEvent(stripeEvent('customer.created', {})).meaning,
    ).toEqual({ kind: 'unhandled' });
  });
});

describe('StripeBillingProvider.verifyWebhook', () => {
  it('rejects a request with no raw body rather than trusting it', () => {
    // A missing raw body means the bootstrap regressed. Silently accepting an
    // unverifiable payload would remove this endpoint's only authentication.
    const { provider } = buildProvider();

    expect(() =>
      provider.verifyWebhook(undefined, { 'stripe-signature': 'sig' }),
    ).toThrow(/Raw request body unavailable/);
  });

  it('rejects a request with no signature header', () => {
    const { provider } = buildProvider();

    expect(() => provider.verifyWebhook(Buffer.from('{}'), {})).toThrow(
      /Missing stripe-signature/,
    );
  });

  it('rejects a payload whose signature does not verify', () => {
    const { provider, stripe } = buildProvider();
    stripe.webhooks.constructEvent.mockImplementation(() => {
      throw new Error('no signatures found matching the expected signature');
    });

    expect(() =>
      provider.verifyWebhook(Buffer.from('{}'), { 'stripe-signature': 'bad' }),
    ).toThrow(/signature verification failed/i);
  });

  it('translates a verified event', () => {
    const { provider, stripe } = buildProvider();
    stripe.webhooks.constructEvent.mockReturnValue(
      stripeEvent('customer.subscription.updated', { id: 'sub_1' }),
    );

    expect(
      provider.verifyWebhook(Buffer.from('{}'), { 'stripe-signature': 'ok' })
        .meaning,
    ).toEqual({ kind: 'subscription_changed', subscriptionId: 'sub_1' });
  });
});
