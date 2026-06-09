import { HttpClient } from "../lib/http-client";
import { wrapError } from "./auth/helpers";
import type { InsForgeError } from "../types";
import type { cancelRazorpaySubscriptionBodySchema } from "@insforge/shared-schemas";
import type {
  CancelRazorpaySubscriptionResponse,
  CreateCheckoutSessionBody,
  CreateCheckoutSessionResponse,
  CreateCustomerPortalSessionBody,
  CreateCustomerPortalSessionResponse,
  CreateRazorpayOrderBody,
  CreateRazorpayOrderResponse,
  CreateRazorpaySubscriptionBody,
  CreateRazorpaySubscriptionResponse,
  PauseRazorpaySubscriptionResponse,
  RazorpayEnvironment,
  ResumeRazorpaySubscriptionResponse,
  StripeEnvironment,
  VerifyRazorpayOrderBody,
  VerifyRazorpayOrderResponse,
  VerifyRazorpaySubscriptionBody,
  VerifyRazorpaySubscriptionResponse,
} from "@insforge/shared-schemas";

export type {
  BillingSubject,
  CancelRazorpaySubscriptionBody,
  CancelRazorpaySubscriptionRequest,
  CancelRazorpaySubscriptionResponse,
  CheckoutMode,
  CheckoutSession,
  CheckoutSessionPaymentStatus,
  CheckoutSessionStatus,
  CreateCheckoutSessionBody,
  CreateCheckoutSessionLineItem,
  CreateCheckoutSessionResponse,
  CreateCustomerPortalSessionBody,
  CreateCustomerPortalSessionResponse,
  CreateRazorpayOrderBody,
  CreateRazorpayOrderResponse,
  CreateRazorpaySubscriptionBody,
  CreateRazorpaySubscriptionResponse,
  CustomerPortalSession,
  CustomerPortalSessionStatus,
  PauseRazorpaySubscriptionResponse,
  RazorpayEnvironment,
  RazorpayOrder,
  RazorpayOrderStatus,
  RazorpaySubscription,
  RazorpaySubscriptionStatus,
  ResumeRazorpaySubscriptionResponse,
  StripeEnvironment,
  VerifyRazorpayOrderBody,
  VerifyRazorpayOrderResponse,
  VerifyRazorpaySubscriptionBody,
  VerifyRazorpaySubscriptionResponse,
} from "@insforge/shared-schemas";

export interface PaymentsResponse<T> {
  data: T | null;
  error: InsForgeError | null;
}

type CancelRazorpaySubscriptionBodyInput =
  (typeof cancelRazorpaySubscriptionBodySchema)["_input"];

function providerEnvironmentPath(
  provider: "stripe" | "razorpay",
  environment: string,
): string {
  return `/api/payments/${provider}/${encodeURIComponent(environment)}`;
}

/**
 * Stripe runtime payment flows.
 *
 * These methods are safe to call from generated app frontends with the current
 * user token or anon key. Admin-only Stripe key/catalog APIs are intentionally
 * not exposed here.
 */
export class StripePayments {
  constructor(private http: HttpClient) {}

  /**
   * Create a Stripe Checkout Session through the InsForge backend.
   *
   * @example
   * ```typescript
   * const { data, error } = await client.payments.stripe.createCheckoutSession('test', {
   *   mode: 'payment',
   *   lineItems: [{ priceId: 'price_123', quantity: 1 }],
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
    environment: StripeEnvironment,
    request: CreateCheckoutSessionBody,
  ): Promise<PaymentsResponse<CreateCheckoutSessionResponse>> {
    try {
      const data = await this.http.post<CreateCheckoutSessionResponse>(
        `${providerEnvironmentPath("stripe", environment)}/checkout-sessions`,
        request,
        { idempotent: !!request.idempotencyKey },
      );

      return { data, error: null };
    } catch (error) {
      return wrapError<CreateCheckoutSessionResponse>(
        error,
        "Stripe checkout session creation failed",
      );
    }
  }

  /**
   * Create a Stripe Billing Portal Session for a mapped billing subject.
   */
  async createCustomerPortalSession(
    environment: StripeEnvironment,
    request: CreateCustomerPortalSessionBody,
  ): Promise<PaymentsResponse<CreateCustomerPortalSessionResponse>> {
    try {
      const data = await this.http.post<CreateCustomerPortalSessionResponse>(
        `${providerEnvironmentPath("stripe", environment)}/customer-portal-sessions`,
        request,
      );

      return { data, error: null };
    } catch (error) {
      return wrapError<CreateCustomerPortalSessionResponse>(
        error,
        "Stripe customer portal session creation failed",
      );
    }
  }
}

/**
 * Razorpay runtime payment flows.
 *
 * Razorpay Checkout is client-rendered: create an order or subscription here,
 * pass the returned checkoutOptions to Razorpay Checkout.js, then verify the
 * signed payment response with the matching verify method.
 */
export class RazorpayPayments {
  constructor(private http: HttpClient) {}

  async createOrder(
    environment: RazorpayEnvironment,
    request: CreateRazorpayOrderBody,
  ): Promise<PaymentsResponse<CreateRazorpayOrderResponse>> {
    try {
      const data = await this.http.post<CreateRazorpayOrderResponse>(
        `${providerEnvironmentPath("razorpay", environment)}/orders`,
        request,
      );

      return { data, error: null };
    } catch (error) {
      return wrapError<CreateRazorpayOrderResponse>(
        error,
        "Razorpay order creation failed",
      );
    }
  }

  async verifyOrder(
    environment: RazorpayEnvironment,
    request: VerifyRazorpayOrderBody,
  ): Promise<PaymentsResponse<VerifyRazorpayOrderResponse>> {
    try {
      const data = await this.http.post<VerifyRazorpayOrderResponse>(
        `${providerEnvironmentPath("razorpay", environment)}/orders/verify`,
        request,
      );

      return { data, error: null };
    } catch (error) {
      return wrapError<VerifyRazorpayOrderResponse>(
        error,
        "Razorpay order verification failed",
      );
    }
  }

  async createSubscription(
    environment: RazorpayEnvironment,
    request: CreateRazorpaySubscriptionBody,
  ): Promise<PaymentsResponse<CreateRazorpaySubscriptionResponse>> {
    try {
      const data = await this.http.post<CreateRazorpaySubscriptionResponse>(
        `${providerEnvironmentPath("razorpay", environment)}/subscriptions`,
        request,
      );

      return { data, error: null };
    } catch (error) {
      return wrapError<CreateRazorpaySubscriptionResponse>(
        error,
        "Razorpay subscription creation failed",
      );
    }
  }

  async verifySubscription(
    environment: RazorpayEnvironment,
    request: VerifyRazorpaySubscriptionBody,
  ): Promise<PaymentsResponse<VerifyRazorpaySubscriptionResponse>> {
    try {
      const data = await this.http.post<VerifyRazorpaySubscriptionResponse>(
        `${providerEnvironmentPath("razorpay", environment)}/subscriptions/verify`,
        request,
      );

      return { data, error: null };
    } catch (error) {
      return wrapError<VerifyRazorpaySubscriptionResponse>(
        error,
        "Razorpay subscription verification failed",
      );
    }
  }

  async cancelSubscription(
    environment: RazorpayEnvironment,
    subscriptionId: string,
    request: CancelRazorpaySubscriptionBodyInput = {},
  ): Promise<PaymentsResponse<CancelRazorpaySubscriptionResponse>> {
    try {
      const data = await this.http.post<CancelRazorpaySubscriptionResponse>(
        `${providerEnvironmentPath("razorpay", environment)}/subscriptions/${encodeURIComponent(
          subscriptionId,
        )}/cancel`,
        request,
      );

      return { data, error: null };
    } catch (error) {
      return wrapError<CancelRazorpaySubscriptionResponse>(
        error,
        "Razorpay subscription cancellation failed",
      );
    }
  }

  async pauseSubscription(
    environment: RazorpayEnvironment,
    subscriptionId: string,
  ): Promise<PaymentsResponse<PauseRazorpaySubscriptionResponse>> {
    try {
      const data = await this.http.post<PauseRazorpaySubscriptionResponse>(
        `${providerEnvironmentPath("razorpay", environment)}/subscriptions/${encodeURIComponent(
          subscriptionId,
        )}/pause`,
        {},
      );

      return { data, error: null };
    } catch (error) {
      return wrapError<PauseRazorpaySubscriptionResponse>(
        error,
        "Razorpay subscription pause failed",
      );
    }
  }

  async resumeSubscription(
    environment: RazorpayEnvironment,
    subscriptionId: string,
  ): Promise<PaymentsResponse<ResumeRazorpaySubscriptionResponse>> {
    try {
      const data = await this.http.post<ResumeRazorpaySubscriptionResponse>(
        `${providerEnvironmentPath("razorpay", environment)}/subscriptions/${encodeURIComponent(
          subscriptionId,
        )}/resume`,
        {},
      );

      return { data, error: null };
    } catch (error) {
      return wrapError<ResumeRazorpaySubscriptionResponse>(
        error,
        "Razorpay subscription resume failed",
      );
    }
  }
}

/**
 * Provider-scoped payments client.
 */
export class Payments {
  public readonly stripe: StripePayments;
  public readonly razorpay: RazorpayPayments;

  constructor(http: HttpClient) {
    this.stripe = new StripePayments(http);
    this.razorpay = new RazorpayPayments(http);
  }
}
