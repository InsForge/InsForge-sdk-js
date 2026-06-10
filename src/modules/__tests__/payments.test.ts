import { describe, it, expect, vi } from "vitest";
import { HttpClient } from "../../lib/http-client";
import { TokenManager } from "../../lib/token-manager";
import { Payments } from "../payments";
import { InsForgeError } from "../../types";

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
      baseUrl: "http://localhost:7130",
      fetch: fetchFn as any,
      retryCount: 0,
      timeout: 0,
      anonKey: "anon-key",
    },
    makeTokenManager(),
  );
}

function jsonRes(status: number, body: unknown, statusText = "OK"): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText,
    headers: { "content-type": "application/json" },
  });
}

function checkoutResponse(url = "https://checkout.stripe.com/c/session_123") {
  return {
    checkoutSession: {
      id: "local_checkout_123",
      environment: "test",
      mode: "payment",
      status: "open",
      paymentStatus: "unpaid",
      subjectType: null,
      subjectId: null,
      customerEmail: null,
      checkoutSessionId: "cs_test_123",
      customerId: null,
      paymentIntentId: null,
      subscriptionId: null,
      url,
      lastError: null,
      createdAt: "2026-04-30T00:00:00.000Z",
      updatedAt: "2026-04-30T00:00:00.000Z",
    },
  };
}

function customerPortalResponse(
  url: string | null = "https://billing.stripe.com/p/session_123",
) {
  return {
    customerPortalSession: {
      id: "local_portal_123",
      environment: "test",
      status: "created",
      subjectType: "team",
      subjectId: "team_123",
      customerId: "cus_123",
      returnUrl: "https://app.example.com/account",
      configuration: null,
      url,
      lastError: null,
      createdAt: "2026-04-30T00:00:00.000Z",
      updatedAt: "2026-04-30T00:00:00.000Z",
    },
  };
}

function razorpayOrderResponse() {
  return {
    order: {
      id: "local_order_123",
      environment: "test",
      status: "created",
      subjectType: "team",
      subjectId: "team_123",
      customerName: "Ada",
      customerEmail: "ada@example.com",
      customerContact: null,
      orderId: "order_123",
      receipt: "receipt_123",
      amount: 200000,
      amountPaid: 0,
      amountDue: 200000,
      currency: "INR",
      attempts: 0,
      verifiedPaymentId: null,
      verifiedAt: null,
      notes: {},
      lastError: null,
      createdAt: "2026-04-30T00:00:00.000Z",
      updatedAt: "2026-04-30T00:00:00.000Z",
    },
    checkoutOptions: {
      key: "rzp_test_123",
      amount: 200000,
      currency: "INR",
      order_id: "order_123",
      name: null,
      description: null,
      prefill: {
        name: "Ada",
        email: "ada@example.com",
        contact: null,
      },
      callback_url: null,
    },
  };
}

function razorpaySubscriptionResponse(status = "created") {
  return {
    subscription: {
      id: "local_subscription_123",
      environment: "test",
      subscriptionId: "sub_123",
      planId: "plan_123",
      customerId: null,
      subjectType: "team",
      subjectId: "team_123",
      status,
      quantity: 1,
      totalCount: 12,
      paidCount: 0,
      remainingCount: 12,
      currentStart: null,
      currentEnd: null,
      endedAt: null,
      chargeAt: null,
      startAt: null,
      endAt: null,
      authAttempts: 0,
      expireBy: null,
      customerNotify: true,
      offerId: null,
      shortUrl: "https://rzp.io/i/sub_123",
      hasScheduledChanges: false,
      changeScheduledAt: null,
      authorizationPaymentId: null,
      notes: {},
      providerCreatedAt: "2026-04-30T00:00:00.000Z",
      syncedAt: "2026-04-30T00:00:00.000Z",
      createdAt: "2026-04-30T00:00:00.000Z",
      updatedAt: "2026-04-30T00:00:00.000Z",
    },
    checkoutOptions: {
      key: "rzp_test_123",
      amount: undefined,
      currency: undefined,
      subscription_id: "sub_123",
      name: null,
      description: null,
      prefill: {
        name: "Ada",
        email: "ada@example.com",
        contact: null,
      },
      callback_url: null,
    },
  };
}

describe("Payments", () => {
  it("exposes provider-scoped payments clients", () => {
    const payments = new Payments(makeHttp(vi.fn()));

    expect(payments.stripe).toBeDefined();
    expect(payments.razorpay).toBeDefined();
    expect("createCheckoutSession" in payments).toBe(false);
  });

  it("creates a Stripe checkout session through the provider-scoped runtime route", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonRes(201, checkoutResponse()));
    const payments = new Payments(makeHttp(fetchFn));

    const result = await payments.stripe.createCheckoutSession("test", {
      mode: "payment",
      lineItems: [{ priceId: "price_123", quantity: 1 }],
      successUrl: "https://app.example.com/success",
      cancelUrl: "https://app.example.com/pricing",
      idempotencyKey: "cart_123",
    });

    expect(result.error).toBeNull();
    expect(result.data?.checkoutSession.checkoutSessionId).toBe("cs_test_123");
    expect(fetchFn).toHaveBeenCalledOnce();

    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "http://localhost:7130/api/payments/stripe/test/checkout-sessions",
    );
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toMatchObject({
      mode: "payment",
      idempotencyKey: "cart_123",
    });
    expect(JSON.parse(init.body as string)).not.toHaveProperty("environment");
  });

  it("surfaces Stripe checkout API errors as InsForgeError values", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(
        jsonRes(
          400,
          { error: "INVALID_INPUT", message: "Bad checkout" },
          "Bad",
        ),
      );
    const payments = new Payments(makeHttp(fetchFn));

    const result = await payments.stripe.createCheckoutSession("test", {
      mode: "payment",
      lineItems: [{ priceId: "price_123", quantity: 1 }],
      successUrl: "https://app.example.com/success",
      cancelUrl: "https://app.example.com/pricing",
    });

    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(InsForgeError);
    expect(result.error?.error).toBe("INVALID_INPUT");
    expect(result.error?.message).toBe("Bad checkout");
  });

  it("creates a Stripe customer portal session through the provider-scoped runtime route", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(jsonRes(201, customerPortalResponse()));
    const payments = new Payments(makeHttp(fetchFn));

    const result = await payments.stripe.createCustomerPortalSession("test", {
      subject: { type: "team", id: "team_123" },
      returnUrl: "https://app.example.com/account",
    });

    expect(result.error).toBeNull();
    expect(result.data?.customerPortalSession.url).toBe(
      "https://billing.stripe.com/p/session_123",
    );
    expect(fetchFn).toHaveBeenCalledOnce();

    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "http://localhost:7130/api/payments/stripe/test/customer-portal-sessions",
    );
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toMatchObject({
      subject: { type: "team", id: "team_123" },
    });
    expect(JSON.parse(init.body as string)).not.toHaveProperty("environment");
  });

  it("creates a Razorpay order and returns Checkout.js options", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(jsonRes(201, razorpayOrderResponse()));
    const payments = new Payments(makeHttp(fetchFn));

    const result = await payments.razorpay.createOrder("test", {
      amount: 200000,
      currency: "INR",
      receipt: "receipt_123",
      subject: { type: "team", id: "team_123" },
      customerName: "Ada",
      customerEmail: "ada@example.com",
      notes: { order_id: "order_123" },
    });

    expect(result.error).toBeNull();
    expect(result.data?.order.orderId).toBe("order_123");
    expect(result.data?.checkoutOptions.order_id).toBe("order_123");
    expect(result.data?.checkoutOptions.key).toBe("rzp_test_123");
    expect(result.data?.checkoutOptions.callback_url).toBeNull();

    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:7130/api/payments/razorpay/test/orders");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toMatchObject({
      amount: 200000,
      currency: "INR",
      subject: { type: "team", id: "team_123" },
      notes: { order_id: "order_123" },
    });
    expect(JSON.parse(init.body as string)).not.toHaveProperty("environment");
  });

  it("verifies a Razorpay order payment signature", async () => {
    const response = {
      verified: true,
      order: razorpayOrderResponse().order,
    };
    const fetchFn = vi.fn().mockResolvedValue(jsonRes(200, response));
    const payments = new Payments(makeHttp(fetchFn));

    const result = await payments.razorpay.verifyOrder("test", {
      orderId: "order_123",
      paymentId: "pay_123",
      signature: "sig_123",
    });

    expect(result.error).toBeNull();
    expect(result.data?.verified).toBe(true);

    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "http://localhost:7130/api/payments/razorpay/test/orders/verify",
    );
    expect(JSON.parse(init.body as string)).toEqual({
      orderId: "order_123",
      paymentId: "pay_123",
      signature: "sig_123",
    });
  });

  it("creates and verifies a Razorpay subscription", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonRes(201, razorpaySubscriptionResponse()))
      .mockResolvedValueOnce(
        jsonRes(200, {
          verified: true,
          subscription: razorpaySubscriptionResponse("active").subscription,
        }),
      );
    const payments = new Payments(makeHttp(fetchFn));

    const created = await payments.razorpay.createSubscription("test", {
      planId: "plan_123",
      totalCount: 12,
      subject: { type: "team", id: "team_123" },
      customerNotify: true,
      customerName: "Ada",
      customerEmail: "ada@example.com",
      notes: { order_id: "order_123" },
    });
    const verified = await payments.razorpay.verifySubscription("test", {
      subscriptionId: "sub_123",
      paymentId: "pay_123",
      signature: "sig_123",
    });

    expect(created.error).toBeNull();
    expect(created.data?.checkoutOptions.subscription_id).toBe("sub_123");
    expect(created.data?.checkoutOptions.key).toBe("rzp_test_123");
    expect(created.data?.checkoutOptions.callback_url).toBeNull();
    expect(verified.error).toBeNull();
    expect(verified.data?.verified).toBe(true);

    expect(fetchFn.mock.calls[0][0]).toBe(
      "http://localhost:7130/api/payments/razorpay/test/subscriptions",
    );
    expect(JSON.parse(fetchFn.mock.calls[0][1].body as string)).toMatchObject({
      planId: "plan_123",
      subject: { type: "team", id: "team_123" },
      notes: { order_id: "order_123" },
    });
    expect(fetchFn.mock.calls[1][0]).toBe(
      "http://localhost:7130/api/payments/razorpay/test/subscriptions/verify",
    );
  });

  it("manages Razorpay subscriptions through native lifecycle routes", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        jsonRes(200, {
          subscription: razorpaySubscriptionResponse("cancelled").subscription,
        }),
      )
      .mockResolvedValueOnce(
        jsonRes(200, {
          subscription: razorpaySubscriptionResponse("cancelled").subscription,
        }),
      )
      .mockResolvedValueOnce(
        jsonRes(200, {
          subscription: razorpaySubscriptionResponse("paused").subscription,
        }),
      )
      .mockResolvedValueOnce(
        jsonRes(200, {
          subscription: razorpaySubscriptionResponse("active").subscription,
        }),
      );
    const payments = new Payments(makeHttp(fetchFn));

    await payments.razorpay.cancelSubscription("test", "sub_123");
    await payments.razorpay.cancelSubscription("test", "sub_123", {
      cancelAtCycleEnd: true,
    });
    await payments.razorpay.pauseSubscription("test", "sub_123");
    await payments.razorpay.resumeSubscription("test", "sub_123");

    expect(fetchFn.mock.calls[0][0]).toBe(
      "http://localhost:7130/api/payments/razorpay/test/subscriptions/sub_123/cancel",
    );
    expect(JSON.parse(fetchFn.mock.calls[0][1].body as string)).toEqual({});
    expect(fetchFn.mock.calls[1][0]).toBe(
      "http://localhost:7130/api/payments/razorpay/test/subscriptions/sub_123/cancel",
    );
    expect(JSON.parse(fetchFn.mock.calls[1][1].body as string)).toEqual({
      cancelAtCycleEnd: true,
    });
    expect(fetchFn.mock.calls[2][0]).toBe(
      "http://localhost:7130/api/payments/razorpay/test/subscriptions/sub_123/pause",
    );
    expect(fetchFn.mock.calls[3][0]).toBe(
      "http://localhost:7130/api/payments/razorpay/test/subscriptions/sub_123/resume",
    );
  });

  it.each([
    {
      method: "createOrder",
      fallbackMessage: "Razorpay order creation failed",
      call: (payments: Payments) =>
        payments.razorpay.createOrder("test", {
          amount: 200000,
          currency: "INR",
        }),
    },
    {
      method: "verifyOrder",
      fallbackMessage: "Razorpay order verification failed",
      call: (payments: Payments) =>
        payments.razorpay.verifyOrder("test", {
          orderId: "order_123",
          paymentId: "pay_123",
          signature: "sig_123",
        }),
    },
    {
      method: "createSubscription",
      fallbackMessage: "Razorpay subscription creation failed",
      call: (payments: Payments) =>
        payments.razorpay.createSubscription("test", {
          planId: "plan_123",
          totalCount: 12,
        }),
    },
    {
      method: "verifySubscription",
      fallbackMessage: "Razorpay subscription verification failed",
      call: (payments: Payments) =>
        payments.razorpay.verifySubscription("test", {
          subscriptionId: "sub_123",
          paymentId: "pay_123",
          signature: "sig_123",
        }),
    },
    {
      method: "cancelSubscription",
      fallbackMessage: "Razorpay subscription cancellation failed",
      call: (payments: Payments) =>
        payments.razorpay.cancelSubscription("test", "sub_123"),
    },
    {
      method: "pauseSubscription",
      fallbackMessage: "Razorpay subscription pause failed",
      call: (payments: Payments) =>
        payments.razorpay.pauseSubscription("test", "sub_123"),
    },
    {
      method: "resumeSubscription",
      fallbackMessage: "Razorpay subscription resume failed",
      call: (payments: Payments) =>
        payments.razorpay.resumeSubscription("test", "sub_123"),
    },
  ])(
    "surfaces $method unexpected errors as InsForgeError values",
    async ({ call, fallbackMessage }) => {
      const post = vi.fn().mockRejectedValue("unexpected failure");
      const payments = new Payments({ post } as unknown as HttpClient);

      const result = await call(payments);

      expect(result.data).toBeNull();
      expect(result.error).toBeInstanceOf(InsForgeError);
      expect(result.error?.error).toBe("UNEXPECTED_ERROR");
      expect(result.error?.statusCode).toBe(500);
      expect(result.error?.message).toBe(fallbackMessage);
    },
  );
});
