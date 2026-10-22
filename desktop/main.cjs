const { app, BrowserWindow, clipboard, globalShortcut, ipcMain, Menu, nativeImage, safeStorage, Tray } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");

const APP_ID = "com.textai.desktop";
const DEFAULT_MODEL = "openai/gpt-oss-20b";
const SYSTEM_PROMPT =
  "You get a piece of text the user selected on a web page. " +
  "If it is a question, answer it. If it is a concept or paragraph, explain it simply and concisely. " +
  "For math, use standard LaTeX delimiters for formulas and put multi-step equations on separate lines. " +
  "Keep the answer short and clear.";
const HOTKEY = process.platform === "darwin" ? "Command+Shift+G" : "Control+Alt+G";
const SETTINGS_FILE = "settings.enc.json";
const COPY_DELAY_MS = 140;
const CLIPBOARD_WAIT_MS = 1200;

let mainWindow;
let tray;
let settingsCache = { apiKey: "", model: DEFAULT_MODEL };
let settingsLoaded = false;
let generationRunning = false;
let captureRunning = false;
let quitting = false;
let pendingEvents = [];
let appIcon;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sendToRenderer(channel, payload) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.webContents.isLoading()) {
    pendingEvents.push([channel, payload]);
    return;
  }
  mainWindow.webContents.send(channel, payload);
}

function flushPendingEvents() {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isLoading()) return;
  for (const [channel, payload] of pendingEvents) mainWindow.webContents.send(channel, payload);
  pendingEvents = [];
}

function traySvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><rect x="2" y="2" width="28" height="28" rx="8" fill="#7c9cff"/><path d="M9 9h14v3H12v3h9v3h-9v3h11v3H9z" fill="#10141b"/></svg>`;
}

function getSettingsPath() {
  return path.join(app.getPath("userData"), SETTINGS_FILE);
}

async function secureStorageAvailable() {
  if (!await safeStorage.isAsyncEncryptionAvailable()) return false;
  // Only accept Linux backends that actually use the desktop's credential store.
  if (process.platform === "linux") {
    const backend = safeStorage.getSelectedStorageBackend?.();
    return ["gnome_libsecret", "kwallet", "kwallet5", "kwallet6"].includes(backend);
  }
  return true;
}

async function loadSettings() {
  if (settingsLoaded) return settingsCache;
  settingsLoaded = true;
  try {
    const encrypted = JSON.parse(await fs.readFile(getSettingsPath(), "utf8"));
    if (typeof encrypted.payload !== "string") return settingsCache;
    if (!await secureStorageAvailable()) {
      throw new Error("OS secure storage is currently unavailable. TextAI did not load the saved key.");
    }
    const encryptedBytes = Buffer.from(encrypted.payload, "base64");
    const decrypted = await safeStorage.decryptStringAsync(encryptedBytes);
    let raw = decrypted.result;
    if (decrypted.shouldReEncrypt) {
      raw = (await safeStorage.decryptStringAsync(encryptedBytes)).result;
    }
    const parsed = JSON.parse(raw);
    settingsCache = {
      apiKey: typeof parsed.apiKey === "string" ? parsed.apiKey : "",
      model: typeof parsed.model === "string" && parsed.model.trim() ? parsed.model.trim() : DEFAULT_MODEL,
    };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return settingsCache;
}

async function persistSettings(settings) {
  if (!await secureStorageAvailable()) {
    throw new Error("Secure OS credential storage is unavailable. On Linux, install and unlock Secret Service/libsecret or KWallet; TextAI will not save your key using weak fallback encryption.");
  }
  const folder = app.getPath("userData");
  await fs.mkdir(folder, { recursive: true });
  const encrypted = (await safeStorage.encryptStringAsync(JSON.stringify(settings))).toString("base64");
  const tempPath = `${getSettingsPath()}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify({ version: 1, payload: encrypted }), { mode: 0o600 });
  await fs.rename(tempPath, getSettingsPath());
  settingsCache = settings;
  settingsLoaded = true;
}

function createWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;
  mainWindow = new BrowserWindow({
    width: 560,
    height: 520,
    minWidth: 420,
    minHeight: 380,
    show: false,
    frame: false,
    transparent: false,
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: "#11151d",
    title: "TextAI",
    icon: appIcon,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
  mainWindow.webContents.on("did-finish-load", flushPendingEvents);
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (url !== mainWindow.webContents.getURL()) event.preventDefault();
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.on("close", (event) => {
    if (!quitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on("closed", () => { mainWindow = null; });
  return mainWindow;
}

function showWindow() {
  const window = createWindow();
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
  window.setAlwaysOnTop(true, "floating");
  if (process.platform === "darwin") app.focus({ steal: true });
}

function runCopyShortcut() {
  if (process.platform === "win32") {
    const powershell = "$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^c')";
    return new Promise((resolve, reject) => {
      const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", powershell], {
        windowsHide: true,
        stdio: "ignore",
      });
      child.once("error", reject);
      child.once("exit", (code) => code === 0 ? resolve() : reject(new Error("Windows did not send the copy shortcut.")));
    });
  }
  if (process.platform === "darwin") {
    return new Promise((resolve, reject) => {
      const child = spawn("osascript", ["-e", 'tell application "System Events" to keystroke "c" using {command down}'], { stdio: "ignore" });
      child.once("error", reject);
      child.once("exit", (code) => code === 0
        ? resolve()
        : reject(new Error("macOS blocked simulated copy. Allow TextAI under System Settings → Privacy & Security → Accessibility, then retry.")));
    });
  }
  if (process.platform === "linux") {
    return new Promise((resolve, reject) => {
      const child = spawn("xdotool", ["key", "--clearmodifiers", "ctrl+c"], { stdio: "ignore" });
      child.once("error", () => reject(new Error("TextAI needs xdotool to read selections on Linux. Install xdotool; Wayland sessions may restrict simulated copy.")));
      child.once("exit", (code) => code === 0
        ? resolve()
        : reject(new Error("Could not send copy. Install xdotool and check your desktop session permissions.")));
    });
  }
  return Promise.reject(new Error(`Selection capture is not supported on ${process.platform}.`));
}

async function captureSelection() {
  const previousClipboard = clipboard.availableFormats().map((format) => [format, clipboard.readBuffer(format)]);
  clipboard.clear();
  try {
    await delay(COPY_DELAY_MS);
    await runCopyShortcut();
    const deadline = Date.now() + CLIPBOARD_WAIT_MS;
    let copiedText = "";
    while (Date.now() < deadline) {
      await delay(70);
      copiedText = clipboard.readText();
      if (copiedText) break;
    }
    return copiedText.trim();
  } finally {
    clipboard.clear();
    for (const [format, data] of previousClipboard) {
      if (data?.length) clipboard.writeBuffer(format, data);
    }
  }
}

function showCaptureError(message) {
  showWindow();
  sendToRenderer("textai:selection", { text: "", error: message });
}

async function hotkeyAction() {
  if (captureRunning) return;
  captureRunning = true;
  try {
    const selectedText = await captureSelection();
    showWindow();
    sendToRenderer("textai:selection", selectedText
      ? { text: selectedText, error: "" }
      : { text: "", error: "No text selected. Select text on a page, then press the hotkey again." });
    if (selectedText) await beginGeneration(selectedText);
  } catch (error) {
    showCaptureError(error.message);
  } finally {
    captureRunning = false;
  }
}

async function beginGeneration(text) {
  const prompt = typeof text === "string" ? text.trim() : "";
  if (!prompt) throw new Error("Select or enter some text first.");
  if (prompt.length > 12000) throw new Error("This selection is too long. Please use 12,000 characters or less.");
  if (generationRunning) throw new Error("TextAI is already generating a response.");
  const settings = await loadSettings();
  if (!settings.apiKey) {
    sendToRenderer("textai:stream", { type: "error", error: "Add your Groq API key in Settings to use TextAI." });
    return;
  }

  generationRunning = true;
  sendToRenderer("textai:stream", { type: "start" });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);
  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${settings.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: settings.model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: prompt },
        ],
        temperature: 0.4,
        max_tokens: 2048,
        stream: true,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      const detail = body?.error?.message;
      throw new Error(detail || `Groq request failed (${response.status}). Check your API key, model, and account access.`);
    }
    if (!response.body) throw new Error("The Groq response did not support streaming.");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let streamedAnyText = false;
    const consumeLine = (line) => {
      if (!line.startsWith("data:")) return;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") return;
      let event;
      try { event = JSON.parse(data); } catch { return; }
      const delta = event?.choices?.[0]?.delta?.content;
      if (typeof delta === "string" && delta) {
        streamedAnyText = true;
        sendToRenderer("textai:stream", { type: "chunk", text: delta });
      }
    };
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) consumeLine(line);
      if (done) {
        if (buffer) consumeLine(buffer);
        break;
      }
    }
    if (!streamedAnyText) throw new Error("Groq returned an empty response.");
    sendToRenderer("textai:stream", { type: "done" });
  } catch (error) {
    const message = error.name === "AbortError" ? "The Groq request timed out. Please try again." : error.message;
    sendToRenderer("textai:stream", { type: "error", error: message });
  } finally {
    clearTimeout(timeout);
    generationRunning = false;
  }
}

function createTray() {
  const dataUrl = `data:image/svg+xml;base64,${Buffer.from(traySvg()).toString("base64")}`;
  tray = new Tray(nativeImage.createFromDataURL(dataUrl));
  tray.setToolTip("TextAI — press the global hotkey to explain selected text");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: `Explain selection (${HOTKEY})`, click: hotkeyAction },
    { label: "Open TextAI", click: showWindow },
    { type: "separator" },
    { label: "Quit TextAI", click: () => app.quit() },
  ]));
  tray.on("click", showWindow);
}

function registerIpc() {
  ipcMain.handle("settings:get", async () => {
    const settings = await loadSettings();
    return {
      apiKeyConfigured: Boolean(settings.apiKey),
      model: settings.model,
      secureStorageAvailable: await secureStorageAvailable(),
    };
  });
  ipcMain.handle("settings:save", async (_event, input = {}) => {
    const current = await loadSettings();
    const enteredKey = typeof input.apiKey === "string" ? input.apiKey.trim() : "";
    const model = typeof input.model === "string" ? input.model.trim() : current.model;
    if (!model || model.length > 160 || /\s/.test(model)) throw new Error("Enter a valid Groq model ID.");
    const next = { apiKey: enteredKey || current.apiKey, model };
    if (!next.apiKey) throw new Error("Enter your Groq API key first.");
    await persistSettings(next);
    return { apiKeyConfigured: true, model: next.model, secureStorageAvailable: await secureStorageAvailable() };
  });
  ipcMain.handle("settings:clear-key", async () => {
    const current = await loadSettings();
    await persistSettings({ apiKey: "", model: current.model });
    return { apiKeyConfigured: false, model: current.model, secureStorageAvailable: await secureStorageAvailable() };
  });
  ipcMain.handle("textai:generate", async (_event, text) => {
    await beginGeneration(text);
    return { ok: true };
  });
  ipcMain.on("window:hide", () => mainWindow?.hide());
  ipcMain.on("app:quit", () => app.quit());
}

const singleInstanceLock = app.requestSingleInstanceLock();
if (!singleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", showWindow);
}

app.setAppUserModelId(APP_ID);
if (singleInstanceLock) app.whenReady().then(async () => {
  if (process.platform === "darwin") app.dock.hide();
  appIcon = nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(traySvg()).toString("base64")}`);
  registerIpc();
  createWindow();
  createTray();
  const registered = globalShortcut.register(HOTKEY, hotkeyAction);
  if (!registered) {
    showWindow();
    sendToRenderer("textai:stream", { type: "error", error: `Could not register ${HOTKEY}; another app may already use it. Change that app's shortcut and restart TextAI.` });
  }
  await loadSettings().catch((error) => {
    showWindow();
    sendToRenderer("textai:stream", { type: "error", error: `Could not read encrypted settings: ${error.message}` });
  });
  app.on("activate", showWindow);
});

app.on("will-quit", () => {
  quitting = true;
  globalShortcut.unregisterAll();
});

app.on("before-quit", () => { quitting = true; });
