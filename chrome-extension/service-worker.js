importScripts("config.js");

const DEFAULT_API_BASE_URL = self.TEXTAI_CONFIG.apiBaseUrl.replace(/\/+$/, "");
const MAX_INPUT_CHARS = 8000;
let activeRequest = null;

async function getClientId() {
  const { clientId } = await chrome.storage.local.get("clientId");
  if (clientId) return clientId;
  const created = crypto.randomUUID();
  await chrome.storage.local.set({ clientId: created });
  return created;
}

async function currentApiBaseUrl() {
  const { apiBaseUrl } = await chrome.storage.local.get("apiBaseUrl");
  return (apiBaseUrl || DEFAULT_API_BASE_URL).replace(/\/+$/, "");
}

async function writeState(patch) {
  await chrome.storage.local.set({ ...patch, updatedAt: Date.now() });
}

async function fetchQuota(clientId) {
  const baseUrl = await currentApiBaseUrl();
  const response = await fetch(`${baseUrl}/api/quota`, {
    headers: { "X-Client-Id": clientId },
    cache: "no-store",
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Quota request failed (${response.status}).`);
  return payload.quota;
}

async function loadState() {
  const clientId = await getClientId();
  const saved = await chrome.storage.local.get([
    "lastAnswer", "lastError", "isLoading", "statusMessage", "quota", "updatedAt",
  ]);
  try {
    const quota = await fetchQuota(clientId);
    await writeState({ quota, quotaError: "" });
    return { clientId, ...saved, quota, quotaError: "" };
  } catch (error) {
    const quotaError = error.message || "Could not reach the TextAI server.";
    await writeState({ quotaError });
    return { clientId, ...saved, quota: saved.quota ?? null, quotaError };
  }
}

async function readSelection() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id) throw new Error("Open a regular web page, select some text, and try again.");
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
    const result = await chrome.tabs.sendMessage(tab.id, { type: "TEXTAI_READ_SELECTION" });
    return result?.text ?? "";
  } catch {
    throw new Error("Chrome does not allow TextAI to read this page. Try a regular website tab.");
  }
}

async function generateText(rawText) {
  const text = typeof rawText === "string" ? rawText.trim() : "";
  if (!text) throw new Error("Select text on the page or paste it into the box first.");
  if (text.length > MAX_INPUT_CHARS) {
    throw new Error(`Please select less text (maximum ${MAX_INPUT_CHARS.toLocaleString()} characters).`);
  }
  if (activeRequest) return activeRequest;
  activeRequest = (async () => {
    let timeout;
    try {
      const clientId = await getClientId();
      await writeState({ isLoading: true, lastError: "", statusMessage: "Thinking…" });
      const baseUrl = await currentApiBaseUrl();
      const controller = new AbortController();
      timeout = setTimeout(() => controller.abort(), 50_000);
      const response = await fetch(`${baseUrl}/api/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Client-Id": clientId,
        },
        body: JSON.stringify({ text }),
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => ({}));
      if (payload.quota) await writeState({ quota: payload.quota });
      if (!response.ok) {
        const error = new Error(payload.error || `TextAI request failed (${response.status}).`);
        error.quota = payload.quota;
        throw error;
      }
      await writeState({
        lastAnswer: payload.answer,
        lastError: "",
        isLoading: false,
        statusMessage: "Ready",
        quota: payload.quota ?? null,
      });
      return { ok: true, answer: payload.answer, quota: payload.quota ?? null };
    } catch (error) {
      const message = error.name === "AbortError"
        ? "The request timed out. Please try again."
        : (error.message || "Could not reach the TextAI server.");
      await writeState({
        lastError: message,
        isLoading: false,
        statusMessage: "Request failed",
        ...(error.quota ? { quota: error.quota } : {}),
      });
      return { ok: false, error: message, quota: error.quota ?? null };
    } finally {
      if (timeout) clearTimeout(timeout);
      activeRequest = null;
    }
  })();
  return activeRequest;
}

async function explainCurrentSelection() {
  try {
    const selectedText = await readSelection();
    if (!selectedText) throw new Error("No text selected. Select text on the page, then try again.");
    await writeState({ draftText: selectedText });
    return generateText(selectedText);
  } catch (error) {
    await writeState({ lastError: error.message, isLoading: false, statusMessage: "Ready" });
    return { ok: false, error: error.message };
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  await getClientId();
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "textai-explain-selection",
      title: "Explain with TextAI",
      contexts: ["selection"],
    });
  });
});

chrome.runtime.onStartup.addListener(() => { getClientId(); });

chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId === "textai-explain-selection" && info.selectionText) {
    try {
      await writeState({ draftText: info.selectionText });
      await generateText(info.selectionText);
    } catch (error) {
      await writeState({ lastError: error.message, isLoading: false, statusMessage: "Request failed" });
    }
  }
});

chrome.commands.onCommand.addListener((command) => {
  if (command === "explain-selection") explainCurrentSelection();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "TEXTAI_GET_STATE") {
    loadState().then(sendResponse).catch((error) => sendResponse({ error: error.message }));
    return true;
  }
  if (message?.type === "TEXTAI_GET_SELECTION") {
    readSelection().then((text) => sendResponse({ text })).catch((error) => sendResponse({ error: error.message }));
    return true;
  }
  if (message?.type === "TEXTAI_GENERATE") {
    writeState({ draftText: message.text })
      .then(() => generateText(message.text))
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  return false;
});
