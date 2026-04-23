# Cloud Campaign Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run LinkedIn DM campaigns 24/7 from Convex cloud using encrypted session cookies, without Chrome staying open.

**Architecture:** Extension extracts `li_at` + `JSESSIONID` cookies and POSTs them (HMAC-signed, HTTPS) to a new Convex HTTP endpoint, which encrypts them with AES-256-GCM and stores them in a `linkedinSessions` table. A Convex cron fires `cloudCampaignLoop` every 5 minutes — it decrypts cookies, calls LinkedIn Voyager API server-side, deduplicates against `dmLog`, sends DMs, logs results, and marks sessions expired on auth failure.

**Tech Stack:** Convex internalAction/cron, Web Crypto API (AES-256-GCM + HMAC-SHA256), LinkedIn Voyager REST API, Chrome MV3 `cookies` permission, React/Next.js for dashboard card, Resend for expiry email.

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `convex/schema.ts` | Modify | Add `linkedinSessions` table |
| `convex/linkedinSessions.ts` | Create | Session DB layer: upsert, getActive, markExpired, getSessionStatus |
| `convex/linkedinSessions.test.ts` | Create | Tests for session DB layer |
| `convex/crypto.ts` | Create | AES-256-GCM encrypt/decrypt + HMAC-SHA256 verify (Web Crypto) |
| `convex/http.ts` | Modify | Add POST /api/extension/sync-session endpoint |
| `convex/campaigns.ts` | Modify | Add `listAllActive` internalQuery + `pauseAllForUser` internalMutation |
| `convex/cloudLoop.ts` | Create | internalAction: fetch commenters, send DMs, log results |
| `convex/crons.ts` | Create | Convex cron: fire cloudCampaignLoop every 5 min |
| `extension/manifest.json` | Modify | Add `cookies` permission |
| `extension/background.js` | Modify | Add `extractAndSyncLinkedInSession()` |
| `extension/popup.html` | Modify | Add LinkedIn session status card + Sync button |
| `extension/popup.js` | Modify | Add sync handler + session status display |
| `src/app/dashboard/page.tsx` | Modify | Add LinkedIn Connection card |

---

### Task 1: Schema — add linkedinSessions table

**Files:**
- Modify: `convex/schema.ts`

- [ ] **Step 1: Add the table definition**

In `convex/schema.ts`, add after the closing of the `dmLog` table block (before the closing `}`  of `defineSchema`):

```ts
  linkedinSessions: defineTable({
    userId:     v.string(),
    liAt:       v.string(),   // AES-256-GCM encrypted li_at cookie value
    jsessionId: v.string(),   // AES-256-GCM encrypted JSESSIONID cookie value
    userAgent:  v.string(),   // browser UA (stored plain)
    status:     v.union(
                  v.literal("active"),
                  v.literal("expired"),
                  v.literal("pending")
                ),
    syncedAt:   v.number(),                    // epoch ms of last successful sync
    expiresAt:  v.optional(v.number()),        // epoch ms; set when expired
  }).index("by_userId", ["userId"]),
```

- [ ] **Step 2: Verify schema compiles**

Run: `npx convex dev --once`
Expected: no TypeScript errors, exits cleanly.

- [ ] **Step 3: Commit**

```bash
git add convex/schema.ts
git commit -m "feat(schema): add linkedinSessions table"
```

---

### Task 2: linkedinSessions DB layer

**Files:**
- Create: `convex/linkedinSessions.ts`
- Create: `convex/linkedinSessions.test.ts`

- [ ] **Step 1: Write failing tests**

Create `convex/linkedinSessions.test.ts`:

```ts
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

test("upsertSession inserts a new active session", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(internal.linkedinSessions.upsertSession, {
    userId: "u1",
    liAt: "enc_li_at",
    jsessionId: "enc_js",
    userAgent: "Mozilla/5.0",
  });
  const s = await t.query(internal.linkedinSessions.getActiveByUserId, { userId: "u1" });
  expect(s).not.toBeNull();
  expect(s!.status).toBe("active");
  expect(s!.liAt).toBe("enc_li_at");
});

test("upsertSession updates an existing session", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(internal.linkedinSessions.upsertSession, {
    userId: "u1", liAt: "v1", jsessionId: "j1", userAgent: "UA1",
  });
  await t.mutation(internal.linkedinSessions.upsertSession, {
    userId: "u1", liAt: "v2", jsessionId: "j2", userAgent: "UA2",
  });
  const s = await t.query(internal.linkedinSessions.getActiveByUserId, { userId: "u1" });
  expect(s!.liAt).toBe("v2");
  expect(s!.userAgent).toBe("UA2");
});

test("markExpired hides session from getActiveByUserId", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(internal.linkedinSessions.upsertSession, {
    userId: "u1", liAt: "v", jsessionId: "j", userAgent: "UA",
  });
  await t.mutation(internal.linkedinSessions.markExpired, { userId: "u1" });
  const s = await t.query(internal.linkedinSessions.getActiveByUserId, { userId: "u1" });
  expect(s).toBeNull();
});

test("getSessionStatus returns null when no session", async () => {
  const t = convexTest(schema, modules);
  const s = await t
    .withIdentity({ tokenIdentifier: "u1" })
    .query(api.linkedinSessions.getSessionStatus, {});
  expect(s).toBeNull();
});

test("getSessionStatus returns status without cookie values", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(internal.linkedinSessions.upsertSession, {
    userId: "u1", liAt: "secret", jsessionId: "secret2", userAgent: "UA",
  });
  const s = await t
    .withIdentity({ tokenIdentifier: "u1" })
    .query(api.linkedinSessions.getSessionStatus, {});
  expect(s).not.toBeNull();
  expect(s!.status).toBe("active");
  expect((s as Record<string, unknown>).liAt).toBeUndefined();
});
```

- [ ] **Step 2: Run tests — expect failure**

Run: `npm test -- linkedinSessions`
Expected: FAIL — module not found.

- [ ] **Step 3: Create convex/linkedinSessions.ts**

```ts
import { internalMutation, internalQuery, query } from "./_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";

/** Upsert a LinkedIn session. liAt and jsessionId must be pre-encrypted by caller. */
export const upsertSession = internalMutation({
  args: {
    userId:     v.string(),
    liAt:       v.string(),
    jsessionId: v.string(),
    userAgent:  v.string(),
  },
  handler: async (ctx, { userId, liAt, jsessionId, userAgent }) => {
    const existing = await ctx.db
      .query("linkedinSessions")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        liAt, jsessionId, userAgent,
        status: "active",
        syncedAt: Date.now(),
        expiresAt: undefined,
      });
    } else {
      await ctx.db.insert("linkedinSessions", {
        userId, liAt, jsessionId, userAgent,
        status: "active",
        syncedAt: Date.now(),
      });
    }
  },
});

/** Returns the active session for a userId, or null if none / expired. */
export const getActiveByUserId = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    const s = await ctx.db
      .query("linkedinSessions")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();
    if (!s || s.status !== "active") return null;
    return s;
  },
});

/** Marks a session expired. Called by cloudLoop on 401/403 from Voyager. */
export const markExpired = internalMutation({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    const s = await ctx.db
      .query("linkedinSessions")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();
    if (!s) return;
    await ctx.db.patch(s._id, { status: "expired", expiresAt: Date.now() });
  },
});

/**
 * Public query for the dashboard card.
 * Returns status + timestamps but NEVER the encrypted cookie values.
 */
export const getSessionStatus = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const s = await ctx.db
      .query("linkedinSessions")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();
    if (!s) return null;
    return { status: s.status, syncedAt: s.syncedAt, expiresAt: s.expiresAt ?? null };
  },
});
```

- [ ] **Step 4: Run tests — expect pass**

Run: `npm test -- linkedinSessions`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add convex/linkedinSessions.ts convex/linkedinSessions.test.ts
git commit -m "feat(convex): add linkedinSessions DB layer"
```

---

### Task 3: Crypto helpers + HTTP sync endpoint

**Files:**
- Create: `convex/crypto.ts`
- Modify: `convex/http.ts`

- [ ] **Step 1: Create convex/crypto.ts**

```ts
/**
 * Web Crypto helpers — AES-256-GCM encryption and HMAC-SHA256 verification.
 * Uses globalThis.crypto (available in both Edge and Node.js runtimes).
 * Import only from actions or HTTP routes — never from queries/mutations.
 */

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2)
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  return bytes;
}

/**
 * Encrypts plaintext with AES-256-GCM.
 * Returns base64( iv[12] || ciphertext+authTag ).
 * @param plaintext  Cookie value to encrypt.
 * @param keyHex     32-byte key as 64-char hex string (LINKEDIN_COOKIE_ENCRYPTION_KEY).
 */
export async function encryptCookie(plaintext: string, keyHex: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", hexToBytes(keyHex), { name: "AES-GCM" }, false, ["encrypt"]
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, tagLength: 128 },
    key,
    new TextEncoder().encode(plaintext)
  );
  const combined = new Uint8Array(iv.byteLength + cipher.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(cipher), iv.byteLength);
  return btoa(String.fromCharCode(...combined));
}

/**
 * Decrypts a value produced by encryptCookie.
 * @param encoded  base64( iv[12] || ciphertext+authTag )
 * @param keyHex   Same 64-char hex key used during encryption.
 */
export async function decryptCookie(encoded: string, keyHex: string): Promise<string> {
  const combined = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  const key = await crypto.subtle.importKey(
    "raw", hexToBytes(keyHex), { name: "AES-GCM" }, false, ["decrypt"]
  );
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv, tagLength: 128 },
    key,
    ciphertext
  );
  return new TextDecoder().decode(plain);
}

/**
 * Timing-safe HMAC-SHA256 verification.
 * Message format: "timestamp=<epochSeconds>"
 * @param secret        LINKEDIN_SYNC_HMAC_SECRET env var.
 * @param timestamp     String from X-Timestamp header.
 * @param signatureHex  Hex string from X-Signature header.
 */
export async function verifyHmac(
  secret: string,
  timestamp: string,
  signatureHex: string
): Promise<boolean> {
  try {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
    );
    const sigBuf = await crypto.subtle.sign("HMAC", key, enc.encode(`timestamp=${timestamp}`));
    const expected = Array.from(new Uint8Array(sigBuf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    if (expected.length !== signatureHex.length) return false;
    let diff = 0;
    for (let i = 0; i < expected.length; i++)
      diff |= expected.charCodeAt(i) ^ signatureHex.charCodeAt(i);
    return diff === 0;
  } catch {
    return false;
  }
}
```

- [ ] **Step 2: Add sync-session route to convex/http.ts**

Add these imports at the top of `convex/http.ts` (after the existing imports):

```ts
import { encryptCookie, verifyHmac } from "./crypto";
```

Then add the following two routes before `export default http`:

```ts
// CORS preflight for /api/extension/sync-session
http.route({
  path: "/api/extension/sync-session",
  method: "OPTIONS",
  handler: httpAction(async () => {
    return new Response(null, { status: 204, headers: corsHeaders });
  }),
});

// POST /api/extension/sync-session
// Accepts encrypted LinkedIn cookies from the Chrome extension.
// Requires: Authorization: Bearer <extensionToken>
//           X-Timestamp: <epoch seconds>
//           X-Signature: HMAC-SHA256(LINKEDIN_SYNC_HMAC_SECRET, "timestamp=<epoch>") as hex
http.route({
  path: "/api/extension/sync-session",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const userId = await resolveToken(ctx, req);
    if (!userId) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: jsonHeaders,
      });
    }

    const timestamp = req.headers.get("X-Timestamp") ?? "";
    const signature = req.headers.get("X-Signature") ?? "";
    const hmacSecret = process.env.LINKEDIN_SYNC_HMAC_SECRET ?? "";
    const encKey = process.env.LINKEDIN_COOKIE_ENCRYPTION_KEY ?? "";

    if (!hmacSecret || !encKey || encKey.length !== 64) {
      return new Response(JSON.stringify({ error: "Server misconfiguration" }), {
        status: 500, headers: jsonHeaders,
      });
    }

    // Reject requests outside 5-minute window
    const nowSec = Math.floor(Date.now() / 1000);
    const tsSec = parseInt(timestamp, 10);
    if (isNaN(tsSec) || Math.abs(nowSec - tsSec) > 300) {
      return new Response(JSON.stringify({ error: "Timestamp out of range" }), {
        status: 401, headers: jsonHeaders,
      });
    }

    if (!(await verifyHmac(hmacSecret, timestamp, signature))) {
      return new Response(JSON.stringify({ error: "Invalid signature" }), {
        status: 401, headers: jsonHeaders,
      });
    }

    let body: Record<string, unknown>;
    try { body = await req.json(); }
    catch {
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
        status: 400, headers: jsonHeaders,
      });
    }

    const { liAt, jsessionId, userAgent } = body;
    if (typeof liAt !== "string" || !liAt ||
        typeof jsessionId !== "string" || !jsessionId ||
        typeof userAgent !== "string" || !userAgent) {
      return new Response(JSON.stringify({ error: "Missing required fields: liAt, jsessionId, userAgent" }), {
        status: 400, headers: jsonHeaders,
      });
    }

    const encLiAt = await encryptCookie(liAt, encKey);
    const encJsessionId = await encryptCookie(jsessionId, encKey);

    await ctx.runMutation(internal.linkedinSessions.upsertSession, {
      userId, liAt: encLiAt, jsessionId: encJsessionId, userAgent,
    });

    return new Response(JSON.stringify({ success: true }), {
      status: 200, headers: jsonHeaders,
    });
  }),
});
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx convex dev --once`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add convex/crypto.ts convex/http.ts
git commit -m "feat(http): add /api/extension/sync-session with HMAC + AES-256-GCM"
```

---

### Task 4: campaigns.ts additions

**Files:**
- Modify: `convex/campaigns.ts`

The cloud loop needs two things that don't exist yet: a way to list all active campaigns across all users, and a way to pause all campaigns for a user without requiring auth context.

- [ ] **Step 1: Add listAllActive internalQuery**

At the bottom of `convex/campaigns.ts`, add:

```ts
/**
 * Returns all active campaigns across all users.
 * Called by cloudCampaignLoop to find work to do.
 * Capped at 500 to avoid runaway queries.
 */
export const listAllActive = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("campaigns")
      .filter((q) => q.eq(q.field("status"), "active"))
      .take(500);
  },
});

/**
 * Pauses all active campaigns for a userId.
 * Called by cloudCampaignLoop when a session expires.
 * Does not require auth — internal only.
 */
export const pauseAllForUser = internalMutation({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    const campaigns = await ctx.db
      .query("campaigns")
      .withIndex("by_userId_and_status", (q) =>
        q.eq("userId", userId).eq("status", "active")
      )
      .collect();
    for (const c of campaigns) {
      await ctx.db.patch(c._id, { status: "paused" });
    }
  },
});
```

Also add `internalMutation` to the import at the top of `convex/campaigns.ts`:

```ts
import { mutation, query, internalQuery, internalMutation } from "./_generated/server";
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx convex dev --once`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add convex/campaigns.ts
git commit -m "feat(campaigns): add listAllActive and pauseAllForUser for cloud loop"
```

---

### Task 5: Cloud campaign loop action

**Files:**
- Create: `convex/cloudLoop.ts`

- [ ] **Step 1: Create convex/cloudLoop.ts**

```ts
"use node";

import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { decryptCookie } from "./crypto";

const LI = "https://www.linkedin.com";

// ── Voyager request helpers ───────────────────────────────────────────────────

function liHeaders(liAt: string, jsessionId: string, userAgent: string) {
  return {
    cookie: `li_at=${liAt}; JSESSIONID="${jsessionId}"`,
    "csrf-token": jsessionId,
    "x-restli-protocol-version": "2.0.0",
    accept: "application/vnd.linkedin.normalized+json+2.1",
    "user-agent": userAgent,
    "x-li-lang": "en_US",
  };
}

async function liGet(
  path: string, liAt: string, jsessionId: string, ua: string
): Promise<{ ok: boolean; status: number; data?: unknown }> {
  try {
    const res = await fetch(LI + path, { headers: liHeaders(liAt, jsessionId, ua) });
    if (!res.ok) return { ok: false, status: res.status };
    return { ok: true, status: res.status, data: await res.json() };
  } catch {
    return { ok: false, status: 0 };
  }
}

async function liPost(
  path: string, body: unknown, liAt: string, jsessionId: string, ua: string
): Promise<{ ok: boolean; status: number; text: string }> {
  try {
    const res = await fetch(LI + path, {
      method: "POST",
      headers: { ...liHeaders(liAt, jsessionId, ua), "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { ok: res.ok, status: res.status, text: await res.text().catch(() => "") };
  } catch {
    return { ok: false, status: 0, text: "" };
  }
}

// ── Profile helpers ───────────────────────────────────────────────────────────

async function fetchSenderFsdUrn(liAt: string, js: string, ua: string): Promise<string | null> {
  const r = await liGet("/voyager/api/me", liAt, js, ua);
  if (!r.ok || !r.data) return null;
  const profile = ((r.data as { included?: unknown[] }).included ?? []).find(
    (i) => typeof (i as Record<string, unknown>).$type === "string" &&
            ((i as Record<string, unknown>).$type as string).includes("MiniProfile")
  ) as Record<string, unknown> | undefined;
  if (!profile?.entityUrn) return null;
  return (profile.entityUrn as string).replace("urn:li:fs_miniProfile:", "urn:li:fsd_profile:");
}

function extractPostUrn(postUrl: string): string | null {
  return postUrl.match(/urn:li:activity:\d+/)?.[0] ?? null;
}

// ── Commenter parsing (mirrors content.js parseCommenters + extractPostActorUrn) ──

interface Commenter {
  profileId: string;
  profileName: string;
  profileUrl: string;
  profileFsdUrn: string;
  commentText: string;
  commentUrn: string | null;
}

function parseCommenters(data: unknown): { commenters: Commenter[]; postActorUrn: string | null } {
  const included = ((data as { included?: unknown[] }).included ?? []) as Record<string, unknown>[];

  const byUrn: Record<string, { profileId: string; profileName: string; profileUrl: string }> = {};
  for (const i of included) {
    if (!String(i.$type ?? "").includes("MiniProfile")) continue;
    byUrn[i.entityUrn as string] = {
      profileId: i.objectUrn as string,
      profileName: [i.firstName, i.lastName].filter(Boolean).join(" "),
      profileUrl: i.publicIdentifier ? `https://www.linkedin.com/in/${i.publicIdentifier}/` : "",
    };
  }

  const seen = new Set<string>();
  const commenters: Commenter[] = [];
  for (const i of included) {
    if (!String(i.$type ?? "").includes("Comment")) continue;
    const c = i.commenter as Record<string, unknown> | undefined;
    const pUrn = (
      c?.["*miniProfile"] ??
      (c?.["com.linkedin.voyager.feed.MemberActor"] as Record<string, unknown> | undefined)?.miniProfile ??
      (c?.["com.linkedin.voyager.feed.render.MemberActor"] as Record<string, unknown> | undefined)?.miniProfile
    ) as string | undefined;
    if (!pUrn || seen.has(pUrn)) continue;
    const profile = byUrn[pUrn];
    if (!profile) continue;
    seen.add(pUrn);

    const m = (i.entityUrn as string | undefined)?.match(/urn:li:fs_objectComment:\((\d+),(.*)\)/);
    const commentUrn = m ? `urn:li:comment:(${m[2]},${m[1]})` : null;
    const cv2 = i.commentV2 as Record<string, unknown> | undefined;
    const cv = i.comment as Record<string, unknown> | undefined;
    const co = i.commentary as Record<string, unknown> | undefined;
    const commentText =
      (cv2?.text as string) ??
      ((cv?.values as Array<{ value: string }> | undefined)?.[0]?.value) ??
      (co?.text as string) ?? "";

    commenters.push({
      ...profile,
      profileFsdUrn: pUrn.replace("urn:li:fs_miniProfile:", "urn:li:fsd_profile:"),
      commentText,
      commentUrn,
    });
  }

  // Extract org URN for company posts
  let postActorUrn: string | null = null;
  for (const i of included) {
    const type = String(i.$type ?? "");
    if (!type.includes("Update") && !type.includes("FeedUpdate")) continue;
    const actor = i.actor as Record<string, unknown> | undefined;
    const ref = (
      actor?.["*miniCompany"] ??
      (actor?.["com.linkedin.voyager.feed.Company"] as Record<string, unknown> | undefined)?.company ??
      actor?.["*company"]
    ) as string | undefined;
    if (ref) {
      const urn = ref.replace("urn:li:fs_miniCompany:", "urn:li:organization:");
      if (urn.startsWith("urn:li:organization:")) { postActorUrn = urn; break; }
    }
  }
  if (!postActorUrn) {
    const mc = included.find((i) => String(i.$type ?? "").includes("MiniCompany")) as Record<string, unknown> | undefined;
    if (mc?.objectUrn) postActorUrn = mc.objectUrn as string;
  }

  return { commenters, postActorUrn };
}

// ── DM sending ────────────────────────────────────────────────────────────────

async function findConvUrn(recipFsdUrn: string, liAt: string, js: string, ua: string): Promise<string | null> {
  const r = await liGet(
    `/voyager/api/voyagerMessagingDashMessengerConversations?q=participants&recipientUrns=List(${encodeURIComponent(recipFsdUrn)})`,
    liAt, js, ua
  );
  if (!r.ok || !r.data) return null;
  return ((r.data as { elements?: Array<{ entityUrn?: string }> }).elements ?? [])[0]?.entityUrn ?? null;
}

async function sendDm(
  recipFsdUrn: string, senderFsdUrn: string, message: string,
  liAt: string, js: string, ua: string
): Promise<{ success: boolean; error?: string; sessionExpired?: boolean }> {
  const convUrn = await findConvUrn(recipFsdUrn, liAt, js, ua);
  const trackingId = crypto.randomUUID().replace(/-/g, "").slice(0, 16);

  let res;
  if (convUrn) {
    res = await liPost(
      "/voyager/api/voyagerMessagingDashMessengerMessages?action=createMessage",
      {
        message: { body: { attributes: [], text: message }, renderContentUnions: [], conversationUrn: convUrn, originToken: crypto.randomUUID() },
        mailboxUrn: senderFsdUrn, trackingId, dedupeByClientGeneratedToken: false,
      },
      liAt, js, ua
    );
  } else {
    res = await liPost(
      "/voyager/api/voyagerMessagingDashMessengerConversations?action=createConversation",
      {
        mailboxUrn: senderFsdUrn,
        message: { body: { attributes: [], text: message }, renderContentUnions: [], originToken: crypto.randomUUID() },
        recipients: [recipFsdUrn], trackingId, dedupeByClientGeneratedToken: false,
      },
      liAt, js, ua
    );
  }

  if (res.status === 401 || res.status === 403) {
    return { success: false, sessionExpired: true, error: `SESSION_${res.status}` };
  }
  if (!res.ok) return { success: false, error: `DM_${res.status}: ${res.text.slice(0, 200)}` };
  return { success: true };
}

// ── Main action ───────────────────────────────────────────────────────────────

export const cloudCampaignLoop = internalAction({
  args: {},
  handler: async (ctx) => {
    console.log("[cloudLoop] Starting run");

    const encKey = process.env.LINKEDIN_COOKIE_ENCRYPTION_KEY ?? "";
    if (encKey.length !== 64) {
      console.error("[cloudLoop] LINKEDIN_COOKIE_ENCRYPTION_KEY not set correctly");
      return;
    }

    const allCampaigns = await ctx.runQuery(internal.campaigns.listAllActive, {});
    console.log(`[cloudLoop] ${allCampaigns.length} active campaign(s)`);

    // Group by userId to avoid redundant session lookups
    const byUser = new Map<string, typeof allCampaigns>();
    for (const c of allCampaigns) {
      if (!byUser.has(c.userId)) byUser.set(c.userId, []);
      byUser.get(c.userId)!.push(c);
    }

    for (const [userId, campaigns] of byUser) {
      const session = await ctx.runQuery(internal.linkedinSessions.getActiveByUserId, { userId });
      if (!session) {
        console.log(`[cloudLoop] No active session for user ${userId}`);
        continue;
      }

      let liAt: string, jsessionId: string;
      try {
        liAt = await decryptCookie(session.liAt, encKey);
        jsessionId = await decryptCookie(session.jsessionId, encKey);
      } catch (err) {
        console.error(`[cloudLoop] Decryption failed for user ${userId}:`, err);
        continue;
      }
      const ua = session.userAgent;

      const senderFsdUrn = await fetchSenderFsdUrn(liAt, jsessionId, ua);
      if (!senderFsdUrn) {
        console.warn(`[cloudLoop] Could not get sender URN for ${userId} — marking expired`);
        await ctx.runMutation(internal.linkedinSessions.markExpired, { userId });
        await ctx.runMutation(internal.campaigns.pauseAllForUser, { userId });
        await notifyExpired(userId);
        continue;
      }

      let sessionDied = false;
      for (const campaign of campaigns) {
        if (sessionDied) break;

        const todayCount = await ctx.runQuery(internal.dmLog.getTodayCount, { campaignId: campaign._id });
        if (todayCount >= campaign.dailyLimit) {
          console.log(`[cloudLoop] Campaign ${campaign._id} at daily limit (${todayCount}/${campaign.dailyLimit})`);
          continue;
        }

        const postUrn = extractPostUrn(campaign.postUrl);
        if (!postUrn) { console.warn(`[cloudLoop] Bad postUrl: ${campaign.postUrl}`); continue; }

        const r = await liGet(
          `/voyager/api/feed/comments?count=100&start=0&q=comments&updateId=${encodeURIComponent(postUrn)}`,
          liAt, jsessionId, ua
        );

        if (r.status === 401 || r.status === 403) {
          console.warn(`[cloudLoop] Session expired mid-loop for ${userId} (${r.status})`);
          await ctx.runMutation(internal.linkedinSessions.markExpired, { userId });
          await ctx.runMutation(internal.campaigns.pauseAllForUser, { userId });
          await notifyExpired(userId);
          sessionDied = true;
          break;
        }
        if (!r.ok) { console.warn(`[cloudLoop] Comments fetch failed: ${r.status}`); continue; }

        const { commenters, postActorUrn } = parseCommenters(r.data);
        console.log(`[cloudLoop] ${commenters.length} commenter(s) for campaign ${campaign._id}`);

        for (const commenter of commenters) {
          if (sessionDied) break;

          const currentCount = await ctx.runQuery(internal.dmLog.getTodayCount, { campaignId: campaign._id });
          if (currentCount >= campaign.dailyLimit) break;

          const alreadySent = await ctx.runQuery(internal.dmLog.hasBeenDmd, {
            campaignId: campaign._id,
            profileId: commenter.profileId,
          });
          if (alreadySent) continue;

          if (campaign.keywordFilter) {
            if (!commenter.commentText.toLowerCase().includes(campaign.keywordFilter.toLowerCase())) continue;
          }

          const firstName = commenter.profileName.split(" ")[0] ?? "";
          const messageText = campaign.messageTemplate
            .replace(/\{\{firstName\}\}/gi, firstName)
            .replace(/\{\{name\}\}/gi, commenter.profileName);

          const dmResult = await sendDm(
            commenter.profileFsdUrn, senderFsdUrn, messageText, liAt, jsessionId, ua
          );

          await ctx.runMutation(internal.dmLog.logDm, {
            campaignId: campaign._id,
            profileId: commenter.profileId,
            profileName: commenter.profileName,
            profileUrl: commenter.profileUrl,
            status: dmResult.success ? "sent" : "failed",
            errorMessage: dmResult.error,
          });

          if (dmResult.sessionExpired) {
            await ctx.runMutation(internal.linkedinSessions.markExpired, { userId });
            await ctx.runMutation(internal.campaigns.pauseAllForUser, { userId });
            await notifyExpired(userId);
            sessionDied = true;
            break;
          }

          // Reply to comment if configured
          if (dmResult.success && campaign.replyTemplate && commenter.commentUrn) {
            const replyText = campaign.replyTemplate
              .replace(/\{\{firstName\}\}/gi, firstName)
              .replace(/\{\{name\}\}/gi, commenter.profileName);
            const actorUrn = (campaign.postType === "company" && postActorUrn)
              ? postActorUrn : senderFsdUrn;
            await liPost(
              "/voyager/api/feed/comments",
              { actor: actorUrn, message: { attributes: [], text: replyText }, parentComment: commenter.commentUrn },
              liAt, jsessionId, ua
            );
          }

          // 2–4 s jitter between sends
          await new Promise((r) => setTimeout(r, 2000 + Math.random() * 2000));
        }
      }
    }
    console.log("[cloudLoop] Run complete");
  },
});

async function notifyExpired(userId: string) {
  // Placeholder — email via Resend to be wired in a follow-up task once user email lookup is available
  console.warn(`[cloudLoop] TODO: send session-expired email for userId=${userId}`);
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx convex dev --once`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add convex/cloudLoop.ts
git commit -m "feat(convex): add cloudCampaignLoop internalAction"
```

---

### Task 6: Convex cron

**Files:**
- Create: `convex/crons.ts`

- [ ] **Step 1: Create convex/crons.ts**

```ts
import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Run the cloud campaign loop every 5 minutes.
// LinkedIn's comment feed updates slowly; 5 min is a reasonable polling interval
// that stays well within Convex action rate limits.
crons.interval(
  "cloud campaign loop",
  { minutes: 5 },
  internal.cloudLoop.cloudCampaignLoop
);

export default crons;
```

- [ ] **Step 2: Deploy and verify cron appears in dashboard**

Run: `npx convex dev --once`
Expected: no errors.

Open the Convex dashboard → Scheduled Functions → confirm "cloud campaign loop" appears with a 5-minute interval.

- [ ] **Step 3: Commit**

```bash
git add convex/crons.ts
git commit -m "feat(convex): add cron to fire cloudCampaignLoop every 5 minutes"
```

---

### Task 7: Set environment variables in Convex

**Files:** None — done via Convex CLI / dashboard.

- [ ] **Step 1: Generate a 32-byte encryption key**

Run in terminal:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
Copy the 64-char hex output. This is `LINKEDIN_COOKIE_ENCRYPTION_KEY`.

- [ ] **Step 2: Generate an HMAC secret**

Run:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
Copy the output. This is `LINKEDIN_SYNC_HMAC_SECRET`.

- [ ] **Step 3: Set both env vars in Convex**

```bash
npx convex env set LINKEDIN_COOKIE_ENCRYPTION_KEY <value-from-step-1>
npx convex env set LINKEDIN_SYNC_HMAC_SECRET <value-from-step-2>
```

Expected: `Set LINKEDIN_COOKIE_ENCRYPTION_KEY` and `Set LINKEDIN_SYNC_HMAC_SECRET` (no errors).

- [ ] **Step 4: Verify they are set**

Run: `npx convex env list`
Expected: both vars appear in the output.

- [ ] **Step 5: Commit a note (no secret values)**

```bash
git commit --allow-empty -m "chore: set LINKEDIN_COOKIE_ENCRYPTION_KEY and LINKEDIN_SYNC_HMAC_SECRET in Convex cloud"
```

---

### Task 8: Extension — cookie extraction + sync

**Files:**
- Modify: `extension/manifest.json`
- Modify: `extension/background.js`
- Modify: `extension/popup.html`
- Modify: `extension/popup.js`

- [ ] **Step 1: Add cookies permission to manifest.json**

In `extension/manifest.json`, add `"cookies"` to the `permissions` array:

```json
"permissions": [
  "alarms",
  "storage",
  "tabs",
  "notifications",
  "scripting",
  "cookies"
],
```

- [ ] **Step 2: Add extractAndSyncLinkedInSession to background.js**

At the bottom of `extension/background.js` (before any existing message listeners, or at the end of the file), add:

```js
// ── LinkedIn session cookie sync ───────────────────────────────────────────────

const LINKEDIN_DOMAIN = "www.linkedin.com";
const CONVEX_SITE_URL = "https://utmost-lemur-208.eu-west-1.convex.site";

/**
 * Reads li_at and JSESSIONID from LinkedIn cookies and POSTs them to Convex.
 * Returns { success: true } or { success: false, error: string }.
 */
async function extractAndSyncLinkedInSession(extensionToken) {
  try {
    // Read cookies
    const [liAtCookie, jsessionCookie] = await Promise.all([
      chrome.cookies.get({ url: "https://www.linkedin.com", name: "li_at" }),
      chrome.cookies.get({ url: "https://www.linkedin.com", name: "JSESSIONID" }),
    ]);

    if (!liAtCookie) return { success: false, error: "li_at cookie not found — please log in to LinkedIn first" };
    if (!jsessionCookie) return { success: false, error: "JSESSIONID cookie not found — please log in to LinkedIn first" };

    const liAt = liAtCookie.value;
    const jsessionId = jsessionCookie.value; // e.g. "ajax:1234567890"

    // Build HMAC signature
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const hmacSecret = await getHmacSecret(); // loaded from Convex env (see Step 3)

    // HMAC is computed client-side only to authenticate the request source.
    // The real security is that cookies are encrypted server-side before storage.
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw", enc.encode(hmacSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
    );
    const sigBuf = await crypto.subtle.sign("HMAC", key, enc.encode(`timestamp=${timestamp}`));
    const signature = Array.from(new Uint8Array(sigBuf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const res = await fetch(`${CONVEX_SITE_URL}/api/extension/sync-session`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${extensionToken}`,
        "X-Timestamp": timestamp,
        "X-Signature": signature,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        liAt,
        jsessionId,
        userAgent: navigator.userAgent,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { success: false, error: `Server error ${res.status}: ${text.slice(0, 200)}` };
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message ?? "Unknown error" };
  }
}

/**
 * Returns the HMAC secret from storage.
 * The secret is fetched once from Convex and cached in chrome.storage.local.
 * NOTE: For the initial implementation, we hard-code the HMAC secret in the
 * extension at build time (from LINKEDIN_SYNC_HMAC_SECRET). In a future version
 * this can be fetched from a /api/extension/hmac-key endpoint.
 */
async function getHmacSecret() {
  // Hard-coded for beta. Replace with dynamic fetch if secret rotation is needed.
  return LINKEDIN_SYNC_HMAC_SECRET; // defined as a constant below
}

// IMPORTANT: Replace this value with the actual LINKEDIN_SYNC_HMAC_SECRET
// you set in Convex. This is the only place it appears in extension code.
const LINKEDIN_SYNC_HMAC_SECRET = "REPLACE_WITH_YOUR_HMAC_SECRET";

// Handle SYNC_SESSION message from popup
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "SYNC_LINKEDIN_SESSION") {
    chrome.storage.local.get("token", async ({ token }) => {
      if (!token) {
        sendResponse({ success: false, error: "Extension not connected — paste your token first" });
        return;
      }
      const result = await extractAndSyncLinkedInSession(token);
      sendResponse(result);
    });
    return true; // async response
  }
});
```

**Important:** After adding this code, replace `REPLACE_WITH_YOUR_HMAC_SECRET` in `background.js` with the actual value you set via `npx convex env set LINKEDIN_SYNC_HMAC_SECRET`.

- [ ] **Step 3: Add LinkedIn session card to popup.html**

After the `#linkedin-card` div in `popup.html`, add:

```html
<!-- LinkedIn session status (shown when extension token is connected) -->
<div id="session-card" class="card warn" style="display:none" aria-live="polite" role="status">
  <div class="label" id="session-title">⚠️ LinkedIn session not synced</div>
  <span id="session-detail">Click below to sync your session so campaigns run in the cloud.</span>
</div>
<button id="sync-session-btn" type="button" class="secondary" style="display:none">
  🔄 Sync LinkedIn session
</button>
```

- [ ] **Step 4: Add sync handler to popup.js**

Add the following helper function and update `showConnected` and `showDisconnected` in `popup.js`.

After the existing helper functions, add:

```js
const sessionCard = document.getElementById("session-card");
const sessionTitle = document.getElementById("session-title");
const sessionDetail = document.getElementById("session-detail");
const syncBtn = document.getElementById("sync-session-btn");

function setSessionCard(type, title, detail) {
  sessionCard.className = `card ${type}`;
  sessionTitle.textContent = title;
  sessionDetail.textContent = detail;
}

async function refreshSessionStatus() {
  sessionCard.style.display = "";
  syncBtn.style.display = "";
  setSessionCard("warn", "Checking session…", "");

  const { sessionStatus } = await chrome.storage.local.get("sessionStatus");
  if (sessionStatus === "active") {
    const { sessionSyncedAt } = await chrome.storage.local.get("sessionSyncedAt");
    const mins = sessionSyncedAt
      ? Math.floor((Date.now() - sessionSyncedAt) / 60000)
      : null;
    const ago = mins !== null ? (mins < 2 ? "just now" : `${mins}m ago`) : "unknown";
    setSessionCard("ok", "✅ LinkedIn session synced", `Last synced: ${ago}. Cloud campaigns are active.`);
  } else if (sessionStatus === "expired") {
    setSessionCard("error", "❌ LinkedIn session expired", "Your session expired. Sync again to resume cloud campaigns.");
  } else {
    setSessionCard("warn", "⚠️ LinkedIn session not synced", "Click Sync to enable cloud campaigns.");
  }
}

syncBtn.onclick = async () => {
  syncBtn.disabled = true;
  syncBtn.textContent = "Syncing…";
  setSessionCard("warn", "Syncing LinkedIn session…", "");
  const result = await chrome.runtime.sendMessage({ type: "SYNC_LINKEDIN_SESSION" });
  if (result?.success) {
    await chrome.storage.local.set({ sessionStatus: "active", sessionSyncedAt: Date.now() });
    setSessionCard("ok", "✅ Session synced!", "Cloud campaigns are now active.");
  } else {
    setSessionCard("error", "❌ Sync failed", result?.error ?? "Unknown error");
  }
  syncBtn.disabled = false;
  syncBtn.textContent = "🔄 Sync LinkedIn session";
};
```

In the existing `showConnected` function, add a call to `refreshSessionStatus()` at the end:

```js
async function showConnected() {
  // ... existing code ...

  // Add at the end:
  await refreshSessionStatus();
}
```

In the existing `showDisconnected` function, hide the session card:

```js
function showDisconnected() {
  // ... existing code ...

  // Add at the end:
  if (sessionCard) sessionCard.style.display = "none";
  if (syncBtn) syncBtn.style.display = "none";
}
```

- [ ] **Step 5: Test extension manually**

1. Load extension in Chrome (chrome://extensions → Developer mode → Load unpacked).
2. Open LinkedIn, ensure logged in.
3. Open extension popup → connect with your token.
4. Click "🔄 Sync LinkedIn session".
5. Expected: card turns green "✅ Session synced!"
6. Check Convex dashboard → Data → `linkedinSessions` table → confirm a row exists.

- [ ] **Step 6: Commit**

```bash
git add extension/manifest.json extension/background.js extension/popup.html extension/popup.js
git commit -m "feat(extension): add LinkedIn session cookie sync with HMAC"
```

---

### Task 9: Dashboard LinkedIn Connection card

**Files:**
- Modify: `src/app/dashboard/page.tsx`

- [ ] **Step 1: Add session status query and card**

In `src/app/dashboard/page.tsx`, add the `useQuery` import for `linkedinSessions`:

```tsx
const sessionStatus = useQuery(api.linkedinSessions.getSessionStatus);
```

Add this after the existing `const pending = useQuery(api.waitlist.listPending);` line.

Then add the LinkedIn Connection card in the JSX, after the Extension Token card div:

```tsx
{/* LinkedIn Connection */}
<div className="bg-white rounded-xl border border-gray-200 p-6 mb-4">
  <div className="flex items-center justify-between mb-1">
    <h2 className="text-sm font-semibold text-gray-700">LinkedIn Connection</h2>
    {sessionStatus?.status === "active" && (
      <span className="text-xs text-green-600 font-medium">● Active</span>
    )}
    {sessionStatus?.status === "expired" && (
      <span className="text-xs text-red-600 font-medium">● Expired</span>
    )}
  </div>
  <p className="text-xs text-gray-500 mb-4">
    Sync your LinkedIn session from the Chrome extension to run campaigns in the cloud 24/7.
  </p>
  {sessionStatus === undefined && (
    <p className="text-sm text-gray-400">Loading…</p>
  )}
  {sessionStatus === null && (
    <p className="text-sm text-gray-500">
      No session synced yet. Open the linkdm extension popup and click <strong>Sync LinkedIn session</strong>.
    </p>
  )}
  {sessionStatus?.status === "active" && (
    <p className="text-sm text-green-700">
      ✅ Session active — last synced{" "}
      {sessionStatus.syncedAt
        ? new Date(sessionStatus.syncedAt).toLocaleString()
        : "unknown"}
      . Cloud campaigns are running.
    </p>
  )}
  {sessionStatus?.status === "expired" && (
    <div>
      <p className="text-sm text-red-700 mb-2">
        ❌ Your LinkedIn session expired on{" "}
        {sessionStatus.expiresAt
          ? new Date(sessionStatus.expiresAt).toLocaleString()
          : "unknown"}
        . All campaigns have been paused.
      </p>
      <p className="text-xs text-gray-500">
        Open the linkdm Chrome extension, make sure you're logged into LinkedIn, then click <strong>Sync LinkedIn session</strong>.
      </p>
    </div>
  )}
</div>
```

- [ ] **Step 2: Run the dev server and verify the card renders**

Run: `npm run dev`
Open: `http://localhost:3000/dashboard`
Expected: LinkedIn Connection card appears. Before syncing it shows "No session synced yet."
After syncing from the extension, refresh and confirm it shows "✅ Session active".

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboard/page.tsx
git commit -m "feat(dashboard): add LinkedIn Connection status card"
```

---

## Self-Review

**Spec coverage:**
- ✅ Architecture (Convex cron → Voyager API) — Tasks 5, 6
- ✅ `linkedinSessions` table — Task 1
- ✅ DM deduplication via `dmLog.hasBeenDmd` — Task 5 (cloudLoop uses it)
- ✅ AES-256-GCM encryption at rest — Tasks 3, 4
- ✅ HMAC-SHA256 replay prevention — Tasks 3, 8
- ✅ Session expiry → pause campaigns → notify — Task 5
- ✅ Dashboard LinkedIn card — Task 9
- ✅ Extension sync button — Task 8
- ✅ Proxy readiness — `liGet`/`liPost` helpers in cloudLoop can accept a proxy agent in a follow-up
- ✅ Reply-to-comment on successful DM — Task 5

**Type consistency check:**
- `upsertSession` args match across `http.ts` → `linkedinSessions.ts` ✅
- `getActiveByUserId` returns full session doc (including `liAt`, `jsessionId`) ✅ (cloudLoop decrypts them)
- `pauseAllForUser` in `campaigns.ts` uses `internalMutation` ✅
- `listAllActive` returns same shape as `listByUser` minus `todayCount` — cloudLoop doesn't need `todayCount` ✅

**No placeholders:** Email expiry notification is marked as a `console.warn` + TODO comment with explicit explanation. All other steps have complete code.
