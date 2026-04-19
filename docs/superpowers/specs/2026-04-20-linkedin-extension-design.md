# LinkedIn Chrome Extension Design — linkdm

**Date:** 2026-04-20
**Status:** Approved

---

## Overview

A Chrome extension that automatically sends LinkedIn DMs to people who commented on a specific post. The extension runs silently in the background while LinkedIn is open, reads active campaigns from the Convex backend, works through the commenter list, and reports every action to the dashboard in real-time.

---

## Why Not the Official LinkedIn API

LinkedIn's official Messages API is partner-gated, requires explicit human action per message, and cannot be used for automated campaigns. All major LinkedIn automation tools (Waalaxy, Dux-Soup, LinkedHelper) use LinkedIn's internal Voyager API instead — the same API LinkedIn's own web app uses. A Chrome extension content script running on `linkedin.com` can call Voyager endpoints using the user's existing session cookies (same-origin — cookies attach automatically, no manual auth required).

---

## Stack

| Layer | Technology |
|---|---|
| Extension | Chrome Extension Manifest V3 |
| Background | Service Worker + `chrome.alarms` (keep-alive) |
| LinkedIn interaction | Content Script → Voyager API (`fetch`, same-origin) |
| Backend | Convex (existing) — HTTP endpoints |
| Dashboard | Next.js (existing) — Convex real-time subscriptions |

---

## Architecture

```
Chrome Extension (Manifest V3)
  │
  ├── Content Script (runs on linkedin.com/*)
  │     ├── Fetches post commenters via Voyager API
  │     │     GET /voyager/api/feed/comments?...
  │     ├── Sends DMs via Voyager API
  │     │     POST /voyager/api/voyagerMessagingDashMessengerMessages?action=create
  │     │     (cookies attach automatically — user's live session, no manual auth)
  │     ├── Reads JSESSIONID cookie → uses as csrf-token header
  │     └── Keeps service worker alive via open port connection
  │
  └── Service Worker (background)
        ├── Fetches active campaigns from Convex on startup
        ├── Manages DM queue — who to DM next, skip already-DM'd profiles
        ├── Pacing — random 30–90s delays between sends (human-like behaviour)
        ├── Reports each DM result to Convex in real-time
        ├── Sends Chrome notifications for key events (limit reached, errors)
        └── Stay-alive: chrome.alarms ping every 20s + open port from content script

Convex Backend (existing)
  ├── campaigns table
  ├── dmLog table
  └── HTTP endpoints — extension calls these (service workers cannot use the React SDK)

Next.js Dashboard (existing)
  └── Subscribes to dmLog → live activity feed as DMs are sent
```

---

## Data Model

### `campaigns` table (new fields added to existing table)

| Field | Type | Notes |
|---|---|---|
| `userId` | string | Owner of the campaign |
| `postUrl` | string | LinkedIn post URL to read commenters from |
| `messageTemplate` | string | DM text (plain string for now) |
| `keywordFilter` | string? | Optional — only DM commenters whose comment contains this word |
| `dailyLimit` | number | Max DMs per day, default 20 |
| `status` | `"active"` \| `"paused"` | Paused by user or system |

### `dmLog` table (new)

| Field | Type | Notes |
|---|---|---|
| `campaignId` | Id\<"campaigns"\> | Which campaign triggered this |
| `profileId` | string | LinkedIn member URN |
| `profileName` | string | Display name |
| `profileUrl` | string | LinkedIn profile URL |
| `status` | `"sent"` \| `"failed"` \| `"skipped"` | Outcome |
| `sentAt` | number | Unix timestamp |
| `errorMessage` | string? | Set on `failed` only |

---

## Extension ↔ Convex Communication

Service workers cannot use the Convex React SDK. The extension communicates via two Convex HTTP action endpoints:

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/extension/campaigns` | GET | Fetch active campaigns for the authenticated user |
| `/api/extension/dmLog` | POST | Record a DM result (sent / failed / skipped) |

Authentication: the extension passes the user's Convex session token (stored in `chrome.storage.local` after login) as a Bearer token.

---

## DM Sending Flow

1. Service worker wakes on `chrome.alarms` tick (every 20s)
2. Checks if a LinkedIn tab is open — if not, waits
3. Fetches active campaigns from Convex
4. For each campaign, tells content script: "fetch commenters for this post URL"
5. Content script calls Voyager API, returns commenter list (profileId, name, comment text)
6. Service worker filters out:
   - Profiles already in `dmLog` for this campaign
   - Profiles whose comment doesn't match `keywordFilter` (if set)
   - If daily limit reached → stops, sends "limit reached" notification
7. Service worker picks the next eligible profile, tells content script: "DM this person"
8. Content script calls Voyager messaging endpoint
9. Content script reports result → service worker → Convex `dmLog` mutation → dashboard updates live
10. Service worker waits a random 30–90s delay, then repeats from step 3

---

## Voyager API Details

**Fetch commenters:**
```
GET https://www.linkedin.com/voyager/api/feed/comments?count=100&start=0&q=comments&updateId=<post-urn>
Headers:
  csrf-token: <JSESSIONID stripped of quotes>
  x-restli-protocol-version: 2.0.0
  accept: application/vnd.linkedin.normalized+json+2.1
```

**Send DM:**
```
POST https://www.linkedin.com/voyager/api/voyagerMessagingDashMessengerMessages?action=create
Headers:
  csrf-token: <JSESSIONID stripped of quotes>
  x-restli-protocol-version: 2.0.0
  content-type: application/json
Body: { recipients: [profileUrn], body: { text: messageTemplate } }
```

The content script reads `document.cookie` on `linkedin.com` to extract JSESSIONID for the CSRF token. The `li_at` session cookie attaches automatically via the browser.

---

## Service Worker Keep-Alive

Chrome terminates idle MV3 service workers after ~30 seconds. Two mechanisms prevent this:

1. **Open port:** Content script calls `chrome.runtime.connect()` on load — an active port keeps the worker alive
2. **`chrome.alarms`:** Alarm fires every 20 seconds, waking the worker if it slept

---

## Notifications

All notifications use plain, friendly language — no technical terms or error codes.

| Event | Channel | Message |
|---|---|---|
| Daily limit reached | Dashboard banner + Chrome notification | *"🎉 Great news! Your campaign sent its X DMs for today. It'll automatically pick up again tomorrow morning."* |
| LinkedIn session expired | Dashboard banner + Chrome notification | *"⚠️ Your LinkedIn connection needs a refresh. Just open LinkedIn in your browser and your campaigns will resume automatically."* |
| Voyager API error (transient) | Dashboard only | *"⚠️ A few DMs couldn't be sent — LinkedIn may have been temporarily unavailable. Your campaign is still running."* |
| Campaign complete (all commenters DM'd) | Dashboard banner + Chrome notification | *"✅ Campaign complete! You've messaged everyone who commented on your post. Check your LinkedIn inbox for replies."* |
| DM sent successfully | Live activity feed only (silent) | Name + timestamp shown in dashboard feed, no popup |

**Chrome notification rules:**
- Only shown when the linkdm dashboard tab is not in focus
- Clicking any notification opens the dashboard directly
- No notification for every individual DM — only for milestone events

---

## Error Handling

| Scenario | Behaviour |
|---|---|
| LinkedIn tab not open | Service worker waits, does not error |
| Session expired (401) | Content script reports `failed`, service worker pauses campaign, sends reconnect notification |
| Voyager endpoint changed | `fetch` returns unexpected response → logged as `failed`, campaign continues for other profiles |
| Daily limit reached | Service worker stops queue for that campaign until midnight, sends friendly notification |
| All commenters already DM'd | Campaign auto-completes, sends "campaign complete" notification |
| Port disconnects (tab closed) | Service worker detects disconnect, pauses DM queue, resumes when LinkedIn tab reopens |

---

## Out of Scope (for now)

- Personalised message templates (e.g. `Hi {{firstName}}`) — plain text only for now
- Multiple LinkedIn accounts per user
- Scraping commenters from multiple posts per campaign
- Reply detection / follow-up sequences
- Anti-detection browser fingerprinting
- Extension auto-update mechanism

---

## Success Criteria

- Extension sends DMs automatically while LinkedIn is open, without user interaction
- Only DMs commenters who match the keyword filter (if set)
- Never DMs the same person twice for the same campaign
- Dashboard updates in real-time as DMs are sent
- Daily limit enforced with a friendly notification when reached
- Session expiry detected and communicated clearly to the user
- Service worker stays alive for the duration of an automation session
