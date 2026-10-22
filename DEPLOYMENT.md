# Backend and Chrome Store release notes

## API contract

`GET /health` returns service readiness without exposing configuration.

`GET /api/quota` requires `X-Client-Id: <UUID>` and returns:

```json
{
  "quota": {
    "limit": 50,
    "used": 4,
    "remaining": 46,
    "resetAt": "2026-10-23T00:00:00.000Z",
    "secondsUntilReset": 25200,
    "resetTimezone": "UTC"
  }
}
```

`POST /api/generate` requires the same header and a JSON body such as `{"text":"Explain this paragraph"}`. Success returns `answer` and `quota`. A daily-limit response uses HTTP 429 with `code: "daily_quota_exhausted"`, the current quota, and the next reset time. Provider failures return a non-2xx error and release the reserved daily count.

The counter increments atomically before an upstream call, then is rolled back if Groq fails. Only successful answers count toward the daily allowance. The reset boundary is midnight UTC, not the user's local time.

## Before public release

1. Deploy the backend on a host that provides HTTPS and a persistent volume. Keep it as one API instance while using SQLite. The Groq key belongs in the host's secret manager, not in Git, the extension, Docker image, or browser storage.
2. Review Groq's usage limits and billing controls. The server's 50-request allowance is not a spending guarantee because IDs are anonymous and can be regenerated.
3. Set `GROQ_API_KEY`, `GROQ_MODEL`, `DAILY_LIMIT`, `DATABASE_PATH`, `TRUST_PROXY`, and an initial `ALLOWED_ORIGINS` for development. Test the server and the local extension end to end.
4. Set the deployed HTTPS API URL in both `chrome-extension/config.js` and the extension host permission in `manifest.json`, then package and upload the extension as a draft/unpublished Store item to obtain its permanent extension ID.
5. Add `chrome-extension://<permanent-extension-id>` to `ALLOWED_ORIGINS`, redeploy, reinstall the Store build, and test quota, provider outage, quota exhaustion, and refresh timing. Publish only after these pass.
6. Publish the privacy policy at a stable public URL, provide publisher/support contact information, and complete the Chrome Web Store privacy/data-use disclosures.

## Per-install quota caveat

The initial implementation has no account registration. A client-generated UUID is a per-install identifier only; it can be replaced by clearing extension storage, reinstalling, using a second Chrome profile, or calling the API directly. CORS only constrains browser JavaScript and is not access control. The in-memory IP limiter is a friction layer and resets when the server restarts. Before claiming strict per-person quotas or relying on the service for an unrestricted public launch, add account authentication (for example, Google sign-in with ID-token verification on the backend), bind usage to the verified subject, and consider a shared Postgres quota database and stronger abuse controls.
