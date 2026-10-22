# TextAI

TextAI is being prepared as a Chrome extension backed by a small Node.js API. The original `TextAI.py` desktop app remains in the repository; the new release candidate lives in `chrome-extension/` and `server/`.

The browser extension never receives or stores the Groq API key. It sends the selected text to the TextAI API, which applies the original concise-explanation system prompt and calls Groq with a server-side key. The API stores only a random installation ID and daily request counters; it does not save prompts or answers in its database.

## What is implemented

- A Manifest V3 popup with a dark terminal-style UI, selected-text input, answer panel, allowance bar, and live countdown.
- A context-menu item (**Explain with TextAI**) and a browser shortcut (default **Ctrl+Shift+Y** on Windows/Linux, **Command+Shift+Y** on macOS). The shortcut can be changed at `chrome://extensions/shortcuts`.
- A content script injected only after the user invokes TextAI. It reads the current selection and does not monitor pages in the background.
- A Node/Express proxy for Groq, backed by SQLite daily counters. The Groq key stays on the server.
- A default allowance of 50 successful answers per extension installation per UTC day. The popup shows the remaining count and time to the next reset at 00:00 UTC. `DAILY_LIMIT` can change the limit.
- A temporary per-IP request throttle and a maximum input length. Provider failures do not count against the daily allowance.
- Quota-date rows older than 90 days and installation records inactive for more than 365 days are pruned at startup and daily.
- Docker Compose files for a single API instance with persistent SQLite storage.

## Important: this is per installation, not a verified human account

Following the supplied SOP, this first version identifies an installation with a random UUID stored by Chrome. That is pseudonymous, not authentication: a user who clears extension storage, reinstalls the extension, or changes browser profiles can get a new allowance. Network-level throttling makes casual abuse harder, but it cannot turn an anonymous client ID into a strict per-person limit.

The Groq credential is the operator's master key. Every answer consumes the operator's Groq quota/billing. **Do not publish a public extension until you have deployed the backend, set provider spending/rate controls, and tested the abuse limits.** For a strict account-based quota, the next step is Google sign-in with server-side token verification, not a client-generated ID. The initial implementation deliberately does not pretend that an installation ID is a verified user.

## Local development

Requirements: Node.js 20+, npm, and Google Chrome. Use a Groq API key only on the backend.

1. In `server/`, install dependencies and create a local environment file:

   ```sh
   cd server
   npm install
   cp .env.example .env
   ```

   Put the Groq key in `server/.env` (never in `chrome-extension/`). Keep the existing model default or set `GROQ_MODEL`. `.env` and the SQLite database are git-ignored.

2. Start the backend from `server/`:

   ```sh
   npm run dev
   ```

   The API listens at `http://localhost:8787`; `GET /health` should return `{"status":"ok"}`.

3. In `chrome-extension/config.js`, set `apiBaseUrl` to `http://localhost:8787`. For unpacked development only, add `http://localhost:8787/*` to `host_permissions` in `chrome-extension/manifest.json`. Load the `chrome-extension/` directory from `chrome://extensions` with Developer mode and **Load unpacked**.

4. Copy the extension ID shown in `chrome://extensions` to `ALLOWED_ORIGINS` in `server/.env` as `chrome-extension://<extension-id>`, then restart the API. The extension popup, context menu, and shortcut can now use the local proxy.

5. Run the test suite from the repository root:

   ```sh
   npm install --prefix server
   npm test
   ```

   Tests use a fake Groq response and an in-memory database; no real key or provider call is needed.

## Deploying a backend

A portable single-instance Docker setup is included. Configure a real HTTPS API URL in `chrome-extension/config.js` and the same exact host in `chrome-extension/manifest.json` before making a store package. On the server, copy `server/.env.example` to `server/.env`, set the real `GROQ_API_KEY`, and set `ALLOWED_ORIGINS` to the exact published origin, `chrome-extension://<Chrome Web Store extension ID>`.

Then deploy with a persistent Docker volume:

```sh
docker compose up -d --build
```

The included Compose file persists SQLite data in a named volume. Put the API behind HTTPS (for example, a TLS reverse proxy or HTTPS-capable container host); do not publish the raw HTTP port to the public internet. Keep the service to **one instance** with SQLite. Multiple app replicas need shared Postgres or another transactional quota store before scaling.

The extension ID is assigned by Chrome Web Store on the first upload. Do not publicly publish until that exact ID is allowed by the backend. For local unpacked development, allow the local extension ID as well. `ALLOWED_ORIGINS` is a browser CORS allow-list, not authentication; non-browser clients can call the API too, which is why the install-ID limitation and server-side throttles matter.

## Chrome Web Store package

Before packaging, replace the example backend URL in both `chrome-extension/config.js` and `chrome-extension/manifest.json`. Keep only the exact HTTPS backend host in `host_permissions` (remove the temporary localhost permission). After a Chrome Web Store ID exists, add its origin to backend `ALLOWED_ORIGINS`, redeploy, and test. Then build the upload archive:

```sh
npm run package:extension
```

This creates `dist/textai-chrome-extension.zip`. It contains only the extension files. Add the publicly accessible `PRIVACY.md` URL to the Store listing and accurately disclose that selected text is sent to your backend and Groq.

The packager is a Node-only script (no external `zip` command) and refuses to build if the API URL is still an example/HTTP address or the manifest has extra host permissions.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `GROQ_API_KEY` | unset | Secret server-side Groq key; generation remains disabled until set. |
| `GROQ_MODEL` | `openai/gpt-oss-20b` | Groq model ID. |
| `DAILY_LIMIT` | `50` | Successful requests per installation and UTC day. |
| `MAX_INPUT_CHARS` | `8000` | Maximum selected text sent per request. |
| `IP_REQUESTS_PER_WINDOW` | `30` | Temporary requests allowed per IP window. |
| `IP_RATE_WINDOW_MS` | `900000` | Temporary IP window in milliseconds (15 minutes). |
| `ALLOWED_ORIGINS` | empty | Comma-separated, exact extension origins allowed by browser CORS. |
| `DATABASE_PATH` | `./data/textai.sqlite` | SQLite path; use a persistent disk/volume in production. |
| `PORT` | `8787` | API listen port. |
| `TRUST_PROXY` | `1` | Trusted proxy hops for correct IP rate limiting; set according to the host. |

## Project structure

```text
TextAI.py                         # Original Tkinter desktop version
chrome-extension/
  manifest.json                   # Manifest V3 permissions and browser shortcut
  config.js                       # Public API URL only; no secrets
  service-worker.js               # ID, menus, shortcut, API client, quota state
  content.js                      # On-demand selection reader
  popup.html / popup.css / popup.js
  math.js                         # LaTeX-to-Unicode formatter
  test/math.test.js
server/
  src/config.js                   # Environment configuration
  src/app.js                      # Express routes, quota enforcement, Groq proxy
  src/usage-store.js              # Atomic SQLite quota accounting
  src/server.js                   # Startup/shutdown
  test/api.test.js
  Dockerfile / .env.example
```
