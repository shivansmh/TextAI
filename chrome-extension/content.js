// Injected only after the user invokes TextAI. No page content is collected in the background.
if (!globalThis.__textAiSelectionReaderInstalled) {
  globalThis.__textAiSelectionReaderInstalled = true;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "TEXTAI_READ_SELECTION") return false;

    const selection = globalThis.getSelection?.()?.toString() ?? "";
    sendResponse({ text: selection.trim() });
    return false;
  });
}
