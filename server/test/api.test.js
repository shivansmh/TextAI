import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createApp } from "../src/app.js";
import { createUsageStore } from "../src/usage-store.js";

const CLIENT_A = "2f1f0d91-9a3c-4a84-96e9-1b1a22d870ad";
const CLIENT_B = "5ab720f9-9af1-435d-980c-c98755af1c12";
const EXTENSION_ORIGIN = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";

describe("TextAI API", () => {
  const store = createUsageStore(":memory:");
  let providerCalls = 0;
  let failProvider = false;
  const fixedNow = new Date("2026-10-22T19:00:00.000Z");
  const config = {
    groqApiKey: "test-only-key",
    groqModel: "openai/gpt-oss-20b",
    dailyLimit: 2,
    maxInputChars: 100,
    ipRequestsPerWindow: 100,
    ipRateWindowMs: 60_000,
    allowedOrigins: [EXTENSION_ORIGIN],
    trustProxy: false,
  };
  const app = createApp({
    config,
    store,
    clock: () => new Date(fixedNow),
    fetchImpl: async (_url, options) => {
      providerCalls += 1;
      assert.equal(options.headers.Authorization, "Bearer test-only-key");
      const requestBody = JSON.parse(options.body);
      assert.equal(requestBody.messages[1].content, "Explain this.");
      if (failProvider) return new Response(JSON.stringify({ error: "test failure" }), { status: 429 });
      return new Response(JSON.stringify({
        choices: [{ message: { content: "A short explanation." } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
  });
  let server;
  let baseUrl;

  before(async () => {
    server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    store.close();
  });

  async function quota(clientId, origin) {
    return fetch(`${baseUrl}/api/quota`, {
      headers: {
        "X-Client-Id": clientId,
        ...(origin ? { Origin: origin } : {}),
      },
    });
  }

  async function generate(clientId, text = "Explain this.") {
    return fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Client-Id": clientId },
      body: JSON.stringify({ text }),
    });
  }

  it("proxies a response and returns the remaining count plus next UTC reset time", async () => {
    const response = await generate(CLIENT_A);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.answer, "A short explanation.");
    assert.deepEqual(body.quota, {
      limit: 2,
      used: 1,
      remaining: 1,
      resetAt: "2026-10-23T00:00:00.000Z",
      secondsUntilReset: 5 * 60 * 60,
      resetTimezone: "UTC",
    });
  });

  it("enforces the daily limit per installation and keeps installations separate", async () => {
    assert.equal((await generate(CLIENT_A)).status, 200);
    const exhausted = await generate(CLIENT_A);
    assert.equal(exhausted.status, 429);
    assert.equal((await exhausted.json()).quota.remaining, 0);

    const otherInstall = await generate(CLIENT_B);
    assert.equal(otherInstall.status, 200);
    assert.equal((await otherInstall.json()).quota.remaining, 1);
  });

  it("reserves quota atomically when several requests arrive together", async () => {
    const clientId = "81a0607a-59ad-4ec5-9b6a-25b620336994";
    const responses = await Promise.all([
      generate(clientId),
      generate(clientId),
      generate(clientId),
    ]);
    assert.deepEqual(responses.map((response) => response.status).sort(), [200, 200, 429]);
  });

  it("rejects invalid IDs, overlong prompts, and unapproved browser origins", async () => {
    const badId = await fetch(`${baseUrl}/api/quota`, { headers: { "X-Client-Id": "not-an-id" } });
    assert.equal(badId.status, 400);

    const tooLong = await generate(CLIENT_B, "x".repeat(config.maxInputChars + 1));
    assert.equal(tooLong.status, 413);

    const allowed = await quota(CLIENT_B, EXTENSION_ORIGIN);
    assert.equal(allowed.status, 200);
    assert.equal(allowed.headers.get("access-control-allow-origin"), EXTENSION_ORIGIN);

    const denied = await quota(CLIENT_B, "chrome-extension://unapprovedextensionid");
    assert.equal(denied.status, 403);
  });

  it("does not charge daily usage when the upstream provider is unavailable", async () => {
    failProvider = true;
    const response = await generate("a90e7cb8-44b2-4514-96db-cf8b87035c28");
    failProvider = false;
    assert.equal(response.status, 503);
    const balance = await quota("a90e7cb8-44b2-4514-96db-cf8b87035c28");
    assert.equal((await balance.json()).quota.remaining, config.dailyLimit);
  });

  it("does not invoke the provider when an installation has exhausted its allowance", () => {
    assert.equal(providerCalls, 6);
  });
});
