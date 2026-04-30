import { HttpClient } from '../lib/http-client';
import { wrapError } from './auth/helpers';
import type { InsForgeError } from '../types';
import type {
  CreateCheckoutSessionRequest,
  CreateCheckoutSessionResponse,
  CreateCustomerPortalSessionRequest,
  CreateCustomerPortalSessionResponse,
} from '@insforge/shared-schemas';

export type {
  BillingSubject,
  CheckoutMode,
  CheckoutSession,
  CheckoutSessionPaymentStatus,
  CheckoutSessionStatus,
  CreateCheckoutSessionLineItem,
  CreateCheckoutSessionRequest,
  CreateCheckoutSessionResponse,
  CreateCustomerPortalSessionRequest,
  CreateCustomerPortalSessionResponse,
  CustomerPortalSession,
  CustomerPortalSessionStatus,
  StripeEnvironment,
} from '@insforge/shared-schemas';

export interface PaymentsResponse<T> {
  data: T | null;
  error: InsForgeError | null;
}

/**
 * Payments client for runtime Stripe payment flows.
 *
 * These methods are safe to call from generated app frontends with the current
 * user token or anon key. Admin-only Stripe key/catalog APIs are intentionally
 * not exposed here.
 */
export class Payments {
  constructor(private http: HttpClient) {}

  /**
   * Create a Stripe Checkout Session through the InsForge backend.
   *
   * @example
   * ```typescript
   * const { data, error } = await client.payments.createCheckoutSession({
   *   environment: 'test',
   *   mode: 'payment',
   *   lineItems: [{ stripePriceId: 'price_123', quantity: 1 }],
   *   successUrl: `${window.location.origin}/success`,
   *   cancelUrl: `${window.location.origin}/pricing`
   * });
   *
   * if (!error && data.checkoutSession.url) {
   *   window.location.assign(data.checkoutSession.url);
   * }
   * ```
   */
  async createCheckoutSession(
    request: CreateCheckoutSessionRequest,
  ): Promise<PaymentsResponse<CreateCheckoutSessionResponse>> {
    try {
      const data = await this.http.post<CreateCheckoutSessionResponse>(
        '/api/payments/checkout-sessions',
        request,
        { idempotent: !!request.idempotencyKey },
      );

      return { data, error: null };
    } catch (error) {
      return wrapError<CreateCheckoutSessionResponse>(
        error,
        'Checkout session creation failed',
      );
    }
  }

  /**
   * Create a Stripe Billing Portal Session for a mapped billing subject.
   */
  async createCustomerPortalSession(
    request: CreateCustomerPortalSessionRequest,
  ): Promise<PaymentsResponse<CreateCustomerPortalSessionResponse>> {
    try {
      const data = await this.http.post<CreateCustomerPortalSessionResponse>(
        '/api/payments/customer-portal-sessions',
        request,
      );

      return { data, error: null };
    } catch (error) {
      return wrapError<CreateCustomerPortalSessionResponse>(
        error,
        'Customer portal session creation failed',
      );
    }
  }
}
