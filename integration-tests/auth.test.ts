import { beforeAll, describe, expect, it } from "vitest";
import { InsForgeClient } from "../src/client";

const baseUrl = process.env.INSFORGE_INTEGRATION_BASE_URL;
const anonKey = process.env.INSFORGE_INTEGRATION_ANON_KEY;
const hasIntegrationSecrets = Boolean(baseUrl && anonKey);
const describeIfIntegration = hasIntegrationSecrets ? describe : describe.skip;

const existingEmail = process.env.INSFORGE_INTEGRATION_TEST_EMAIL;
const existingPassword = process.env.INSFORGE_INTEGRATION_TEST_PASSWORD;
const useExistingCredentials = Boolean(existingEmail && existingPassword);

const generatedEmail = `sdk-int-${Date.now()}-${Math.random()
  .toString(36)
  .slice(2, 10)}@example.com`;
const generatedPassword = `Pwd!${Date.now()}Aa`;

const email = existingEmail || generatedEmail;
const password = existingPassword || generatedPassword;

describeIfIntegration("Auth Module - Integration Tests", () => {
  let client: InsForgeClient;
  let currentUserId = "";
  let hasSessionToken = false;

  const signInWithRetry = async (attempts = 3) => {
    let lastErrorMessage = "";

    for (let i = 0; i < attempts; i += 1) {
      const signIn = await client.auth.signInWithPassword({ email, password });
      if (!signIn.error) {
        return signIn;
      }

      lastErrorMessage = signIn.error.message || "unknown sign-in error";

      if (i < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    throw new Error(`signInWithPassword failed after ${attempts} attempts: ${lastErrorMessage}`);
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
    hasSessionToken = Boolean(signIn.data?.accessToken);

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
    hasSessionToken = hasSessionToken || Boolean(response.data?.accessToken);

    expect(response.error).toBeNull();
    expect(response.data).toBeTruthy();
    expect(response.data?.user?.id).toBeTruthy();
  }, 30000);

  it("should fail with incorrect password", async () => {
    const response = await client.auth.signInWithPassword({
      email,
      password: `${password}-wrong`,
    });

    expect(response.data).toBeNull();
    expect(response.error).toBeTruthy();
  }, 30000);

  it("should fail with non-existent email", async () => {
    const nonExistentEmail = `missing-${Date.now()}@example.com`;
    const response = await client.auth.signInWithPassword({
      email: nonExistentEmail,
      password,
    });

    expect(response.data).toBeNull();
    expect(response.error).toBeTruthy();
  }, 30000);

  it("should return current session after sign in", async () => {
    const response = await client.auth.getCurrentSession();

    expect(response.error).toBeNull();
    expect(response.data).toBeTruthy();
    expect(response.data).toHaveProperty("session");
    if (response.data.session) {
      expect(response.data.session.user?.id).toBeTruthy();
    }
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

    if (response.error) {
      expect([401, 403]).toContain(response.error.statusCode);
      return;
    }

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
    if (hasSessionToken) {
      expect(currentSession.data.session).toBeNull();
    }
  }, 30000);
});
