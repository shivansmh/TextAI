import path from "node:path";

function positiveInteger(name, fallback) {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

const trustProxyValue = process.env.TRUST_PROXY ?? "1";
const trustProxy = trustProxyValue.toLowerCase() === "false"
  ? false
  : Number.parseInt(trustProxyValue, 10) || 1;
const databasePath = process.env.DATABASE_PATH ?? "./data/textai.sqlite";

export const config = {
  port: positiveInteger("PORT", 8787),
  groqApiKey: process.env.GROQ_API_KEY ?? "",
  groqModel: process.env.GROQ_MODEL ?? "openai/gpt-oss-20b",
  dailyLimit: positiveInteger("DAILY_LIMIT", 50),
  maxInputChars: positiveInteger("MAX_INPUT_CHARS", 8000),
  ipRequestsPerWindow: positiveInteger("IP_REQUESTS_PER_WINDOW", 30),
  ipRateWindowMs: positiveInteger("IP_RATE_WINDOW_MS", 15 * 60 * 1000),
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  trustProxy,
  databasePath: databasePath === ":memory:" ? databasePath : path.resolve(databasePath),
};
