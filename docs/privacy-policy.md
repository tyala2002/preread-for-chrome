# Privacy Policy — Preread

_Last updated: 2026-02-23_

## Overview

Preread ("the Extension") is a Chrome extension that helps users research books by finding related articles and YouTube videos, and adding them to NotebookLM.

---

## Data We Collect

The Extension does **not** collect, store, or transmit any personal information to our servers.

### Data stored locally on your device

The following data is stored in `chrome.storage.sync` (synced across your Chrome devices via your Google account):

| Data | Purpose |
|------|---------|
| Tavily API key | Web article search |
| YouTube Data API key | YouTube video search |
| Google Custom Search API key / Engine ID | Alternative web search (optional) |
| SerpAPI key | Alternative web search (optional) |
| Selected search provider | User preference |

**These keys are stored only in your browser and are never sent to our servers.**

---

## Data We Do Not Collect

- We do not collect your name, email address, or any personally identifiable information.
- We do not track your browsing history.
- We do not use analytics or third-party tracking.
- We do not sell data to any third parties.

---

## Third-Party Services

The Extension communicates with the following external services on your behalf:

| Service | Purpose | Privacy Policy |
|---------|---------|----------------|
| Amazon (amazon.co.jp / amazon.com) | Read book title from the current page | [Amazon Privacy](https://www.amazon.com/gp/help/customer/display.html?nodeId=468496) |
| Tavily API | Search for related articles | [Tavily Privacy](https://tavily.com/privacy) |
| YouTube Data API v3 | Search for related videos | [Google Privacy](https://policies.google.com/privacy) |
| NotebookLM (notebooklm.google.com) | Add sources to your notebook | [Google Privacy](https://policies.google.com/privacy) |

API requests to these services include only the book title as a search query. Your API keys are sent directly from your browser to each respective service and are not routed through our servers.

---

## Permissions

The Extension requests the following Chrome permissions:

| Permission | Reason |
|-----------|--------|
| `activeTab` | Read the book title from the current Amazon page |
| `scripting` | Inject scripts to interact with Amazon and NotebookLM pages |
| `storage` | Save your API key settings locally |
| `tabs` | Open and manage the NotebookLM tab |
| `clipboardWrite` | Copy URLs to your clipboard |
| `notifications` | Show a notification when sources are added |

---

## Changes to This Policy

If this policy is updated, the "Last updated" date at the top of this page will be revised. Continued use of the Extension after changes constitutes acceptance of the updated policy.

---

## Contact

If you have any questions about this privacy policy, please open an issue on the GitHub repository.
