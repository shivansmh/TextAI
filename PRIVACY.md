# TextAI Privacy Policy

**Last updated: October 22, 2026**

TextAI is a Chrome extension that explains text selected by the user. This policy describes the extension and the TextAI API operated by the publisher.

## Information TextAI processes

- When the user invokes TextAI, the extension reads the currently selected text and sends that text to the publisher's TextAI API to produce an answer. The API forwards the prompt to Groq using the publisher's server-side API key. Do not select sensitive information unless you are comfortable sending it to these services.
- The extension creates a random installation ID and stores it in Chrome extension local storage. The backend uses the ID to track that installation's daily request count.
- The backend stores the installation ID, creation/last-seen timestamps, and aggregate successful request counts by UTC date. It does not store the selected prompt or generated answer in its quota database. Temporary IP throttling is kept in process memory and is not written to the SQLite database.
- The extension stores the last answer, current draft, and most recently retrieved quota locally so the popup can show the result after a shortcut or context-menu request.

## How information is used and shared

Selected text is used to generate the requested answer and is shared with the TextAI API operator and Groq as the service provider. The extension does not sell personal information, run ads, or collect browsing history. The content script is injected only after the user invokes TextAI; it does not continuously read page contents.

Review Groq's current privacy and data-processing terms before deployment and include any provider disclosures required for the intended audience. TextAI's publisher is responsible for the server-side Groq account, API usage, applicable spending controls, and the accuracy of the Store listing.

## Retention and controls

Daily quota counters older than 90 days are deleted at API startup and during daily cleanup. Installation records inactive for more than 365 days are deleted during the same cleanup, along with their associated counters. The extension ID is used for quota tracking and is not a verified identity. Removing the extension clears its local ID and last result, but does not immediately erase the server-side record; an inactive record expires under the schedule above.

## Security

The Groq API key is stored only in the backend's secret environment and must never be included in the Chrome extension package. The backend should be served over HTTPS and configured with an allow-list for the published extension origin. CORS is not authentication; the service operator must deploy appropriate rate, quota, and spending limits.

## Changes and contact

The publisher should update this policy when data flows, providers, retention, or account features change. Before submitting to the Chrome Web Store, replace or supplement this policy with the publisher's legal name, support/privacy contact, and final deployed API details.
