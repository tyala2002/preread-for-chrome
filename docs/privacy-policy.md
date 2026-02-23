# Privacy Policy — Preread

_Last updated: 2026-02-23_

## Overview

Preread ("the Extension") is a Chrome extension that helps users research books by finding
related articles and YouTube videos, and adding them as sources to NotebookLM.

**The Extension does not collect, store, or transmit any personal information to the developer's servers.**
The only data sent to external services is the book title (as a search query).

---

## Data Transmitted to External Services

The Extension sends data to the following services only when the user explicitly triggers an action.

| Destination | Data sent | When |
|---|---|---|
| Tavily Search API | Book title (search query) | On "Search sources" button press |
| YouTube (youtube.com) | Book title (search query) | On "Search sources" button press |
| NotebookLM (notebooklm.google.com) | Selected URLs, book title, temporary auth token | On "Add to NotebookLM" button press |

> The NotebookLM auth token is read ephemerally from the notebooklm.google.com page,
> used only for that single operation, and never stored or forwarded elsewhere.

---

## Data Stored Locally

The following data is stored only in the user's browser and is never sent to the developer's servers.

| Data | Storage | Purpose |
|---|---|---|
| Tavily API key | `chrome.storage.sync` | Web article search |
| Book + NotebookLM URL history | `chrome.storage.local` | History display in popup and options page |

> Data in `chrome.storage.sync` may be synced across the user's own Chrome devices via their Google account.

---

## Data We Do NOT Collect

- Personal identifiable information (name, email, etc.)
- Browsing or search history
- Location data
- Payment or financial information
- Analytics or behavioral tracking data

The Extension uses no advertising networks, analytics tools, or third-party trackers.
No data is sold or shared with any third party.

---

## Chrome Permissions

| Permission | Reason |
|---|---|
| `activeTab` | Determine if the current tab is an Amazon book page |
| `scripting` | Extract the book title from the Amazon page DOM |
| `storage` | Save API key and book history in the browser |
| `tabs` | Check if a NotebookLM tab is already open |
| `clipboardWrite` | Copy selected URLs to clipboard |
| `notifications` | Notify the user when sources are successfully added |

---

## Third-Party Services

| Service | Provider | Privacy Policy |
|---|---|---|
| Tavily Search API | Tavily | https://tavily.com/privacy |
| YouTube | Google LLC | https://policies.google.com/privacy |
| NotebookLM | Google LLC | https://policies.google.com/privacy |
| Amazon | Amazon.com, Inc. | https://www.amazon.com/gp/help/customer/display.html?nodeId=468496 |

---

## Changes to This Policy

If this policy is updated, the "Last updated" date at the top of this page will be revised.
Material changes will also be noted in the Chrome Web Store update history.
Continued use of the Extension after changes constitutes acceptance of the updated policy.

---

## Contact

If you have questions about this privacy policy, please open an issue on the GitHub repository.
