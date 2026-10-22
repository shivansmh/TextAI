# TextAI Desktop (Electron)

The Electron app runs in the system tray and opens a frameless, always-on-top dark window when you press the global hotkey. It reuses the original TextAI system prompt and the LaTeX-to-Unicode formatter. Groq requests stream into a Markdown-rendered answer panel.

## Hotkeys

- **Windows/Linux:** `Ctrl+Alt+G`
- **macOS:** `Cmd+Shift+G`

Close/hide the floating window to return it to the tray. Use the tray menu or the title-bar power button to quit.

When the hotkey is pressed, TextAI saves the clipboard formats, briefly clears the clipboard, simulates the platform copy shortcut, reads the selected text, then restores the saved clipboard formats before sending the selection. It does not run a background screen reader or keep a history of selected text.

### Selection permissions and platform notes

- **macOS:** macOS may ask for Accessibility/Automation permission to let TextAI send the copy shortcut. Approve TextAI in System Settings → Privacy & Security → Accessibility (and Automation, if prompted).
- **Windows:** TextAI uses Windows PowerShell's SendKeys to issue Ctrl+C to the currently focused app.
- **Linux:** install `xdotool`. Some Wayland desktops block synthetic global keystrokes; select the text, copy it yourself, then paste into TextAI if the desktop denies the simulated shortcut.
- Some protected apps, elevated windows, remote desktops, and secure fields intentionally reject simulated keystrokes. If there is no selection, TextAI tells you instead of submitting a blank prompt.

## Groq key and privacy

Open the gear button and enter your own Groq API key and model ID. The key passes through the app's isolated local IPC bridge to Electron's main process, where it is encrypted by `safeStorage` and written only as ciphertext into the current OS user's TextAI application data directory. It is not stored in source code, command-line arguments, or a plaintext file. Windows uses OS-protected storage (DPAPI), macOS uses Keychain, and Linux must provide GNOME Secret Service/libsecret or KWallet. TextAI refuses to save a key if Electron reports an insecure or unknown Linux backend.

The app sends the selected text, configured model, and original system prompt directly from the Electron main process to `https://api.groq.com/openai/v1/chat/completions`. There is no TextAI-operated proxy, account, or quota. Groq applies the limits and terms for the user's own account/key. Avoid sending sensitive text unless you accept the provider's processing terms.

## Run locally

Requirements: Node.js 22+ and npm.

```sh
cd desktop
npm ci
npm start
```

For Linux, `xdotool` is only needed for automatic selection capture. The API key is configured in the app's Settings panel; no shell environment variable is required.

## Tests and packaging

```sh
npm test
npm run dist:win   # Windows NSIS installer: release/TextAI-Setup-1.0.0.exe
npm run dist:mac   # macOS disk image: release/TextAI-1.0.0-<arch>.dmg
```

Build the Windows installer on Windows and the macOS DMG on macOS. macOS builds are not generally produced as a supported cross-build from Windows/Linux. A GitHub Actions workflow (`.github/workflows/desktop-build.yml`) uses native Windows and macOS runners. Run it with **Actions → Build TextAI Desktop → Run workflow**, or push a tag matching `desktop-v*`; download the two artifacts from that workflow run.

For public distribution, sign and notarize the macOS app and sign the Windows installer with your publisher certificates. The current workflow creates unsigned development/release artifacts.

## Project files

```text
main.cjs                 # tray, global hotkey, clipboard capture, encrypted settings, Groq SSE
preload.cjs              # narrow contextBridge API
math.js                  # shared LaTeX-to-Unicode parser from the browser version
renderer/
  index.html              # frameless dark window and settings panel
  renderer.js             # sanitized Markdown and paced word streaming
  styles.css              # dark UI
```
