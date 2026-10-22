import { formatMath } from "../math.js";

const $ = (selector) => document.querySelector(selector);
const mainView = $("#main-view");
const settingsView = $("#settings-view");
const sourceText = $("#source-text");
const answerContent = $("#answer-content");
const answerPanel = $("#answer-panel");
const errorBanner = $("#error-banner");
const settingsError = $("#settings-error");
const explainButton = $("#explain-button");
const charCount = $("#char-count");
const stateBadge = $("#state-badge");
const statusLight = $("#status-light");
const statusLabel = $("#status-label");
const modelLabel = $("#model-label");
const settingsToggle = $("#settings-toggle");
const MAX_CHARS = 12000;
let fullResponse = "";
let pendingStream = "";
let flushTimer = null;
let settingsState = { apiKeyConfigured: false, model: "openai/gpt-oss-20b", secureStorageAvailable: false };

function showError(message = "") {
  errorBanner.textContent = message;
  errorBanner.hidden = !message;
}

function showSettingsError(message = "") {
  settingsError.textContent = message;
  settingsError.hidden = !message;
}

function setBusy(busy) {
  explainButton.disabled = busy;
  answerPanel.setAttribute("aria-busy", String(busy));
  stateBadge.textContent = busy ? "STREAMING" : "READY";
  stateBadge.classList.toggle("busy", busy);
  $("#button-label").textContent = busy ? "Thinking…" : "Explain";
  statusLight.classList.toggle("working", busy);
  statusLabel.textContent = busy ? "GROQ STREAMING" : "TRAY ACTIVE";
}

function renderMarkdown() {
  const mathFormatted = formatMath(fullResponse);
  const html = window.marked.parse(mathFormatted, { breaks: true, gfm: true });
  answerContent.innerHTML = window.DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ["style", "iframe", "form", "input", "button", "svg", "math"],
    FORBID_ATTR: ["style", "onerror", "onclick"],
  });
  for (const link of answerContent.querySelectorAll("a")) {
    link.removeAttribute("href");
    link.removeAttribute("target");
    link.setAttribute("rel", "nofollow noopener noreferrer");
  }
}

function enqueueStream(text) {
  pendingStream += text;
  if (!flushTimer) flushTimer = setTimeout(flushOneWord, 18);
}

function flushOneWord() {
  flushTimer = null;
  if (!pendingStream) return;
  const boundary = pendingStream.search(/\s/);
  if (boundary >= 0) {
    fullResponse += pendingStream.slice(0, boundary + 1);
    pendingStream = pendingStream.slice(boundary + 1);
  } else if (pendingStream.length > 24) {
    fullResponse += pendingStream.slice(0, 24);
    pendingStream = pendingStream.slice(24);
  } else {
    return;
  }
  renderMarkdown();
  answerContent.scrollTop = answerContent.scrollHeight;
  if (pendingStream) flushTimer = setTimeout(flushOneWord, 18);
}

function flushAll() {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
  fullResponse += pendingStream;
  pendingStream = "";
  renderMarkdown();
  answerContent.scrollTop = answerContent.scrollHeight;
}

function updateInputCount() {
  charCount.textContent = `${sourceText.value.length.toLocaleString()} / ${MAX_CHARS.toLocaleString()}`;
}

function startStream() {
  fullResponse = "";
  pendingStream = "";
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
  answerContent.replaceChildren();
  showError("");
  setBusy(true);
}

async function explain() {
  const text = sourceText.value.trim();
  if (!text) {
    showError("Select text anywhere and press the global hotkey, or paste text into the box first.");
    sourceText.focus();
    return;
  }
  if (text.length > MAX_CHARS) {
    showError(`Please use ${MAX_CHARS.toLocaleString()} characters or fewer.`);
    return;
  }
  showSettingsError("");
  startStream();
  try {
    const result = await window.textai.generate(text);
    if (!result?.ok) throw new Error(result?.error || "TextAI could not start the request.");
  } catch (error) {
    flushAll();
    setBusy(false);
    showError(error.message);
  }
}

async function refreshSettings() {
  try {
    settingsState = await window.textai.getSettings();
    $("#model-id").value = settingsState.model || "openai/gpt-oss-20b";
    modelLabel.textContent = settingsState.model || "openai/gpt-oss-20b";
    const keyState = $("#key-state");
    if (!settingsState.secureStorageAvailable) {
      keyState.textContent = "OS secure storage unavailable — saving a key is disabled.";
      keyState.classList.add("warning");
    } else if (settingsState.apiKeyConfigured) {
      keyState.textContent = "A key is stored encrypted on this device. Leave blank to keep it.";
      keyState.classList.remove("warning");
    } else {
      keyState.textContent = "No API key saved yet.";
      keyState.classList.remove("warning");
    }
  } catch (error) {
    showSettingsError(error.message);
  }
}

function openSettings() {
  mainView.hidden = true;
  settingsView.hidden = false;
  showError("");
  refreshSettings();
  $("#api-key").focus();
}

function closeSettings() {
  settingsView.hidden = true;
  mainView.hidden = false;
}

sourceText.addEventListener("input", updateInputCount);
explainButton.addEventListener("click", explain);
sourceText.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") explain();
});
settingsToggle.addEventListener("click", openSettings);
$("#back-button").addEventListener("click", closeSettings);
$("#hide-window").addEventListener("click", () => window.textai.hide());
$("#save-settings").addEventListener("click", async () => {
  showSettingsError("");
  const button = $("#save-settings");
  button.disabled = true;
  try {
    settingsState = await window.textai.saveSettings({
      apiKey: $("#api-key").value,
      model: $("#model-id").value,
    });
    $("#api-key").value = "";
    modelLabel.textContent = settingsState.model;
    $("#key-state").textContent = "Saved encrypted in your operating system’s secure storage.";
    $("#key-state").classList.remove("warning");
  } catch (error) {
    showSettingsError(error.message);
  } finally {
    button.disabled = false;
  }
});
$("#clear-key").addEventListener("click", async () => {
  showSettingsError("");
  try {
    settingsState = await window.textai.clearApiKey();
    $("#api-key").value = "";
    $("#key-state").textContent = "API key removed from this device.";
  } catch (error) {
    showSettingsError(error.message);
  }
});

window.textai.onSelection(({ text = "", error = "" } = {}) => {
  if (text) {
    sourceText.value = text.slice(0, MAX_CHARS);
    updateInputCount();
    showError("");
  }
  if (error) showError(error);
});

window.textai.onStream((event) => {
  if (event.type === "start") {
    startStream();
  } else if (event.type === "chunk") {
    enqueueStream(event.text);
  } else if (event.type === "done") {
    flushAll();
    setBusy(false);
  } else if (event.type === "error") {
    flushAll();
    setBusy(false);
    showError(event.error);
    if (/Add your Groq API key/.test(event.error)) {
      openSettings();
      showSettingsError(event.error);
    }
  }
});

$("#quit-app").addEventListener("click", () => window.textai.quit());

if (!window.marked || !window.DOMPurify) {
  showError("TextAI could not load its local Markdown renderer. Reinstall the desktop app.");
} else {
  window.marked.setOptions({ gfm: true, breaks: true });
}
refreshSettings();
updateInputCount();
