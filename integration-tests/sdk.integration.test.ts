import { describe, expect, it } from "vitest";
import { createClient } from "../src";

const hasIntegrationSecrets = Boolean(
  process.env.INSFORGE_INTEGRATION_BASE_URL &&
    process.env.INSFORGE_INTEGRATION_ANON_KEY
);

describe("SDK Integration Smoke Tests", () => {
  it("creates a client with all core modules", () => {
    const baseUrl = process.env.INSFORGE_INTEGRATION_BASE_URL;
    const anonKey = process.env.INSFORGE_INTEGRATION_ANON_KEY;
    const client = createClient({
      baseUrl: baseUrl || "http://localhost:7130",
      anonKey: anonKey || "integration-anon-key-not-set",
    });

    expect(client.auth).toBeDefined();
    expect(client.database).toBeDefined();
    expect(client.storage).toBeDefined();
    expect(client.ai).toBeDefined();
    expect(client.functions).toBeDefined();
    expect(client.realtime).toBeDefined();
    expect(client.emails).toBeDefined();
  });
});

const describeIfIntegration = hasIntegrationSecrets ? describe : describe.skip;

describeIfIntegration("SDK Backend Integration Tests", () => {
  it("retrieves public auth configuration", async () => {
    const client = createClient({
      baseUrl: process.env.INSFORGE_INTEGRATION_BASE_URL as string,
      anonKey: process.env.INSFORGE_INTEGRATION_ANON_KEY as string,
    });
    const { data, error } = await client.auth.getPublicAuthConfig();

    expect(error).toBeNull();
    expect(data).toBeTruthy();
  });
});
