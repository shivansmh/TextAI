import { formatMath } from "./math.js";

const $ = (selector) => document.querySelector(selector);
const textArea = $("#source-text");
const askButton = $("#ask-button");
const askLabel = $("#ask-label");
const answerBox = $("#answer-box");
const answerSection = $("#answer-section");
const errorBox = $("#error-message");
const quotaCount = $("#quota-count");
const quotaFoot = $("#quota-foot");
const quotaFill = $("#quota-fill");
const quotaProgress = $("#quota-progress");
const statusDot = $("#status-dot");
const answerState = $("#answer-state");
const MAX_INPUT_CHARS = 8000;
let latestQuota = null;

function showError(message = "") {
  errorBox.textContent = message;
  errorBox.hidden = !message;
}

function renderAnswer(answer) {
  answerBox.replaceChildren();
  if (!answer) {
    const empty = document.createElement("p");
    empty.className = "empty-answer";
    empty.textContent = "Your explanation will appear here.";
    answerBox.append(empty);
    return;
  }
  // textContent prevents model output from being treated as executable HTML.
  answerBox.textContent = formatMath(answer);
}

function renderQuota(quota) {
  latestQuota = quota;
  if (!quota || !Number.isFinite(quota.limit) || !Number.isFinite(quota.remaining)) {
    quotaCount.textContent = "Unavailable";
    quotaFoot.textContent = "Could not read the daily allowance.";
    quotaFill.style.width = "0%";
    quotaProgress.setAttribute("aria-valuenow", "0");
    return;
  }
  const remaining = Math.max(0, quota.remaining);
  const used = Math.max(0, quota.used ?? quota.limit - remaining);
  const percentage = quota.limit > 0 ? Math.min(100, (used / quota.limit) * 100) : 100;
  quotaCount.textContent = `${remaining} / ${quota.limit} left`;
  quotaFill.style.width = `${percentage}%`;
  quotaProgress.setAttribute("aria-valuemax", String(quota.limit));
  quotaProgress.setAttribute("aria-valuenow", String(used));
  updateCountdown();
}

function formatCountdown(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  if (minutes > 0) return `${minutes}m ${String(remainder).padStart(2, "0")}s`;
  return `${remainder}s`;
}

function updateCountdown() {
  if (!latestQuota?.resetAt) return;
  const seconds = Math.max(0, Math.ceil((Date.parse(latestQuota.resetAt) - Date.now()) / 1000));
  quotaFoot.textContent = seconds > 0
    ? `Allowance refreshes in ${formatCountdown(seconds)} · 00:00 UTC`
    : "Allowance refreshes now · checking server…";
}

function setLoading(isLoading) {
  askButton.disabled = isLoading;
  answerSection.setAttribute("aria-busy", String(isLoading));
  answerState.textContent = isLoading ? "THINKING" : "READY";
  answerState.classList.toggle("loading", isLoading);
  askLabel.textContent = isLoading ? "Thinking…" : "Explain this";
}

function sendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) reject(new Error(runtimeError.message));
      else resolve(response ?? {});
    });
  });
}

async function initialize() {
  textArea.addEventListener("input", () => {
    $("#char-count").textContent = `${textArea.value.length.toLocaleString()} / 8,000`;
  });

  try {
    const state = await sendMessage({ type: "TEXTAI_GET_STATE" });
    statusDot.classList.toggle("offline", Boolean(state.quotaError));
    if (state.quota) renderQuota(state.quota);
    if (state.lastAnswer) renderAnswer(state.lastAnswer);
    if (state.draftText) {
      textArea.value = state.draftText.slice(0, MAX_INPUT_CHARS);
      $("#char-count").textContent = `${textArea.value.length.toLocaleString()} / 8,000`;
    }
    if (state.isLoading) setLoading(true);
    if (state.lastError) showError(state.lastError);
    if (state.quotaError) showError(state.quotaError);

    const configuredUrl = self.TEXTAI_CONFIG?.apiBaseUrl ?? "";
    if (configuredUrl.includes("your-textai-api.example.com")) {
      showError("The extension publisher must set the TextAI backend URL before release.");
    }
  } catch (error) {
    statusDot.classList.add("offline");
    showError(error.message);
  }

  try {
    const selection = await sendMessage({ type: "TEXTAI_GET_SELECTION" });
    if (selection.text) {
      textArea.value = selection.text.slice(0, MAX_INPUT_CHARS);
      $("#char-count").textContent = `${textArea.value.length.toLocaleString()} / 8,000`;
    }
  } catch {
    // The popup remains usable for text pasted directly by the user.
  }
}

askButton.addEventListener("click", async () => {
  showError("");
  if (!textArea.value.trim()) {
    try {
      const selection = await sendMessage({ type: "TEXTAI_GET_SELECTION" });
      if (selection.text) textArea.value = selection.text.slice(0, MAX_INPUT_CHARS);
    } catch (error) {
      showError(error.message);
      return;
    }
  }
  const text = textArea.value.trim();
  if (!text) {
    showError("Select text on the page or paste it into the box first.");
    return;
  }
  renderAnswer("");
  setLoading(true);
  try {
    const result = await sendMessage({ type: "TEXTAI_GENERATE", text });
    if (result.quota) renderQuota(result.quota);
    if (!result.ok) {
      showError(result.error || "TextAI could not complete the request.");
      return;
    }
    showError("");
    renderAnswer(result.answer);
    statusDot.classList.remove("offline");
  } catch (error) {
    showError(error.message);
  } finally {
    setLoading(false);
  }
});

$("#refresh-selection").addEventListener("click", async () => {
  showError("");
  try {
    const selection = await sendMessage({ type: "TEXTAI_GET_SELECTION" });
    if (selection.error) throw new Error(selection.error);
    if (!selection.text) throw new Error("No text is selected on the active page.");
    textArea.value = selection.text.slice(0, MAX_INPUT_CHARS);
    $("#char-count").textContent = `${textArea.value.length.toLocaleString()} / 8,000`;
    textArea.focus();
  } catch (error) {
    showError(error.message);
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  if (changes.quota?.newValue) renderQuota(changes.quota.newValue);
  if (changes.lastAnswer?.newValue) renderAnswer(changes.lastAnswer.newValue);
  if (changes.isLoading) setLoading(Boolean(changes.isLoading.newValue));
  if (changes.lastError) showError(changes.lastError.newValue || "");
});

setInterval(updateCountdown, 1000);
initialize();
