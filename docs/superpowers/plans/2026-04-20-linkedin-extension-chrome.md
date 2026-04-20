# LinkedIn Chrome Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Chrome Extension MV3 that runs silently in the background, reads active campaigns from Convex, sends LinkedIn DMs to post commenters via the Voyager API, and reports every result in real-time.

**Architecture:** A service worker (`background.js`) runs an alarm-based loop every 20s — it fetches active campaigns from Convex, asks the content script to fetch commenters from LinkedIn's Voyager API, picks the next eligible commenter, and tells the content script to send the DM. A content script (`content.js`) runs on every LinkedIn page, handles all Voyager API calls (same-origin cookies attach automatically), and keeps the service worker alive via an open port. A popup (`popup.html` + `popup.js`) lets the user paste their extension token and shows connection status.

**Tech Stack:** Chrome Extension Manifest V3 | Service Worker + `chrome.alarms` | Content Script (vanilla JS, same-origin Voyager API calls) | `chrome.storage.local` for token + dedup cache | `chrome.notifications` for milestone alerts

---

## File Map

| File | Purpose |
|---|---|
| `extension/manifest.json` | MV3 manifest — permissions, service worker, content scripts, popup |
| `extension/background.js` | Service worker: alarm loop, campaign fetch from Convex, DM orchestration, notifications |
| `extension/content.js` | Content script: Voyager API calls, keep-alive port, CSRF token extraction |
| `extension/popup.html` | Extension popup markup |
| `extension/popup.js` | Popup: token paste/save, connected/disconnected display |
| `extension/icons/icon16.png` | 16×16 extension icon |
| `extension/icons/icon48.png` | 48×48 extension icon |
| `extension/icons/icon128.png` | 128×128 extension icon |
| `extension/__tests__/content-utils.test.js` | Node.js tests for pure parsing functions |

---

### Task 1: Extension scaffold

**Files:**
- Create: `extension/manifest.json`
- Create: `extension/icons/icon16.png`, `icon48.png`, `icon128.png`
- Create: `extension/background.js` (stub)
- Create: `extension/content.js` (stub)
- Create: `extension/popup.html` (stub)
- Create: `extension/popup.js` (stub)

- [ ] **Step 1: Create the extension directory structure**

```bash
cd "D:\pk\Work\LinkedIn Auto-DM Tool\linkdm\.worktrees\beta-login"
mkdir -p extension/icons extension/__tests__
```

- [ ] **Step 2: Download placeholder icons**

```bash
cd "D:\pk\Work\LinkedIn Auto-DM Tool\linkdm\.worktrees\beta-login"
curl -L "https://placehold.co/16x16/0077B5/white/png" -o extension/icons/icon16.png
curl -L "https://placehold.co/48x48/0077B5/white/png" -o extension/icons/icon48.png
curl -L "https://placehold.co/128x128/0077B5/white/png" -o extension/icons/icon128.png
```

Expected: Three PNG files appear in `extension/icons/`. If `curl` isn't available, use a browser to download from those URLs and save with those filenames.

- [ ] **Step 3: Create manifest.json**

Create `extension/manifest.json`:
```json
{
  "manifest_version": 3,
  "name": "linkdm",
  "version": "0.1.0",
  "description": "Automatically send LinkedIn DMs to post commenters",
  "permissions": [
    "alarms",
    "storage",
    "tabs",
    "notifications"
  ],
  "host_permissions": [
    "https://www.linkedin.com/*",
    "https://*.convex.site/*"
  ],
  "background": {
    "service_worker": "background.js"
  },
  "content_scripts": [
    {
      "matches": ["https://www.linkedin.com/*"],
      "js": ["content.js"],
      "run_at": "document_idle"
    }
  ],
  "action": {
    "default_popup": "popup.html",
    "default_icon": {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  },
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  }
}
```

- [ ] **Step 4: Create stub files**

Create `extension/background.js`:
```js
// linkdm service worker — stub
console.log("[linkdm] Service worker loaded");
```

Create `extension/content.js`:
```js
// linkdm content script — stub
console.log("[linkdm] Content script loaded");
```

Create `extension/popup.html`:
```html
<!DOCTYPE html>
<html><body><p>linkdm — coming soon</p></body></html>
```

Create `extension/popup.js`:
```js
// linkdm popup — stub
```

- [ ] **Step 5: Load extension in Chrome and verify it loads**

1. Open Chrome → `chrome://extensions/`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** → select `D:\pk\Work\LinkedIn Auto-DM Tool\linkdm\.worktrees\beta-login\extension`
4. The **linkdm** extension should appear with a blue "L" icon
5. Click the icon → popup shows "linkdm — coming soon"
6. Open Chrome DevTools for the service worker: on the extensions page, click the **Service Worker** link under linkdm
7. Console should show: `[linkdm] Service worker loaded`
8. Navigate to `https://www.linkedin.com/` → open DevTools Console → should show: `[linkdm] Content script loaded`

Expected: Extension loads without errors.

- [ ] **Step 6: Commit**

```bash
cd "D:\pk\Work\LinkedIn Auto-DM Tool\linkdm\.worktrees\beta-login"
git add extension/
git commit -m "feat: add Chrome extension scaffold with manifest and stub files"
```

---

### Task 2: Popup (token management)

**Files:**
- Modify: `extension/popup.html`
- Modify: `extension/popup.js`

- [ ] **Step 1: Write popup.html**

Replace the contents of `extension/popup.html` with:
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>linkdm</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      width: 288px;
      padding: 16px;
      margin: 0;
      color: #111827;
    }
    h2 { margin: 0 0 12px; font-size: 16px; color: #0077B5; }
    .status {
      padding: 10px 12px;
      border-radius: 6px;
      margin-bottom: 12px;
      font-size: 14px;
      line-height: 1.4;
    }
    .connected { background: #ecfdf5; color: #065f46; }
    .disconnected { background: #fffbeb; color: #92400e; }
    input {
      width: 100%;
      padding: 8px 10px;
      border: 1px solid #d1d5db;
      border-radius: 6px;
      font-size: 13px;
      margin-bottom: 8px;
      outline: none;
    }
    input:focus { border-color: #0077B5; }
    button {
      width: 100%;
      padding: 8px;
      background: #0077B5;
      color: white;
      border: none;
      border-radius: 6px;
      font-size: 14px;
      cursor: pointer;
      font-weight: 500;
    }
    button:hover { background: #005885; }
    button.danger { background: #dc2626; }
    button.danger:hover { background: #b91c1c; }
    .hint { font-size: 12px; color: #6b7280; margin-top: 10px; }
    .hint a { color: #0077B5; text-decoration: none; }
  </style>
</head>
<body>
  <h2>linkdm</h2>
  <div id="status" class="status disconnected">
    ⚠️ Not connected — paste your token below.
  </div>
  <input id="token-input" type="text" placeholder="lnkdm_..." />
  <button id="action-btn">Connect</button>
  <p class="hint">
    Get your token from
    <a href="https://localhost:3000/dashboard/settings" target="_blank">
      linkdm dashboard → Settings
    </a>.
  </p>
  <script src="popup.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write popup.js**

Replace the contents of `extension/popup.js` with:
```js
const statusEl = document.getElementById("status");
const tokenInput = document.getElementById("token-input");
const actionBtn = document.getElementById("action-btn");

async function init() {
  const { token } = await chrome.storage.local.get("token");
  if (token) {
    showConnected();
  } else {
    showDisconnected();
  }
}

function showConnected() {
  statusEl.className = "status connected";
  statusEl.textContent = "✅ Connected — campaigns are running automatically.";
  tokenInput.style.display = "none";
  actionBtn.textContent = "Disconnect";
  actionBtn.className = "danger";
  actionBtn.onclick = disconnect;
}

function showDisconnected() {
  statusEl.className = "status disconnected";
  statusEl.textContent = "⚠️ Not connected — paste your token below.";
  tokenInput.style.display = "";
  actionBtn.textContent = "Connect";
  actionBtn.className = "";
  actionBtn.onclick = connect;
}

async function connect() {
  const token = tokenInput.value.trim();
  if (!token.startsWith("lnkdm_")) {
    statusEl.textContent =
      "⚠️ Invalid token format. Copy it exactly from your linkdm dashboard.";
    return;
  }
  await chrome.storage.local.set({ token });
  showConnected();
}

async function disconnect() {
  await chrome.storage.local.remove(["token", "dmedProfiles", "nextSendAt"]);
  tokenInput.value = "";
  showDisconnected();
}

actionBtn.onclick = connect;
init();
```

- [ ] **Step 3: Reload and manually verify the popup**

1. Go to `chrome://extensions/` → click the **Reload** button (↻) on the linkdm card
2. Click the linkdm icon in Chrome's toolbar
3. **Not connected state:** popup shows amber "⚠️ Not connected" + token input + Connect button
4. Type `hello` in the input, click Connect → popup shows "⚠️ Invalid token format"
5. Type `lnkdm_abc123` in the input, click Connect → popup shows green "✅ Connected"
6. Close and reopen the popup — it should still show "✅ Connected" (token persisted in storage)
7. Click Disconnect → returns to not-connected state, input is blank

Expected: All states work correctly.

- [ ] **Step 4: Commit**

```bash
cd "D:\pk\Work\LinkedIn Auto-DM Tool\linkdm\.worktrees\beta-login"
git add extension/popup.html extension/popup.js
git commit -m "feat: add extension popup with token management"
```

---

### Task 3: Content script (Voyager API)

**Files:**
- Modify: `extension/content.js`
- Create: `extension/__tests__/content-utils.test.js`

- [ ] **Step 1: Write failing tests for pure utility functions**

Create `extension/__tests__/content-utils.test.js`:
```js
// Node.js tests for the pure utility functions used in content.js
// Run with: node extension/__tests__/content-utils.test.js

const assert = require("assert");

// ── Pure functions (duplicated here for testing — content.js can't be imported) ──

function extractPostUrn(postUrl) {
  const match = postUrl.match(/urn:li:activity:\d+/);
  return match ? match[0] : null;
}

function getCsrfToken(cookieString) {
  const match = cookieString.match(/JSESSIONID="?([^";]+)"?/);
  return match ? match[1] : null;
}

function parseCommenters(data) {
  const included = data.included || [];
  const profilesByUrn = {};
  for (const item of included) {
    if (item.$type && item.$type.includes("MiniProfile")) {
      profilesByUrn[item.entityUrn] = {
        profileId: item.objectUrn,
        profileName: [item.firstName, item.lastName].filter(Boolean).join(" "),
        profileUrl: item.publicIdentifier
          ? `https://www.linkedin.com/in/${item.publicIdentifier}/`
          : "",
      };
    }
  }
  const seen = new Set();
  const commenters = [];
  for (const item of included) {
    if (!item.$type?.includes("Comment")) continue;
    const memberActor =
      item.commenter?.["com.linkedin.voyager.feed.MemberActor"];
    if (!memberActor) continue;
    const profileUrn = memberActor.miniProfile;
    if (!profileUrn || seen.has(profileUrn)) continue;
    const profile = profilesByUrn[profileUrn];
    if (!profile) continue;
    seen.add(profileUrn);
    commenters.push({ ...profile, commentText: item.commentary?.text || "" });
  }
  return commenters;
}

// ── Tests ──

// extractPostUrn
assert.strictEqual(
  extractPostUrn("https://www.linkedin.com/feed/update/urn:li:activity:7123456789/"),
  "urn:li:activity:7123456789",
  "extractPostUrn: standard /feed/update/ URL"
);
assert.strictEqual(
  extractPostUrn("https://www.linkedin.com/posts/user_urn:li:activity:999-abc_a_activity_/"),
  "urn:li:activity:999",
  "extractPostUrn: /posts/ URL with digits only"
);
assert.strictEqual(
  extractPostUrn("https://www.linkedin.com/feed/"),
  null,
  "extractPostUrn: returns null when no URN present"
);

// getCsrfToken
assert.strictEqual(
  getCsrfToken('li_at=xxxx; JSESSIONID="ajax:1234567890"'),
  "ajax:1234567890",
  "getCsrfToken: quoted JSESSIONID"
);
assert.strictEqual(
  getCsrfToken("li_at=xxxx; JSESSIONID=ajax:1234567890"),
  "ajax:1234567890",
  "getCsrfToken: unquoted JSESSIONID"
);
assert.strictEqual(
  getCsrfToken("li_at=xxxx; lang=en"),
  null,
  "getCsrfToken: returns null when JSESSIONID absent"
);

// parseCommenters
const mockVoyagerResponse = {
  included: [
    {
      $type: "com.linkedin.voyager.identity.shared.MiniProfile",
      entityUrn: "urn:li:fs_miniProfile:ACoAAAxxxxx",
      objectUrn: "urn:li:member:789",
      firstName: "Alice",
      lastName: "Smith",
      publicIdentifier: "alice-smith",
    },
    {
      $type: "com.linkedin.voyager.feed.Comment",
      commentary: { text: "Great post!" },
      commenter: {
        "com.linkedin.voyager.feed.MemberActor": {
          miniProfile: "urn:li:fs_miniProfile:ACoAAAxxxxx",
        },
      },
    },
  ],
};

const commenters = parseCommenters(mockVoyagerResponse);
assert.strictEqual(commenters.length, 1, "parseCommenters: extracts one commenter");
assert.strictEqual(commenters[0].profileId, "urn:li:member:789", "parseCommenters: correct profileId");
assert.strictEqual(commenters[0].profileName, "Alice Smith", "parseCommenters: full name");
assert.strictEqual(
  commenters[0].profileUrl,
  "https://www.linkedin.com/in/alice-smith/",
  "parseCommenters: profile URL"
);
assert.strictEqual(commenters[0].commentText, "Great post!", "parseCommenters: comment text");

// Deduplication
const mockWithDupe = {
  included: [
    ...mockVoyagerResponse.included,
    {
      $type: "com.linkedin.voyager.feed.Comment",
      commentary: { text: "Also me" },
      commenter: {
        "com.linkedin.voyager.feed.MemberActor": {
          miniProfile: "urn:li:fs_miniProfile:ACoAAAxxxxx", // same person
        },
      },
    },
  ],
};
const deduped = parseCommenters(mockWithDupe);
assert.strictEqual(deduped.length, 1, "parseCommenters: deduplicates same commenter");

// Empty response
assert.deepStrictEqual(parseCommenters({}), [], "parseCommenters: handles empty included");

console.log("All tests passed! ✓");
```

- [ ] **Step 2: Run tests to confirm they pass** (these test the logic before we write content.js)

```bash
cd "D:\pk\Work\LinkedIn Auto-DM Tool\linkdm\.worktrees\beta-login"
node extension/__tests__/content-utils.test.js
```

Expected: `All tests passed! ✓`

- [ ] **Step 3: Write content.js**

Replace the contents of `extension/content.js` with:
```js
// linkdm content script
// Runs on every linkedin.com page.
// Handles Voyager API calls (same-origin, cookies auto-attach)
// and keeps the service worker alive via an open port.

// ── Keep service worker alive ─────────────────────────────────────────────────
const port = chrome.runtime.connect({ name: "keepalive" });

// ── Message listener ─────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "FETCH_COMMENTERS") {
    fetchCommenters(message.postUrl).then(sendResponse);
    return true; // keeps the message channel open for async response
  }
  if (message.type === "SEND_DM") {
    sendDm(message.profileId, message.message).then(sendResponse);
    return true;
  }
});

// ── CSRF token ────────────────────────────────────────────────────────────────
function getCsrfToken() {
  // LinkedIn stores the CSRF token in the JSESSIONID cookie (not HttpOnly)
  const match = document.cookie.match(/JSESSIONID="?([^";]+)"?/);
  return match ? match[1] : null;
}

// ── Post URN extraction ───────────────────────────────────────────────────────
function extractPostUrn(postUrl) {
  const match = postUrl.match(/urn:li:activity:\d+/);
  return match ? match[0] : null;
}

// ── Commenter parsing ─────────────────────────────────────────────────────────
function parseCommenters(data) {
  const included = data.included || [];

  // Build map from miniProfile entityUrn → profile info
  const profilesByUrn = {};
  for (const item of included) {
    if (item.$type && item.$type.includes("MiniProfile")) {
      profilesByUrn[item.entityUrn] = {
        profileId: item.objectUrn,
        profileName: [item.firstName, item.lastName].filter(Boolean).join(" "),
        profileUrl: item.publicIdentifier
          ? `https://www.linkedin.com/in/${item.publicIdentifier}/`
          : "",
      };
    }
  }

  // Extract unique commenters from Comment elements
  const seen = new Set();
  const commenters = [];
  for (const item of included) {
    if (!item.$type?.includes("Comment")) continue;
    const memberActor =
      item.commenter?.["com.linkedin.voyager.feed.MemberActor"];
    if (!memberActor) continue;
    const profileUrn = memberActor.miniProfile;
    if (!profileUrn || seen.has(profileUrn)) continue;
    const profile = profilesByUrn[profileUrn];
    if (!profile) continue;
    seen.add(profileUrn);
    commenters.push({ ...profile, commentText: item.commentary?.text || "" });
  }
  return commenters;
}

// ── Fetch commenters from Voyager API ─────────────────────────────────────────
async function fetchCommenters(postUrl) {
  const csrfToken = getCsrfToken();
  if (!csrfToken) return { error: "NO_CSRF_TOKEN" };

  const postUrn = extractPostUrn(postUrl);
  if (!postUrn) return { error: "INVALID_POST_URL" };

  try {
    const res = await fetch(
      `https://www.linkedin.com/voyager/api/feed/comments` +
        `?count=100&start=0&q=comments&updateId=${encodeURIComponent(postUrn)}`,
      {
        credentials: "include",
        headers: {
          "csrf-token": csrfToken,
          "x-restli-protocol-version": "2.0.0",
          accept: "application/vnd.linkedin.normalized+json+2.1",
        },
      }
    );

    if (res.status === 401) return { error: "SESSION_EXPIRED" };
    if (!res.ok) return { error: `HTTP_${res.status}` };

    const data = await res.json();
    const commenters = parseCommenters(data);
    console.log(`[linkdm] Fetched ${commenters.length} commenters for post`);
    return { commenters };
  } catch (err) {
    return { error: err.message };
  }
}

// ── Send DM via Voyager messaging API ─────────────────────────────────────────
// Note: If LinkedIn changes their API shape, inspect a real DM send in Network
// tab (filter for "voyagerMessagingDash") to see the current request format.
async function sendDm(profileId, message) {
  const csrfToken = getCsrfToken();
  if (!csrfToken) return { success: false, error: "NO_CSRF_TOKEN" };

  try {
    const res = await fetch(
      "https://www.linkedin.com/voyager/api/voyagerMessagingDashMessengerMessages?action=create",
      {
        method: "POST",
        credentials: "include",
        headers: {
          "csrf-token": csrfToken,
          "x-restli-protocol-version": "2.0.0",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          message: {
            body: {
              attributes: [],
              text: message,
            },
            renderContentUnions: [],
          },
          recipients: [profileId],
          subject: "",
        }),
      }
    );

    if (res.status === 401) return { success: false, error: "SESSION_EXPIRED" };
    if (!res.ok) return { success: false, error: `HTTP_${res.status}` };

    console.log(`[linkdm] DM sent to ${profileId}`);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

console.log("[linkdm] Content script ready");
```

- [ ] **Step 4: Reload and manually verify the content script**

1. Reload the extension (`chrome://extensions/` → Reload)
2. Navigate to `https://www.linkedin.com/`
3. Open DevTools → Console
4. Should see: `[linkdm] Content script ready`
5. In the console, verify CSRF token is accessible:
   ```js
   document.cookie.match(/JSESSIONID="?([^";]+)"?/)?.[1]
   ```
   Expected: a string like `ajax:1234567890` (not `undefined`)
6. In the service worker's DevTools console, verify the port keepalive logs appear

Expected: No errors, CSRF token is accessible.

- [ ] **Step 5: Commit**

```bash
cd "D:\pk\Work\LinkedIn Auto-DM Tool\linkdm\.worktrees\beta-login"
git add extension/content.js extension/__tests__/content-utils.test.js
git commit -m "feat: add content script with Voyager API fetch/send and unit tests"
```

---

### Task 4: Service worker (campaign orchestration)

**Files:**
- Modify: `extension/background.js`

- [ ] **Step 1: Write background.js**

Replace the contents of `extension/background.js` with:
```js
// linkdm service worker
// Runs every 20s via chrome.alarms. Fetches active campaigns from Convex,
// picks the next eligible commenter, and tells the content script to send the DM.

// ── Configuration ─────────────────────────────────────────────────────────────
// This is your Convex HTTP site URL — different from NEXT_PUBLIC_CONVEX_URL.
// Replace .convex.cloud with .convex.site in your deployment URL.
const CONVEX_SITE_URL = "https://utmost-lemur-208.eu-west-1.convex.site";

// ── Startup: register alarm ───────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(setupAlarms);
chrome.runtime.onStartup.addListener(setupAlarms);

function setupAlarms() {
  // Chrome alarms must be >= 0.5 minutes (30s). We set 0.5 to get ~30s ticks.
  // The actual DM pacing (30–90s delay between sends) is enforced via nextSendAt.
  chrome.alarms.create("tick", { periodInMinutes: 0.5 });
  console.log("[linkdm] Alarm registered");
}

// ── Keep-alive: open port from content script prevents worker from sleeping ───
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "keepalive") return;
  port.onDisconnect.addListener(() => {
    console.log("[linkdm] Content script disconnected (tab closed or navigated)");
  });
});

// ── Main tick ────────────────────────────────────────────────────────────────
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== "tick") return;
  try {
    await runCampaignLoop();
  } catch (err) {
    console.error("[linkdm] Campaign loop error:", err);
  }
});

// ── Campaign orchestration ────────────────────────────────────────────────────
async function runCampaignLoop() {
  // Require a token
  const { token } = await chrome.storage.local.get("token");
  if (!token) return;

  // Respect the DM pacing delay (30–90s between sends)
  const { nextSendAt = 0 } = await chrome.storage.local.get("nextSendAt");
  if (Date.now() < nextSendAt) {
    const remaining = Math.ceil((nextSendAt - Date.now()) / 1000);
    console.log(`[linkdm] Next DM in ${remaining}s`);
    return;
  }

  // Need a LinkedIn tab for Voyager API calls
  const tabs = await chrome.tabs.query({ url: "https://www.linkedin.com/*" });
  const linkedinTab = tabs[0];
  if (!linkedinTab) {
    console.log("[linkdm] No LinkedIn tab open — waiting");
    return;
  }

  // Fetch active campaigns from Convex (includes todayCount per campaign)
  let campaigns;
  try {
    const res = await fetch(`${CONVEX_SITE_URL}/api/extension/campaigns`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) {
      console.error("[linkdm] Token rejected by Convex — check your token in the popup");
      return;
    }
    const body = await res.json();
    campaigns = body.campaigns;
  } catch (err) {
    console.error("[linkdm] Failed to fetch campaigns:", err);
    return;
  }

  if (!campaigns?.length) {
    console.log("[linkdm] No active campaigns");
    return;
  }

  // Load the local deduplication cache (profileIds already DM'd per campaign)
  const { dmedProfiles = {} } = await chrome.storage.local.get("dmedProfiles");

  for (const campaign of campaigns) {
    // Skip campaigns that have hit their daily limit
    if (campaign.todayCount >= campaign.dailyLimit) {
      await maybeSendLimitNotification(campaign);
      continue;
    }

    // Ask content script to fetch commenters from LinkedIn
    let fetchResult;
    try {
      fetchResult = await chrome.tabs.sendMessage(linkedinTab.id, {
        type: "FETCH_COMMENTERS",
        postUrl: campaign.postUrl,
      });
    } catch (err) {
      // Content script not available (page still loading, or non-feed LinkedIn page)
      console.warn("[linkdm] Could not reach content script:", err.message);
      return;
    }

    // Handle session expiry
    if (fetchResult?.error === "SESSION_EXPIRED") {
      await showNotification("session-expired", {
        title: "linkdm — LinkedIn session expired",
        message:
          "⚠️ Your LinkedIn connection needs a refresh. Just open LinkedIn in your browser and your campaigns will resume automatically.",
      });
      return;
    }

    if (!fetchResult?.commenters?.length) {
      console.log(`[linkdm] No commenters found for campaign ${campaign._id}`);
      continue;
    }

    // Filter: skip already-DM'd profiles and those who don't match the keyword
    const alreadyDmed = new Set(dmedProfiles[campaign._id] || []);
    const eligible = fetchResult.commenters.filter((c) => {
      if (alreadyDmed.has(c.profileId)) return false;
      if (
        campaign.keywordFilter &&
        !c.commentText.toLowerCase().includes(campaign.keywordFilter.toLowerCase())
      ) {
        return false;
      }
      return true;
    });

    // Check if campaign is complete (all commenters have been DM'd)
    const allDone =
      fetchResult.commenters.length > 0 &&
      fetchResult.commenters.every((c) => alreadyDmed.has(c.profileId));
    if (allDone) {
      await showNotification(`complete-${campaign._id}`, {
        title: "linkdm — Campaign complete!",
        message:
          "✅ Campaign complete! You've messaged everyone who commented on your post. Check your LinkedIn inbox for replies.",
      });
      continue;
    }

    if (eligible.length === 0) {
      console.log(
        `[linkdm] No eligible commenters for campaign ${campaign._id} (all filtered by keyword)`
      );
      continue;
    }

    // Pick the first eligible commenter
    const next = eligible[0];
    console.log(`[linkdm] Sending DM to ${next.profileName} (${next.profileId})`);

    // Ask content script to send the DM
    let dmResult;
    try {
      dmResult = await chrome.tabs.sendMessage(linkedinTab.id, {
        type: "SEND_DM",
        profileId: next.profileId,
        message: campaign.messageTemplate,
      });
    } catch (err) {
      console.error("[linkdm] Failed to send DM:", err.message);
      dmResult = { success: false, error: err.message };
    }

    const status = dmResult?.success ? "sent" : "failed";

    // Report result to Convex backend
    try {
      const logRes = await fetch(`${CONVEX_SITE_URL}/api/extension/dmLog`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          campaignId: campaign._id,
          profileId: next.profileId,
          profileName: next.profileName,
          profileUrl: next.profileUrl,
          status,
          errorMessage: dmResult?.error,
        }),
      });
      if (!logRes.ok) {
        console.error("[linkdm] Failed to log DM to Convex:", logRes.status);
      }
    } catch (err) {
      console.error("[linkdm] Failed to log DM to Convex:", err);
    }

    // Update local deduplication cache
    if (!dmedProfiles[campaign._id]) dmedProfiles[campaign._id] = [];
    dmedProfiles[campaign._id].push(next.profileId);
    await chrome.storage.local.set({ dmedProfiles });

    // Schedule next DM: random 30–90 second delay
    const delayMs = 30_000 + Math.floor(Math.random() * 60_000);
    await chrome.storage.local.set({ nextSendAt: Date.now() + delayMs });

    console.log(
      `[linkdm] DM ${status} → ${next.profileName}. Next DM in ${Math.round(delayMs / 1000)}s`
    );

    return; // One DM per tick — wait for the next alarm
  }
}

// ── Notifications ─────────────────────────────────────────────────────────────

// In-memory set to avoid repeating milestone notifications within one session.
// Resets if the service worker is restarted (acceptable for a beta).
const notificationsSent = new Set();

async function maybeSendLimitNotification(campaign) {
  const key = `limit-${campaign._id}`;
  if (notificationsSent.has(key)) return;
  notificationsSent.add(key);
  await showNotification(key, {
    title: "linkdm — Daily limit reached",
    message: `🎉 Great news! Your campaign sent its ${campaign.dailyLimit} DMs for today. It'll automatically pick up again tomorrow morning.`,
  });
}

function showNotification(id, { title, message }) {
  return new Promise((resolve) => {
    chrome.notifications.create(
      id,
      { type: "basic", iconUrl: "icons/icon48.png", title, message },
      resolve
    );
  });
}

// Clicking any notification opens the linkdm dashboard
chrome.notifications.onClicked.addListener((notificationId) => {
  chrome.tabs.create({ url: "http://localhost:3000/dashboard" });
  chrome.notifications.clear(notificationId);
});

console.log("[linkdm] Service worker ready");
```

- [ ] **Step 2: Reload and verify the service worker starts**

1. Reload the extension (`chrome://extensions/` → Reload)
2. Open the service worker DevTools (click **Service Worker** link on the extensions page)
3. Console should show:
   - `[linkdm] Service worker ready`
   - `[linkdm] Alarm registered`
4. Wait ~30 seconds — should see either:
   - `[linkdm] No LinkedIn tab open — waiting` (if no LinkedIn tab)
   - `[linkdm] No active campaigns` (if no token or no campaigns)

Expected: No errors in the console.

- [ ] **Step 3: Verify the token check**

1. Make sure the popup shows "Not connected" (or click Disconnect)
2. In the service worker console, wait for a tick
3. Should see nothing (loop returns early — no token)
4. Now paste a real token in the popup and click Connect
5. On next tick: should see `[linkdm] No active campaigns` or campaign activity

Expected: Token guard works correctly.

- [ ] **Step 4: Commit**

```bash
cd "D:\pk\Work\LinkedIn Auto-DM Tool\linkdm\.worktrees\beta-login"
git add extension/background.js
git commit -m "feat: add service worker with campaign loop, DM orchestration, and notifications"
```

---

### Task 5: End-to-end manual integration test

This task verifies the complete flow: extension → LinkedIn Voyager API → Convex backend → real DM sent.

**Prerequisites:**
- `npx convex dev` is running in the worktree (Convex backend deployed)
- The linkdm dashboard is running locally: `npm run dev`
- You are logged into LinkedIn in Chrome
- You have a LinkedIn post URL with at least one comment to test with

- [ ] **Step 1: Verify Convex backend is live**

```bash
cd "D:\pk\Work\LinkedIn Auto-DM Tool\linkdm\.worktrees\beta-login"
npx convex dev --once
```

Expected: Schema pushed, no errors.

- [ ] **Step 2: Get your extension token**

Option A — Via Convex dashboard:
1. Go to [https://dashboard.convex.dev](https://dashboard.convex.dev)
2. Open your `beta-linkdm-login` project → Functions
3. Run `api.extensionToken.getOrCreate` (you'll need to be logged in as a user first via the linkdm dashboard)

Option B — Via the dashboard UI (simpler):
1. Start the dashboard: `npm run dev` (from the worktree)
2. Log in at `http://localhost:3000`
3. Navigate to Settings — your extension token should be displayed
   (Settings page is part of Plan 3 — if not built yet, use Option A above)

- [ ] **Step 3: Connect the extension**

1. Click the linkdm icon in Chrome toolbar
2. Paste the token (starts with `lnkdm_`)
3. Click Connect → popup shows "✅ Connected"

- [ ] **Step 4: Create a test campaign via Convex dashboard**

In Convex dashboard → Functions, run `api.campaigns.create` with:
```json
{
  "postUrl": "https://www.linkedin.com/feed/update/urn:li:activity:YOUR_POST_URN/",
  "messageTemplate": "Hey, I saw your comment — thanks for engaging!"
}
```

Use a real LinkedIn post URL where you know the commenters and can verify DMs are sent. Start with a small post (1–2 commenters) for testing.

- [ ] **Step 5: Open LinkedIn and watch the service worker logs**

1. Open `https://www.linkedin.com/feed/` in Chrome
2. Open the service worker DevTools console
3. Wait up to 30 seconds for the next alarm tick

Expected console output (one DM found):
```
[linkdm] Sending DM to <Commenter Name> (urn:li:member:xxx)
[linkdm] DM sent → <Commenter Name>. Next DM in 47s
```

If the DM fails, console will show:
```
[linkdm] DM failed → <Commenter Name>. Next DM in 35s
```

- [ ] **Step 6: Verify in Convex dashboard**

1. Open Convex dashboard → Data → `dmLog` table
2. Should see a new row with:
   - `status: "sent"`
   - `profileName: "<Commenter Name>"`
   - `campaignId: <your campaign ID>`
3. Go to `campaigns` table — `todayCount` returned by `GET /api/extension/campaigns` should reflect the sent DM

- [ ] **Step 7: Verify in LinkedIn inbox**

1. Open LinkedIn → Messaging
2. Should see the DM sent to the commenter with your `messageTemplate` text

- [ ] **Step 8: Test the Voyager API request format (if DMs are failing)**

If `SEND_DM` returns `HTTP_400` or another error:
1. Open `https://www.linkedin.com/messaging/` in Chrome
2. Open DevTools → Network tab → filter for `voyagerMessagingDash`
3. Send a real manual DM
4. Inspect the request body — compare to the format in `content.js`'s `sendDm` function
5. Update `content.js` body structure to match if needed

LinkedIn's Voyager API shape can change. The current format in the plan was accurate as of April 2026.

- [ ] **Step 9: Final commit**

```bash
cd "D:\pk\Work\LinkedIn Auto-DM Tool\linkdm\.worktrees\beta-login"
git add -A
git commit -m "feat: complete LinkedIn Chrome extension — popup, content script, service worker"
```

---

## Notes for the Implementer

**Alarm minimum period:** Chrome enforces a minimum alarm period of 30 seconds (0.5 minutes). `periodInMinutes: 0.5` fires approximately every 30 seconds. The DM pacing (30–90s delay via `nextSendAt`) is enforced separately — the alarm just wakes the worker.

**Voyager API changes:** LinkedIn's internal API can change without notice. If DMs stop sending, the first debugging step is always to inspect a real LinkedIn DM in the Network tab and compare the request format to `content.js`.

**CONVEX_SITE_URL:** Pre-filled with `https://utmost-lemur-208.eu-west-1.convex.site` from the project's `.env.local`. If the deployment changes, update this constant in `background.js`.

**No session sharing:** The extension uses its own `lnkdm_*` token for Convex auth — it does NOT share the dashboard's login session. The user must paste the token once from the dashboard Settings page.

**Notification visibility:** The spec says notifications should only appear when the linkdm dashboard tab is not in focus. This plan shows notifications unconditionally — this is an intentional simplification for the beta. Adding focus detection would require `chrome.windows` permission and adds complexity that isn't needed for initial testing.
