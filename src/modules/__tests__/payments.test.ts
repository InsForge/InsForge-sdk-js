import { describe, it, expect, vi } from 'vitest';
import { HttpClient } from '../../lib/http-client';
import { TokenManager } from '../../lib/token-manager';
import { Payments } from '../payments';
import { InsForgeError } from '../../types';

function makeTokenManager(): TokenManager {
  return {
    saveSession: vi.fn(),
    clearSession: vi.fn(),
    getSession: vi.fn().mockReturnValue(null),
    getAccessToken: vi.fn().mockReturnValue(null),
  } as unknown as TokenManager;
}

function makeHttp(fetchFn: ReturnType<typeof vi.fn>) {
  return new HttpClient(
    {
      baseUrl: 'http://localhost:7130',
      fetch: fetchFn as any,
      retryCount: 0,
      timeout: 0,
      anonKey: 'anon-key',
    },
    makeTokenManager(),
  );
}

function jsonRes(status: number, body: unknown, statusText = 'OK'): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText,
    headers: { 'content-type': 'application/json' },
  });
}

function checkoutResponse(url = 'https://checkout.stripe.com/c/session_123') {
  return {
    checkoutSession: {
      id: 'local_checkout_123',
      environment: 'test',
      mode: 'payment',
      status: 'open',
      paymentStatus: 'unpaid',
      subjectType: null,
      subjectId: null,
      customerEmail: null,
      stripeCheckoutSessionId: 'cs_test_123',
      stripeCustomerId: null,
      stripePaymentIntentId: null,
      stripeSubscriptionId: null,
      url,
      lastError: null,
      createdAt: '2026-04-30T00:00:00.000Z',
      updatedAt: '2026-04-30T00:00:00.000Z',
    },
  };
}

function customerPortalResponse(url: string | null = 'https://billing.stripe.com/p/session_123') {
  return {
    customerPortalSession: {
      id: 'local_portal_123',
      environment: 'test',
      status: 'created',
      subjectType: 'team',
      subjectId: 'team_123',
      stripeCustomerId: 'cus_123',
      returnUrl: 'https://app.example.com/account',
      configuration: null,
      url,
      lastError: null,
      createdAt: '2026-04-30T00:00:00.000Z',
      updatedAt: '2026-04-30T00:00:00.000Z',
    },
  };
}

describe('Payments', () => {
  it('creates a checkout session through the payments runtime route', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonRes(201, checkoutResponse()));
    const payments = new Payments(makeHttp(fetchFn));

    const result = await payments.createCheckoutSession({
      environment: 'test',
      mode: 'payment',
      lineItems: [{ stripePriceId: 'price_123', quantity: 1 }],
      successUrl: 'https://app.example.com/success',
      cancelUrl: 'https://app.example.com/pricing',
      idempotencyKey: 'cart_123',
    });

    expect(result.error).toBeNull();
    expect(result.data?.checkoutSession.stripeCheckoutSessionId).toBe('cs_test_123');
    expect(fetchFn).toHaveBeenCalledOnce();

    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:7130/api/payments/checkout-sessions');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toMatchObject({
      environment: 'test',
      mode: 'payment',
      idempotencyKey: 'cart_123',
    });
  });

  it('surfaces checkout API errors as InsForgeError values', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(jsonRes(400, { error: 'INVALID_INPUT', message: 'Bad checkout' }, 'Bad'));
    const payments = new Payments(makeHttp(fetchFn));

    const result = await payments.createCheckoutSession({
      environment: 'test',
      mode: 'payment',
      lineItems: [{ stripePriceId: 'price_123', quantity: 1 }],
      successUrl: 'https://app.example.com/success',
      cancelUrl: 'https://app.example.com/pricing',
    });

    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(InsForgeError);
    expect(result.error?.error).toBe('INVALID_INPUT');
    expect(result.error?.message).toBe('Bad checkout');
  });

  it('creates a customer portal session through the payments runtime route', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonRes(201, customerPortalResponse()));
    const payments = new Payments(makeHttp(fetchFn));

    const result = await payments.createCustomerPortalSession({
      environment: 'test',
      subject: { type: 'team', id: 'team_123' },
      returnUrl: 'https://app.example.com/account',
    });

    expect(result.error).toBeNull();
    expect(result.data?.customerPortalSession.url).toBe(
      'https://billing.stripe.com/p/session_123',
    );
    expect(fetchFn).toHaveBeenCalledOnce();

    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:7130/api/payments/customer-portal-sessions');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toMatchObject({
      environment: 'test',
      subject: { type: 'team', id: 'team_123' },
    });
  });

});
