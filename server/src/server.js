import "dotenv/config";
import { config } from "./config.js";
import { createApp } from "./app.js";
import { createUsageStore } from "./usage-store.js";

const store = createUsageStore(config.databasePath);
const app = createApp({ config, store });
const cleanupTimer = setInterval(() => {
  try {
    store.pruneOldRecords();
  } catch (error) {
    console.error("Quota retention cleanup failed:", error.message);
  }
}, 24 * 60 * 60 * 1000);
cleanupTimer.unref();
const server = app.listen(config.port, "0.0.0.0", () => {
  console.log(`TextAI API listening on port ${config.port}`);
  if (!config.groqApiKey) {
    console.warn("GROQ_API_KEY is unset; /api/generate will return service_not_configured.");
  }
});

function shutdown(signal) {
  console.log(`${signal} received; shutting down TextAI API.`);
  clearInterval(cleanupTimer);
  server.close(() => {
    store.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
