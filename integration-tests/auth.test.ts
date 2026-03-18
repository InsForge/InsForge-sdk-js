import { beforeAll, describe, expect, it } from "vitest";
import { InsForgeClient } from "../src/client";

const baseUrl = process.env.INSFORGE_INTEGRATION_BASE_URL;
const anonKey = process.env.INSFORGE_INTEGRATION_ANON_KEY;
const hasIntegrationSecrets = Boolean(baseUrl && anonKey);
const describeIfIntegration = hasIntegrationSecrets ? describe : describe.skip;

const existingEmail = process.env.INSFORGE_INTEGRATION_TEST_EMAIL;
const existingPassword = process.env.INSFORGE_INTEGRATION_TEST_PASSWORD;
const useExistingCredentials = Boolean(existingEmail && existingPassword);
const requireProfileUpdate =
  process.env.INSFORGE_INTEGRATION_REQUIRE_PROFILE_UPDATE === "true";

const generatedEmail = `sdk-int-${Date.now()}-${Math.random()
  .toString(36)
  .slice(2, 10)}@example.com`;
const generatedPassword = `Pwd!${Date.now()}Aa`;

const email = existingEmail || generatedEmail;
const password = existingPassword || generatedPassword;

describeIfIntegration("Auth Module - Integration Tests", () => {
  let client: InsForgeClient;
  let currentUserId = "";

  const sleep = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms));

  const hasActiveSession = async (pollAttempts = 5, pollDelayMs = 250) => {
    for (let i = 0; i < pollAttempts; i += 1) {
      const session = await client.auth.getCurrentSession();
      if (
        !session.error &&
        session.data.session?.accessToken &&
        session.data.session?.user?.id
      ) {
        return true;
      }

      if (i < pollAttempts - 1) {
        await sleep(pollDelayMs);
      }
    }

    return false;
  };

  const signInWithRetry = async (attempts = 3) => {
    let lastErrorMessage = "";

    for (let i = 0; i < attempts; i += 1) {
      const signIn = await client.auth.signInWithPassword({ email, password });
      if (!signIn.error) {
        const sessionReady = await hasActiveSession();
        if (sessionReady) {
          return signIn;
        }

        lastErrorMessage =
          "signIn succeeded but authenticated session was not ready in time";
      } else {
        lastErrorMessage = signIn.error.message || "unknown sign-in error";
      }

      if (i < attempts - 1) {
        await sleep(500);
      }
    }

    throw new Error(
      `signInWithPassword failed after ${attempts} attempts: ${lastErrorMessage}`
    );
  };

  const assertAuthFailureContract = (
    response: Awaited<ReturnType<InsForgeClient["auth"]["signInWithPassword"]>>
  ) => {
    expect(response.data).toBeNull();
    expect(response.error).toBeTruthy();
    expect(response.error?.statusCode).toBeDefined();
    expect([400, 401, 403]).toContain(response.error?.statusCode);
    expect(response.error?.error).toBeTruthy();
    expect(response.error?.message).toBeTruthy();
  };

  beforeAll(async () => {
    client = new InsForgeClient({
      baseUrl: baseUrl as string,
      anonKey: anonKey as string,
    });

    if (!useExistingCredentials) {
      const signUp = await client.auth.signUp({
        email,
        password,
        name: "SDK Integration User",
      });

      if (
        signUp.error &&
        !/already|exist|duplicate/i.test(signUp.error.message || "")
      ) {
        throw new Error(`signUp failed: ${signUp.error.message}`);
      }
    }

    const signIn = await signInWithRetry();

    currentUserId = signIn.data?.user?.id || "";
    if (!currentUserId) {
      const currentUser = await client.auth.getCurrentUser();
      currentUserId = currentUser.data?.user?.id || "";
    }

    if (!currentUserId) {
      throw new Error("Unable to resolve current user id after sign in.");
    }
  }, 30000);

  it("should successfully sign in with valid credentials", async () => {
    const response = await signInWithRetry();

    expect(response.error).toBeNull();
    expect(response.data).toBeTruthy();
    expect(response.data?.accessToken).toBeTruthy();
    expect(response.data?.user?.id).toBeTruthy();
  }, 30000);

  it("should fail with incorrect password", async () => {
    const response = await client.auth.signInWithPassword({
      email,
      password: `${password}-wrong`,
    });

    assertAuthFailureContract(response);
  }, 30000);

  it("should fail with non-existent email", async () => {
    const nonExistentEmail = `missing-${Date.now()}@example.com`;
    const response = await client.auth.signInWithPassword({
      email: nonExistentEmail,
      password,
    });

    assertAuthFailureContract(response);
  }, 30000);

  it("should return current session after sign in", async () => {
    const response = await client.auth.getCurrentSession();

    expect(response.error).toBeNull();
    expect(response.data).toBeTruthy();
    expect(response.data.session).not.toBeNull();
    expect(response.data.session?.user?.id).toBeTruthy();
  }, 30000);

  it("should get user profile after sign in", async () => {
    const response = await client.auth.getProfile(currentUserId);

    expect(response.error).toBeNull();
    expect(response.data).toBeTruthy();
  }, 30000);

  it("should update user profile", async () => {
    const updatedName = `SDK Integration ${Date.now()}`;
    const response = await client.auth.setProfile({
      displayName: updatedName,
    });

    if (!requireProfileUpdate && response.error) {
      expect([401, 403]).toContain(response.error.statusCode);
      expect(response.data).toBeNull();
      return;
    }

    expect(response.error).toBeNull();
    expect(response.data).toBeTruthy();
  }, 30000);

  it("should get public auth configuration", async () => {
    const response = await client.auth.getPublicAuthConfig();

    expect(response.error).toBeNull();
    expect(response.data).toBeTruthy();
  }, 30000);

  it("should sign out successfully", async () => {
    const signOut = await client.auth.signOut();
    expect(signOut.error).toBeNull();

    const currentSession = await client.auth.getCurrentSession();
    expect(currentSession.error).toBeNull();
    expect(currentSession.data.session).toBeNull();
  }, 30000);
});
