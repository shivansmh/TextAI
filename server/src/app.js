import express from "express";
import cors from "cors";
import { rateLimit } from "express-rate-limit";

export const SYSTEM_PROMPT =
  "You get a piece of text the user selected on a web page. " +
  "If it is a question, answer it. If it is a concept or paragraph, explain it simply and concisely. " +
  "For math, use standard LaTeX delimiters for formulas and put multi-step equations on separate lines. " +
  "Keep the answer short and clear.";

const CLIENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function quotaSnapshot(store, clientId, dailyLimit, now = new Date()) {
  const usageDate = now.toISOString().slice(0, 10);
  const reset = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1,
  ));
  const used = store.getUsed(clientId, usageDate);
  const secondsUntilReset = Math.max(0, Math.ceil((reset.getTime() - now.getTime()) / 1000));
  return {
    limit: dailyLimit,
    used,
    remaining: Math.max(0, dailyLimit - used),
    resetAt: reset.toISOString(),
    secondsUntilReset,
    resetTimezone: "UTC",
  };
}

function readClientId(request) {
  const clientId = request.get("x-client-id");
  return typeof clientId === "string" && CLIENT_ID_PATTERN.test(clientId)
    ? clientId.toLowerCase()
    : null;
}

export function createApp({ config, store, fetchImpl = globalThis.fetch, clock = () => new Date() }) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxy ?? 1);

  const allowedOrigins = new Set(config.allowedOrigins ?? []);
  const corsOptions = {
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin)) return callback(null, true);
      return callback(new Error("Origin not allowed"));
    },
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "X-Client-Id"],
    maxAge: 600,
  };

  app.use(cors(corsOptions));
  app.use((_request, response, next) => {
    response.set("Cache-Control", "no-store");
    next();
  });
  app.use(express.json({ limit: "24kb" }));
  app.get("/health", (_request, response) => response.json({ status: "ok" }));

  const apiLimiter = rateLimit({
    windowMs: config.ipRateWindowMs ?? 15 * 60 * 1000,
    limit: config.ipRequestsPerWindow ?? 30,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    handler(_request, response) {
      response.status(429).json({
        error: "Too many requests from this network. Please wait before trying again.",
        code: "ip_rate_limited",
      });
    },
  });
  app.use("/api", apiLimiter);

  app.get("/api/quota", (request, response) => {
    const clientId = readClientId(request);
    if (!clientId) {
      return response.status(400).json({ error: "A valid client ID is required.", code: "invalid_client_id" });
    }
    return response.json({ quota: quotaSnapshot(store, clientId, config.dailyLimit, clock()) });
  });

  app.post("/api/generate", async (request, response) => {
    const clientId = readClientId(request);
    if (!clientId) {
      return response.status(400).json({ error: "A valid client ID is required.", code: "invalid_client_id" });
    }

    const text = typeof request.body?.text === "string" ? request.body.text.trim() : "";
    if (!text) {
      return response.status(400).json({ error: "Select or enter some text first.", code: "empty_text" });
    }
    if (text.length > config.maxInputChars) {
      return response.status(413).json({
        error: `Text is too long. The limit is ${config.maxInputChars.toLocaleString()} characters.`,
        code: "input_too_long",
      });
    }
    if (!config.groqApiKey) {
      return response.status(503).json({
        error: "The TextAI service has not configured its Groq key yet.",
        code: "service_not_configured",
      });
    }

    const now = clock();
    const usageDate = now.toISOString().slice(0, 10);
    const reserved = store.reserve({
      clientId,
      usageDate,
      now: now.toISOString(),
      dailyLimit: config.dailyLimit,
    });
    if (!reserved) {
      return response.status(429).json({
        error: "This installation has used all of today's TextAI requests.",
        code: "daily_quota_exhausted",
        quota: quotaSnapshot(store, clientId, config.dailyLimit, now),
      });
    }

    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), 45_000);
    try {
      const upstream = await fetchImpl("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.groqApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: config.groqModel,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: text },
          ],
          temperature: 0.4,
          max_tokens: 2048,
        }),
        signal: abortController.signal,
      });

      const payload = await upstream.json().catch(() => ({}));
      const answer = payload?.choices?.[0]?.message?.content;
      if (!upstream.ok || typeof answer !== "string" || !answer.trim()) {
        store.release({ clientId, usageDate });
        const providerLimited = upstream.status === 429;
        return response.status(providerLimited ? 503 : 502).json({
          error: providerLimited
            ? "TextAI's AI provider is temporarily rate-limited. Your daily request was not counted."
            : "TextAI could not get a response from its AI provider. Your daily request was not counted.",
          code: providerLimited ? "provider_rate_limited" : "provider_error",
        });
      }

      return response.json({
        answer: answer.trim(),
        quota: quotaSnapshot(store, clientId, config.dailyLimit, clock()),
      });
    } catch {
      store.release({ clientId, usageDate });
      return response.status(502).json({
        error: "TextAI could not reach its AI provider. Your daily request was not counted.",
        code: "provider_unavailable",
      });
    } finally {
      clearTimeout(timeout);
    }
  });

  app.use((error, _request, response, _next) => {
    if (error?.message === "Origin not allowed") {
      return response.status(403).json({ error: "This extension origin is not allowed.", code: "origin_not_allowed" });
    }
    if (error instanceof SyntaxError && "body" in error) {
      return response.status(400).json({ error: "Request body must be valid JSON.", code: "invalid_json" });
    }
    return response.status(500).json({ error: "An unexpected server error occurred.", code: "internal_error" });
  });

  return app;
}
