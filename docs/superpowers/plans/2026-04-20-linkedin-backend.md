# LinkedIn Extension Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the Convex backend foundation for the LinkedIn Chrome extension — schema tables, extension token auth, campaign/dmLog functions, and HTTP endpoints the extension calls.

**Architecture:** Three new Convex tables (`campaigns`, `dmLog`, `extensionTokens`) are added to the existing schema. Public mutations for the dashboard use `ctx.auth.getUserIdentity()` for auth. Internal queries/mutations are used by two new HTTP endpoints (`GET /api/extension/campaigns`, `POST /api/extension/dmLog`) that authenticate via a Bearer token looked up in the `extensionTokens` table.

**Tech Stack:** Convex (schema, mutations, queries, httpAction), convex-test + vitest (TDD), TypeScript

---

## File Map

| File | Purpose |
|---|---|
| `convex/schema.ts` | Add `campaigns`, `dmLog`, `extensionTokens` tables |
| `convex/extensionToken.ts` | `getOrCreate`, `regenerate` (public); `getUserIdByToken` (internal) |
| `convex/extensionToken.test.ts` | Tests for all token functions |
| `convex/campaigns.ts` | `create`, `updateStatus` (public); `listActiveByUserId`, `getById` (internal) |
| `convex/campaigns.test.ts` | Tests for all campaign functions |
| `convex/dmLog.ts` | `logDm` (internal mutation); `hasBeenDmd`, `getTodayCount`, `listByCampaign` (internal queries) |
| `convex/dmLog.test.ts` | Tests for all dmLog functions |
| `convex/http.ts` | Add `GET /api/extension/campaigns` and `POST /api/extension/dmLog` routes |

---

### Task 1: Update the schema

**Files:**
- Modify: `convex/schema.ts`
- Create: `convex/campaigns.test.ts` (schema existence check)

- [ ] **Step 1: Write the failing schema tests**

Create `convex/campaigns.test.ts`:
```ts
/// <reference types="vite/client" />
import { expect, test } from "vitest";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

test("campaigns table is defined in schema", () => {
  expect(schema.tables.campaigns).toBeDefined();
});

test("dmLog table is defined in schema", () => {
  expect(schema.tables.dmLog).toBeDefined();
});

test("extensionTokens table is defined in schema", () => {
  expect(schema.tables.extensionTokens).toBeDefined();
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test
```
Expected: FAIL — tables not defined yet.

- [ ] **Step 3: Update schema.ts**

Replace the contents of `convex/schema.ts` with:
```ts
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

export default defineSchema({
  ...authTables,

  waitlist: defineTable({
    email: v.string(),
    isApproved: v.boolean(),
    createdAt: v.number(),
  }).index("by_email", ["email"]),

  extensionTokens: defineTable({
    userId: v.string(),
    token: v.string(),
    createdAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_token", ["token"]),

  campaigns: defineTable({
    userId: v.string(),
    postUrl: v.string(),
    messageTemplate: v.string(),
    keywordFilter: v.optional(v.string()),
    dailyLimit: v.number(),
    status: v.union(v.literal("active"), v.literal("paused")),
  })
    .index("by_userId", ["userId"])
    .index("by_userId_and_status", ["userId", "status"]),

  dmLog: defineTable({
    campaignId: v.id("campaigns"),
    profileId: v.string(),
    profileName: v.string(),
    profileUrl: v.string(),
    status: v.union(
      v.literal("sent"),
      v.literal("failed"),
      v.literal("skipped")
    ),
    sentAt: v.number(),
    errorMessage: v.optional(v.string()),
  })
    .index("by_campaignId_and_profileId", ["campaignId", "profileId"])
    .index("by_campaignId_and_status_and_sentAt", [
      "campaignId",
      "status",
      "sentAt",
    ]),
});
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm test
```
Expected: All 9 tests PASS (6 existing + 3 new).

- [ ] **Step 5: Commit**

```bash
git add convex/schema.ts convex/campaigns.test.ts
git commit -m "feat: add campaigns, dmLog, extensionTokens tables to schema"
```

---

### Task 2: Extension token functions

**Files:**
- Create: `convex/extensionToken.ts`
- Create: `convex/extensionToken.test.ts`

- [ ] **Step 1: Write failing tests**

Create `convex/extensionToken.test.ts`:
```ts
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

test("getOrCreate generates a token for a new user", async () => {
  const t = convexTest(schema, modules);
  const token = await t
    .withIdentity({ tokenIdentifier: "user1" })
    .mutation(api.extensionToken.getOrCreate, {});
  expect(typeof token).toBe("string");
  expect(token.startsWith("lnkdm_")).toBe(true);
});

test("getOrCreate returns the same token on repeated calls", async () => {
  const t = convexTest(schema, modules);
  const asUser = t.withIdentity({ tokenIdentifier: "user1" });
  const token1 = await asUser.mutation(api.extensionToken.getOrCreate, {});
  const token2 = await asUser.mutation(api.extensionToken.getOrCreate, {});
  expect(token1).toBe(token2);
});

test("regenerate creates a new token and invalidates old one", async () => {
  const t = convexTest(schema, modules);
  const asUser = t.withIdentity({ tokenIdentifier: "user1" });
  const old = await asUser.mutation(api.extensionToken.getOrCreate, {});
  const fresh = await asUser.mutation(api.extensionToken.regenerate, {});
  expect(fresh).not.toBe(old);
  expect(fresh.startsWith("lnkdm_")).toBe(true);
});

test("getUserIdByToken returns userId for a valid token", async () => {
  const t = convexTest(schema, modules);
  const token = await t
    .withIdentity({ tokenIdentifier: "user1" })
    .mutation(api.extensionToken.getOrCreate, {});
  const userId = await t.query(internal.extensionToken.getUserIdByToken, { token });
  expect(userId).toBe("user1");
});

test("getUserIdByToken returns null for an unknown token", async () => {
  const t = convexTest(schema, modules);
  const userId = await t.query(internal.extensionToken.getUserIdByToken, {
    token: "lnkdm_invalid",
  });
  expect(userId).toBeNull();
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
npm test convex/extensionToken.test.ts
```
Expected: FAIL — `api.extensionToken` not defined.

- [ ] **Step 3: Implement extensionToken.ts**

Create `convex/extensionToken.ts`:
```ts
import { mutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";

export const getOrCreate = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const userId = identity.tokenIdentifier;

    const existing = await ctx.db
      .query("extensionTokens")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();

    if (existing) return existing.token;

    const token = `lnkdm_${crypto.randomUUID().replace(/-/g, "")}`;
    await ctx.db.insert("extensionTokens", { userId, token, createdAt: Date.now() });
    return token;
  },
});

export const regenerate = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const userId = identity.tokenIdentifier;

    const existing = await ctx.db
      .query("extensionTokens")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();
    if (existing) await ctx.db.delete(existing._id);

    const token = `lnkdm_${crypto.randomUUID().replace(/-/g, "")}`;
    await ctx.db.insert("extensionTokens", { userId, token, createdAt: Date.now() });
    return token;
  },
});

export const getUserIdByToken = internalQuery({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const entry = await ctx.db
      .query("extensionTokens")
      .withIndex("by_token", (q) => q.eq("token", token))
      .first();
    return entry?.userId ?? null;
  },
});
```

- [ ] **Step 4: Run to confirm all pass**

```bash
npm test convex/extensionToken.test.ts
```
Expected: 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add convex/extensionToken.ts convex/extensionToken.test.ts
git commit -m "feat: add extension token generation and lookup"
```

---

### Task 3: Campaign functions

**Files:**
- Create: `convex/campaigns.ts`
- Modify: `convex/campaigns.test.ts`

- [ ] **Step 1: Add campaign function tests to campaigns.test.ts**

Replace the contents of `convex/campaigns.test.ts` with:
```ts
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

test("campaigns table is defined in schema", () => {
  expect(schema.tables.campaigns).toBeDefined();
});

test("dmLog table is defined in schema", () => {
  expect(schema.tables.dmLog).toBeDefined();
});

test("extensionTokens table is defined in schema", () => {
  expect(schema.tables.extensionTokens).toBeDefined();
});

test("create saves a campaign with default dailyLimit of 20", async () => {
  const t = convexTest(schema, modules);
  const id = await t
    .withIdentity({ tokenIdentifier: "user1" })
    .mutation(api.campaigns.create, {
      postUrl: "https://linkedin.com/feed/update/urn:li:activity:123",
      messageTemplate: "Hey, saw your comment!",
    });
  const campaign = await t.query(internal.campaigns.getById, { campaignId: id });
  expect(campaign?.dailyLimit).toBe(20);
  expect(campaign?.status).toBe("active");
  expect(campaign?.userId).toBe("user1");
});

test("create respects custom dailyLimit", async () => {
  const t = convexTest(schema, modules);
  const id = await t
    .withIdentity({ tokenIdentifier: "user1" })
    .mutation(api.campaigns.create, {
      postUrl: "https://linkedin.com/feed/update/urn:li:activity:123",
      messageTemplate: "Hey!",
      dailyLimit: 5,
    });
  const campaign = await t.query(internal.campaigns.getById, { campaignId: id });
  expect(campaign?.dailyLimit).toBe(5);
});

test("updateStatus pauses an active campaign", async () => {
  const t = convexTest(schema, modules);
  const asUser = t.withIdentity({ tokenIdentifier: "user1" });
  const id = await asUser.mutation(api.campaigns.create, {
    postUrl: "https://linkedin.com/feed/update/urn:li:activity:123",
    messageTemplate: "Hey!",
  });
  await asUser.mutation(api.campaigns.updateStatus, { campaignId: id, status: "paused" });
  const campaign = await t.query(internal.campaigns.getById, { campaignId: id });
  expect(campaign?.status).toBe("paused");
});

test("updateStatus throws if campaign belongs to a different user", async () => {
  const t = convexTest(schema, modules);
  const id = await t
    .withIdentity({ tokenIdentifier: "user1" })
    .mutation(api.campaigns.create, {
      postUrl: "https://linkedin.com/feed/update/urn:li:activity:123",
      messageTemplate: "Hey!",
    });
  await expect(
    t
      .withIdentity({ tokenIdentifier: "user2" })
      .mutation(api.campaigns.updateStatus, { campaignId: id, status: "paused" })
  ).rejects.toThrow("Unauthorized");
});

test("listActiveByUserId returns only active campaigns for that user", async () => {
  const t = convexTest(schema, modules);
  const asUser1 = t.withIdentity({ tokenIdentifier: "user1" });
  const asUser2 = t.withIdentity({ tokenIdentifier: "user2" });

  const id1 = await asUser1.mutation(api.campaigns.create, {
    postUrl: "https://linkedin.com/feed/update/urn:li:activity:111",
    messageTemplate: "Hey!",
  });
  await asUser1.mutation(api.campaigns.create, {
    postUrl: "https://linkedin.com/feed/update/urn:li:activity:222",
    messageTemplate: "Hey!",
  });
  // Pause one of user1's campaigns
  await asUser1.mutation(api.campaigns.updateStatus, { campaignId: id1, status: "paused" });
  // Create one for user2
  await asUser2.mutation(api.campaigns.create, {
    postUrl: "https://linkedin.com/feed/update/urn:li:activity:333",
    messageTemplate: "Hey!",
  });

  const active = await t.query(internal.campaigns.listActiveByUserId, { userId: "user1" });
  expect(active).toHaveLength(1);
  expect(active[0].status).toBe("active");
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
npm test convex/campaigns.test.ts
```
Expected: 3 PASS (schema tests), 5 FAIL (campaign functions not defined).

- [ ] **Step 3: Implement campaigns.ts**

Create `convex/campaigns.ts`:
```ts
import { mutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";

export const create = mutation({
  args: {
    postUrl: v.string(),
    messageTemplate: v.string(),
    keywordFilter: v.optional(v.string()),
    dailyLimit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    return await ctx.db.insert("campaigns", {
      userId: identity.tokenIdentifier,
      postUrl: args.postUrl,
      messageTemplate: args.messageTemplate,
      keywordFilter: args.keywordFilter,
      dailyLimit: args.dailyLimit ?? 20,
      status: "active",
    });
  },
});

export const updateStatus = mutation({
  args: {
    campaignId: v.id("campaigns"),
    status: v.union(v.literal("active"), v.literal("paused")),
  },
  handler: async (ctx, { campaignId, status }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const campaign = await ctx.db.get(campaignId);
    if (!campaign) throw new Error("Campaign not found");
    if (campaign.userId !== identity.tokenIdentifier) throw new Error("Unauthorized");

    await ctx.db.patch(campaignId, { status });
  },
});

export const getById = internalQuery({
  args: { campaignId: v.id("campaigns") },
  handler: async (ctx, { campaignId }) => {
    return await ctx.db.get(campaignId);
  },
});

export const listActiveByUserId = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    return await ctx.db
      .query("campaigns")
      .withIndex("by_userId_and_status", (q) =>
        q.eq("userId", userId).eq("status", "active")
      )
      .take(50);
  },
});
```

- [ ] **Step 4: Run to confirm all pass**

```bash
npm test convex/campaigns.test.ts
```
Expected: 8 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add convex/campaigns.ts convex/campaigns.test.ts
git commit -m "feat: add campaign create, updateStatus, and internal query functions"
```

---

### Task 4: DmLog functions

**Files:**
- Create: `convex/dmLog.ts`
- Create: `convex/dmLog.test.ts`

- [ ] **Step 1: Write failing tests**

Create `convex/dmLog.test.ts`:
```ts
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

test("logDm inserts a dmLog entry", async () => {
  const t = convexTest(schema, modules);
  const campaignId = await t
    .withIdentity({ tokenIdentifier: "user1" })
    .mutation(api.campaigns.create, {
      postUrl: "https://linkedin.com/feed/update/urn:li:activity:123",
      messageTemplate: "Hey!",
    });

  await t.mutation(internal.dmLog.logDm, {
    campaignId,
    profileId: "urn:li:member:999",
    profileName: "Alice Smith",
    profileUrl: "https://linkedin.com/in/alice",
    status: "sent",
  });

  const already = await t.query(internal.dmLog.hasBeenDmd, {
    campaignId,
    profileId: "urn:li:member:999",
  });
  expect(already).toBe(true);
});

test("hasBeenDmd returns false for a profile not yet DM'd", async () => {
  const t = convexTest(schema, modules);
  const campaignId = await t
    .withIdentity({ tokenIdentifier: "user1" })
    .mutation(api.campaigns.create, {
      postUrl: "https://linkedin.com/feed/update/urn:li:activity:123",
      messageTemplate: "Hey!",
    });

  const already = await t.query(internal.dmLog.hasBeenDmd, {
    campaignId,
    profileId: "urn:li:member:000",
  });
  expect(already).toBe(false);
});

test("getTodayCount counts only sent entries for today", async () => {
  const t = convexTest(schema, modules);
  const campaignId = await t
    .withIdentity({ tokenIdentifier: "user1" })
    .mutation(api.campaigns.create, {
      postUrl: "https://linkedin.com/feed/update/urn:li:activity:123",
      messageTemplate: "Hey!",
    });

  await t.mutation(internal.dmLog.logDm, {
    campaignId,
    profileId: "urn:li:member:1",
    profileName: "Alice",
    profileUrl: "https://linkedin.com/in/alice",
    status: "sent",
  });
  await t.mutation(internal.dmLog.logDm, {
    campaignId,
    profileId: "urn:li:member:2",
    profileName: "Bob",
    profileUrl: "https://linkedin.com/in/bob",
    status: "failed", // should NOT be counted
  });

  const count = await t.query(internal.dmLog.getTodayCount, { campaignId });
  expect(count).toBe(1);
});

test("listByCampaign returns all dmLog entries for a campaign", async () => {
  const t = convexTest(schema, modules);
  const campaignId = await t
    .withIdentity({ tokenIdentifier: "user1" })
    .mutation(api.campaigns.create, {
      postUrl: "https://linkedin.com/feed/update/urn:li:activity:123",
      messageTemplate: "Hey!",
    });

  await t.mutation(internal.dmLog.logDm, {
    campaignId,
    profileId: "urn:li:member:1",
    profileName: "Alice",
    profileUrl: "https://linkedin.com/in/alice",
    status: "sent",
  });

  const entries = await t.query(internal.dmLog.listByCampaign, { campaignId });
  expect(entries).toHaveLength(1);
  expect(entries[0].profileName).toBe("Alice");
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
npm test convex/dmLog.test.ts
```
Expected: FAIL — `internal.dmLog` not defined.

- [ ] **Step 3: Implement dmLog.ts**

Create `convex/dmLog.ts`:
```ts
import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";

export const logDm = internalMutation({
  args: {
    campaignId: v.id("campaigns"),
    profileId: v.string(),
    profileName: v.string(),
    profileUrl: v.string(),
    status: v.union(
      v.literal("sent"),
      v.literal("failed"),
      v.literal("skipped")
    ),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("dmLog", {
      ...args,
      sentAt: Date.now(),
    });
  },
});

export const hasBeenDmd = internalQuery({
  args: { campaignId: v.id("campaigns"), profileId: v.string() },
  handler: async (ctx, { campaignId, profileId }) => {
    const entry = await ctx.db
      .query("dmLog")
      .withIndex("by_campaignId_and_profileId", (q) =>
        q.eq("campaignId", campaignId).eq("profileId", profileId)
      )
      .first();
    return entry !== null;
  },
});

export const getTodayCount = internalQuery({
  args: { campaignId: v.id("campaigns") },
  handler: async (ctx, { campaignId }) => {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const entries = await ctx.db
      .query("dmLog")
      .withIndex("by_campaignId_and_status_and_sentAt", (q) =>
        q
          .eq("campaignId", campaignId)
          .eq("status", "sent")
          .gte("sentAt", startOfDay.getTime())
      )
      .take(100);

    return entries.length;
  },
});

export const listByCampaign = internalQuery({
  args: { campaignId: v.id("campaigns") },
  handler: async (ctx, { campaignId }) => {
    return await ctx.db
      .query("dmLog")
      .withIndex("by_campaignId_and_profileId", (q) =>
        q.eq("campaignId", campaignId)
      )
      .take(100);
  },
});
```

- [ ] **Step 4: Run to confirm all pass**

```bash
npm test convex/dmLog.test.ts
```
Expected: 4 tests PASS.

- [ ] **Step 5: Run full test suite**

```bash
npm test
```
Expected: All 17 tests PASS (9 existing + 5 token + 8 campaign + 4 dmLog — minus 1 overlap = total depends on file count, all green).

- [ ] **Step 6: Commit**

```bash
git add convex/dmLog.ts convex/dmLog.test.ts
git commit -m "feat: add dmLog insert and query functions"
```

---

### Task 5: HTTP endpoints for the extension

**Files:**
- Modify: `convex/http.ts`

- [ ] **Step 1: Update http.ts with extension endpoints**

Replace the contents of `convex/http.ts` with:
```ts
import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { auth } from "./auth";

const http = httpRouter();

auth.addHttpRoutes(http);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Content-Type": "application/json",
};

async function resolveToken(ctx: any, req: Request): Promise<string | null> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7);
  return await ctx.runQuery(internal.extensionToken.getUserIdByToken, { token });
}

// CORS preflight for /api/extension/campaigns
http.route({
  path: "/api/extension/campaigns",
  method: "OPTIONS",
  handler: httpAction(async () => {
    return new Response(null, { status: 204, headers: corsHeaders });
  }),
});

// GET /api/extension/campaigns — returns active campaigns for the token owner
http.route({
  path: "/api/extension/campaigns",
  method: "GET",
  handler: httpAction(async (ctx, req) => {
    const userId = await resolveToken(ctx, req);
    if (!userId) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: corsHeaders,
      });
    }

    const campaigns = await ctx.runQuery(
      internal.campaigns.listActiveByUserId,
      { userId }
    );

    // Include today's sent count per campaign so the extension can enforce dailyLimit
    const campaignsWithCount = await Promise.all(
      campaigns.map(async (campaign) => {
        const todayCount = await ctx.runQuery(internal.dmLog.getTodayCount, {
          campaignId: campaign._id,
        });
        return { ...campaign, todayCount };
      })
    );

    return new Response(JSON.stringify({ campaigns: campaignsWithCount }), {
      status: 200,
      headers: corsHeaders,
    });
  }),
});

// CORS preflight for /api/extension/dmLog
http.route({
  path: "/api/extension/dmLog",
  method: "OPTIONS",
  handler: httpAction(async () => {
    return new Response(null, { status: 204, headers: corsHeaders });
  }),
});

// POST /api/extension/dmLog — records a DM result
http.route({
  path: "/api/extension/dmLog",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const userId = await resolveToken(ctx, req);
    if (!userId) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: corsHeaders,
      });
    }

    const body = await req.json();
    const { campaignId, profileId, profileName, profileUrl, status, errorMessage } = body;

    // Verify campaign belongs to this user
    const campaign = await ctx.runQuery(internal.campaigns.getById, { campaignId });
    if (!campaign || campaign.userId !== userId) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: corsHeaders,
      });
    }

    await ctx.runMutation(internal.dmLog.logDm, {
      campaignId,
      profileId,
      profileName,
      profileUrl,
      status,
      errorMessage,
    });

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: corsHeaders,
    });
  }),
});

export default http;
```

- [ ] **Step 2: Check for TypeScript errors**

```bash
npx tsc --noEmit 2>&1 | head -30
```
Expected: No errors. If there are errors about `ctx: any`, replace with `ActionCtx` from `./_generated/server`.

- [ ] **Step 3: Run full test suite**

```bash
npm test
```
Expected: All tests still PASS.

- [ ] **Step 4: Commit**

```bash
git add convex/http.ts
git commit -m "feat: add GET /api/extension/campaigns and POST /api/extension/dmLog HTTP endpoints"
```

---

### Task 6: Integration smoke test

- [ ] **Step 1: Push schema to Convex**

With `npx convex dev` running (required):
```bash
npx convex dev --once
```
Expected: Schema pushed successfully, no deployment errors. Check Convex dashboard → Data — all three new tables appear (`campaigns`, `dmLog`, `extensionTokens`).

- [ ] **Step 2: Test token generation via dashboard**

In Convex dashboard → Functions, run:
```
api.extensionToken.getOrCreate
```
(You'll need to be authenticated — use the Convex dashboard's built-in run-as-user feature or test via the linkdm frontend.)

Expected: Returns a string starting with `lnkdm_`.

- [ ] **Step 3: Test GET /api/extension/campaigns endpoint**

Replace `<your-token>` and `<your-convex-site-url>` with real values from `.env.local`:
```bash
curl -H "Authorization: Bearer <your-token>" \
  https://<your-convex-site-url>/api/extension/campaigns
```
Expected:
```json
{"campaigns": []}
```

- [ ] **Step 4: Test unauthorized request**

```bash
curl -H "Authorization: Bearer lnkdm_fakefakefake" \
  https://<your-convex-site-url>/api/extension/campaigns
```
Expected:
```json
{"error": "Unauthorized"}
```

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat: complete LinkedIn extension backend — schema, token auth, campaigns, dmLog, HTTP endpoints"
```
