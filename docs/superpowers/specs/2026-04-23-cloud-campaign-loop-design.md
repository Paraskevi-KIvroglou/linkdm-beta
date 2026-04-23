# Cloud Campaign Loop — Design Spec

**Date:** 2026-04-23  
**Status:** Approved  

---

## Goal

Run LinkedIn DM campaigns 24/7 from Convex cloud without requiring the user's Chrome to be open. LinkedIn session cookies captured by the extension are stored encrypted in Convex; a scheduled Convex action makes Voyager API calls server-side on the same cadence the extension currently does.

---

## 1. Architecture Overview

```
User's Chrome (extension)
  └─ Sync endpoint ──(HTTPS + HMAC)──► Convex HTTP action
                                             │
                                       linkedinSessions table
                                       (encrypted at rest)
                                             │
                                    Convex cron (every N min)
                                             │
                                     internalAction: cloudCampaignLoop
                                             │
                              ┌──────────────┴───────────────┐
                              │                              │
                      Fetch commenters                Send DMs
                   (LinkedIn Voyager API)        (Voyager API, same cookie)
                              │                              │
                          campaigns table               dmLog table
```

**Key design decisions:**

- Convex cron replaces the extension's `setInterval` for campaign processing.  
- The extension becomes a thin cookie-sync client and UI surface — it no longer needs to stay open for campaigns to run.  
- All LinkedIn API calls are made from Convex actions (Node.js runtime), using the same Voyager endpoints the extension uses today.  
- Proxy support is a no-op parameter today; residential proxies are a future drop-in.

---

## 2. Data Layer

### 2a. `linkedinSessions` table

```ts
linkedinSessions: defineTable({
  userId:      v.string(),
  liAt:        v.string(),        // AES-256-GCM encrypted li_at cookie
  jsessionId:  v.string(),        // AES-256-GCM encrypted JSESSIONID
  userAgent:   v.string(),        // browser UA string (sent plain)
  status:      v.union(
                 v.literal("active"),
                 v.literal("expired"),
                 v.literal("pending")
               ),
  syncedAt:    v.number(),        // epoch ms of last successful sync
  expiresAt:   v.optional(v.number()), // epoch ms; set when session expires
}).index("by_userId", ["userId"])
```

### 2b. DM deduplication via `dmLog`

Before every DM send the cloud loop checks:

```ts
const existing = await ctx.db
  .query("dmLog")
  .withIndex("by_campaignId_and_profileUrl", q =>
    q.eq("campaignId", campaignId).eq("profileUrl", profileUrl)
  )
  .first();
if (existing) return; // already sent or attempted
```

This replaces the extension's current localStorage-based dedup — all state lives in Convex.

---

## 3. Security

### Encryption at rest — AES-256-GCM

Each cookie value is encrypted before insert and decrypted only inside `internalAction` (never exposed to client queries or mutations):

```
plaintext cookie
  │
  ▼
crypto.subtle.encrypt("AES-GCM", derivedKey, iv + plaintext)
  │
  ▼
base64( iv || ciphertext || authTag )  ──► stored in DB
```

- Key is derived from `LINKEDIN_COOKIE_ENCRYPTION_KEY` (32-byte random hex) stored as Convex environment variable (server-only).  
- Each encryption call generates a fresh random 12-byte IV — no IV reuse.  
- `internalAction` only: decryption helper is never imported in any `query` or `mutation`, ensuring the browser can never call it.

### Transmission security — HTTPS + HMAC

The extension's sync call:

```
POST /sync-linkedin-session
Headers:
  X-Timestamp: <epoch-seconds>
  X-Signature: HMAC-SHA256(secret, "timestamp=<epoch>")
Body: { liAt, jsessionId, userAgent }
```

The Convex HTTP action:
1. Verifies `|now - timestamp| < 5 minutes` (replay window).  
2. Recomputes HMAC with the same secret (`LINKEDIN_SYNC_HMAC_SECRET` env var) and rejects mismatches.  
3. Decrypts nothing at this stage — encrypts and stores immediately.

HTTPS is enforced by Convex's `.convex.cloud` / `.convex.site` infrastructure.  

### What an attacker would need

To get cookies they would need:
- The encrypted DB record **plus** the `LINKEDIN_COOKIE_ENCRYPTION_KEY` env var, **or**
- A valid HMAC secret to forge a sync request (then they'd also need the encryption key to read it back).

Neither is accessible without full Convex project compromise.

---

## 4. Session Expiry & User Notification

The cloud loop detects a 401 / 403 from Voyager:

1. Marks `linkedinSessions.status = "expired"` and sets `expiresAt = now`.  
2. Pauses all campaigns for that user (sets `status = "paused"`).  
3. Sends an email via Resend: "Your LinkedIn session expired — please reconnect."

Dashboard shows a **LinkedIn Connection** card:
- **Green**: session active, last synced `X minutes ago`.  
- **Red / reconnect button**: session expired, click to re-open the extension and re-sync.

Extension shows a badge / popup warning when `status = "expired"`.

---

## 5. Cloud Campaign Loop — Action Logic

Runs every 5 minutes via Convex cron:

```
for each active campaign:
  1. Load linkedinSessions for campaign.userId (status = "active")
  2. Decrypt li_at + jsessionId  [internalAction only]
  3. Fetch commenters from Voyager (same endpoint as extension)
  4. For each commenter:
     a. Check dmLog — skip if already sent
     b. Check keyword filter
     c. Send DM via Voyager
     d. Write dmLog entry (status = "sent" | "failed")
  5. Enforce dailyLimit (count dmLog entries for today)
  6. On 401/403 → mark session expired, pause campaigns, send email
```

Rate limits mirror the extension: `dailyLimit` per campaign (default 20), 2–4 s jitter between sends.

---

## 6. Proxy Readiness (Future)

The Node.js HTTP client in the action accepts a `proxyUrl` parameter:

```ts
async function voyagerFetch(path, opts, proxyUrl?: string) {
  const agent = proxyUrl ? new HttpsProxyAgent(proxyUrl) : undefined;
  return fetch(LINKEDIN_BASE + path, { ...opts, agent });
}
```

Today `proxyUrl` is always `undefined`. Adding residential proxies later is a one-line config change per user session.

---

## 7. Extension Changes (Approach 1 only)

- Add **"Connect LinkedIn"** button in popup that triggers cookie extraction and sync.  
- Show session status (active / expired) in popup.  
- Remove campaign processing loop from extension (`background.js` `setInterval`).  
- Extension becomes UI-only: browse LinkedIn, sync cookies, show notifications.

---

## 8. Out of Scope

- Approach 2 (manual cookie paste) and Approach 3 (proxy-based no-extension) — future phases.  
- Rotating LinkedIn accounts / multiple seats per user.  
- Two-factor auth handling.  
- LinkedIn API rate-limit backoff beyond per-campaign daily limit.

---

## Open Questions (resolved)

| Question | Decision |
|----------|----------|
| Where to encrypt? | Convex internalAction only — never client-side |
| Replay attack prevention? | HMAC-SHA256 with 5-min timestamp window |
| Dedup mechanism? | dmLog DB check (replaces localStorage) |
| Proxy for beta? | No-op parameter; residential proxies later |
| Notify on expiry? | Email via Resend + dashboard card + extension badge |
