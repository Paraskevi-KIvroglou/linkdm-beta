# Dashboard (Plan 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the campaign management UI and live activity feed so beta users can create, manage, and monitor their campaigns without ever touching the Convex dashboard.

**Architecture:** All new UI lives inside `src/app/dashboard/` as sub-pages and components. Two new Convex queries expose user-facing data: `campaigns.listByUser` (all campaigns with todayCount) and `dmLog.listRecentByUser` (last 50 DM events across all campaigns). The existing dashboard page (`src/app/dashboard/page.tsx`) gains a nav to the new sub-pages.

**Tech Stack:** Next.js 16 App Router | Convex real-time queries (`useQuery`) | Tailwind CSS v3 | `@convex-dev/auth/react` for identity

---

## Current state

Already built — do not rebuild:
- `convex/campaigns.ts` — `create`, `updateStatus`, `getById`, `listActiveByUserId` (internal only)
- `convex/dmLog.ts` — `logDm`, `hasBeenDmd`, `getTodayCount`, `listByCampaign` (all internal)
- `convex/extensionToken.ts` — `getOrCreate`, `regenerate`, `revoke`
- `convex/waitlist.ts` — `joinWaitlist`, `checkApproval`, `approveUser`, `listPending`, `sendApprovalEmail`
- `src/app/dashboard/page.tsx` — token management + waitlist approvals

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `convex/campaigns.ts` | Modify | Add `listByUser` public query (campaigns + todayCount per campaign) |
| `convex/dmLog.ts` | Modify | Add `listRecentByUser` public query (last 50 DMs across all user campaigns) |
| `src/app/dashboard/campaigns/page.tsx` | Create | Campaign list + create form + pause/resume controls |
| `src/app/dashboard/activity/page.tsx` | Create | Live DM activity feed |
| `src/app/dashboard/page.tsx` | Modify | Add nav links to Campaigns and Activity sub-pages |

---

## Task 1: Convex queries — user-facing campaigns and activity

**Files:**
- Modify: `convex/campaigns.ts`
- Modify: `convex/dmLog.ts`

These are the only Convex changes. All new queries are `query` (not `internalQuery`) so the frontend can call them directly.

- [ ] **Step 1: Add `listByUser` to `convex/campaigns.ts`**

This query returns all campaigns for the logged-in user, each enriched with `todayCount` (DMs sent today). The HTTP endpoint already does this for the extension — now we expose the same data to the dashboard.

Open `convex/campaigns.ts` and add at the bottom:

```ts
export const listByUser = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const userId = identity.tokenIdentifier;

    const campaigns = await ctx.db
      .query("campaigns")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();

    const now = Date.now();
    const startOfDay = now - (now % 86_400_000);

    return await Promise.all(
      campaigns.map(async (campaign) => {
        const sentToday = await ctx.db
          .query("dmLog")
          .withIndex("by_campaignId_and_status_and_sentAt", (q) =>
            q
              .eq("campaignId", campaign._id)
              .eq("status", "sent")
              .gte("sentAt", startOfDay)
          )
          .collect();
        return { ...campaign, todayCount: sentToday.length };
      })
    );
  },
});
```

Also add `query` to the import at the top of the file:

```ts
import { mutation, query, internalQuery } from "./_generated/server";
```

- [ ] **Step 2: Add `listRecentByUser` to `convex/dmLog.ts`**

This query returns the last 50 DM log entries across all of the user's campaigns. The dashboard uses it for the live activity feed.

Open `convex/dmLog.ts` and add at the top:

```ts
import { internalMutation, internalQuery, query } from "./_generated/server";
```

Then add at the bottom:

```ts
export const listRecentByUser = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const userId = identity.tokenIdentifier;

    // Get all campaign IDs for this user
    const campaigns = await ctx.db
      .query("campaigns")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();

    const campaignIds = new Set(campaigns.map((c) => c._id));

    // Fetch recent logs for each campaign and merge
    const allLogs = await Promise.all(
      [...campaignIds].map((campaignId) =>
        ctx.db
          .query("dmLog")
          .withIndex("by_campaignId_and_profileId", (q) =>
            q.eq("campaignId", campaignId)
          )
          .order("desc")
          .take(50)
      )
    );

    return allLogs
      .flat()
      .sort((a, b) => b.sentAt - a.sentAt)
      .slice(0, 50);
  },
});
```

- [ ] **Step 3: Deploy and verify TypeScript compiles**

```bash
cd "D:\pk\Work\LinkedIn Auto-DM Tool\linkdm\.worktrees\beta-login"
npx convex dev --once
```

Expected: `✔ Convex functions ready!` — no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
cd "D:\pk\Work\LinkedIn Auto-DM Tool\linkdm\.worktrees\beta-login"
git add convex/campaigns.ts convex/dmLog.ts
git commit -m "feat: add listByUser and listRecentByUser public queries"
```

---

## Task 2: Campaigns page — list, create, pause/resume

**Files:**
- Create: `src/app/dashboard/campaigns/page.tsx`

This is the main campaign management UI. It shows all campaigns with their status and today's DM count, lets the user create new ones via a form, and pause/resume with a single click.

- [ ] **Step 1: Create the campaigns page**

Create `src/app/dashboard/campaigns/page.tsx`:

```tsx
"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { useState } from "react";
import Link from "next/link";

export default function CampaignsPage() {
  const campaigns = useQuery(api.campaigns.listByUser);
  const createCampaign = useMutation(api.campaigns.create);
  const updateStatus = useMutation(api.campaigns.updateStatus);

  const [showForm, setShowForm] = useState(false);
  const [postUrl, setPostUrl] = useState("");
  const [messageTemplate, setMessageTemplate] = useState("");
  const [keywordFilter, setKeywordFilter] = useState("");
  const [dailyLimit, setDailyLimit] = useState("20");
  const [creating, setCreating] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      await createCampaign({
        postUrl: postUrl.trim(),
        messageTemplate: messageTemplate.trim(),
        keywordFilter: keywordFilter.trim() || undefined,
        dailyLimit: parseInt(dailyLimit, 10),
      });
      setPostUrl("");
      setMessageTemplate("");
      setKeywordFilter("");
      setDailyLimit("20");
      setShowForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create campaign");
    } finally {
      setCreating(false);
    }
  }

  async function handleToggle(
    campaignId: Id<"campaigns">,
    current: "active" | "paused"
  ) {
    setToggling(campaignId);
    try {
      await updateStatus({
        campaignId,
        status: current === "active" ? "paused" : "active",
      });
    } finally {
      setToggling(null);
    }
  }

  return (
    <main className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <Link href="/dashboard" className="text-sm text-gray-500 hover:text-gray-700">
              ← Dashboard
            </Link>
            <h1 className="text-2xl font-bold text-gray-900">Campaigns</h1>
          </div>
          <button
            onClick={() => setShowForm((v) => !v)}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
          >
            {showForm ? "Cancel" : "+ New campaign"}
          </button>
        </div>

        {/* Create form */}
        {showForm && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
            <h2 className="text-sm font-semibold text-gray-700 mb-4">New Campaign</h2>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  LinkedIn post URL <span className="text-red-500">*</span>
                </label>
                <input
                  type="url"
                  value={postUrl}
                  onChange={(e) => setPostUrl(e.target.value)}
                  required
                  placeholder="https://www.linkedin.com/feed/update/urn:li:activity:..."
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Message template <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={messageTemplate}
                  onChange={(e) => setMessageTemplate(e.target.value)}
                  required
                  rows={3}
                  placeholder="Hey, I saw your comment on my post — would love to connect!"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Keyword filter <span className="text-gray-400">(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={keywordFilter}
                    onChange={(e) => setKeywordFilter(e.target.value)}
                    placeholder="e.g. interested"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <p className="text-xs text-gray-400 mt-1">Only DM commenters whose comment contains this word</p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Daily DM limit
                  </label>
                  <input
                    type="number"
                    value={dailyLimit}
                    onChange={(e) => setDailyLimit(e.target.value)}
                    min="1"
                    max="80"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <p className="text-xs text-gray-400 mt-1">Max 20 recommended to stay safe</p>
                </div>
              </div>
              {error && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  {error}
                </p>
              )}
              <button
                type="submit"
                disabled={creating}
                className="w-full py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
              >
                {creating ? "Creating..." : "Create campaign"}
              </button>
            </form>
          </div>
        )}

        {/* Campaign list */}
        {campaigns === undefined ? (
          <p className="text-sm text-gray-400">Loading...</p>
        ) : campaigns.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
            <p className="text-gray-500 text-sm">No campaigns yet. Create one to get started.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {campaigns.map((campaign) => (
              <div
                key={campaign._id}
                className="bg-white rounded-xl border border-gray-200 p-5"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className={`inline-block w-2 h-2 rounded-full ${
                          campaign.status === "active"
                            ? "bg-green-500"
                            : "bg-gray-300"
                        }`}
                      />
                      <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                        {campaign.status}
                      </span>
                      <span className="text-xs text-gray-400">·</span>
                      <span className="text-xs text-gray-500">
                        {campaign.todayCount}/{campaign.dailyLimit} DMs today
                      </span>
                    </div>
                    <a
                      href={campaign.postUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-blue-600 hover:underline truncate block"
                    >
                      {campaign.postUrl}
                    </a>
                    <p className="text-sm text-gray-700 mt-1 line-clamp-2">
                      {campaign.messageTemplate}
                    </p>
                    {campaign.keywordFilter && (
                      <span className="inline-block mt-2 text-xs bg-gray-100 text-gray-600 rounded px-2 py-0.5">
                        keyword: {campaign.keywordFilter}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => handleToggle(campaign._id, campaign.status)}
                    disabled={toggling === campaign._id}
                    className={`shrink-0 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors disabled:opacity-50 ${
                      campaign.status === "active"
                        ? "bg-amber-100 hover:bg-amber-200 text-amber-700"
                        : "bg-green-100 hover:bg-green-200 text-green-700"
                    }`}
                  >
                    {toggling === campaign._id
                      ? "..."
                      : campaign.status === "active"
                      ? "Pause"
                      : "Resume"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd "D:\pk\Work\LinkedIn Auto-DM Tool\linkdm\.worktrees\beta-login"
npm run build 2>&1 | tail -15
```

Expected: Build succeeds, no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
cd "D:\pk\Work\LinkedIn Auto-DM Tool\linkdm\.worktrees\beta-login"
git add src/app/dashboard/campaigns/
git commit -m "feat: add campaigns page with create form and pause/resume"
```

---

## Task 3: Activity feed page — live DM log

**Files:**
- Create: `src/app/dashboard/activity/page.tsx`

Real-time feed of DMs sent/failed. Convex `useQuery` makes this live automatically — no polling needed.

- [ ] **Step 1: Create the activity page**

Create `src/app/dashboard/activity/page.tsx`:

```tsx
"use client";

import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import Link from "next/link";

function timeAgo(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function ActivityPage() {
  const logs = useQuery(api.dmLog.listRecentByUser);

  return (
    <main className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-4 mb-8">
          <Link href="/dashboard" className="text-sm text-gray-500 hover:text-gray-700">
            ← Dashboard
          </Link>
          <h1 className="text-2xl font-bold text-gray-900">Activity</h1>
          {logs && logs.length > 0 && (
            <span className="text-xs text-green-600 font-medium">● Live</span>
          )}
        </div>

        <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
          {logs === undefined ? (
            <div className="p-8 text-center">
              <p className="text-sm text-gray-400">Loading...</p>
            </div>
          ) : logs.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-sm text-gray-500">No DMs sent yet.</p>
              <p className="text-xs text-gray-400 mt-1">
                Activity will appear here as your campaigns run.
              </p>
            </div>
          ) : (
            logs.map((log) => (
              <div key={log._id} className="flex items-center gap-4 px-5 py-4">
                <span
                  className={`shrink-0 w-2 h-2 rounded-full ${
                    log.status === "sent"
                      ? "bg-green-500"
                      : log.status === "failed"
                      ? "bg-red-400"
                      : "bg-gray-300"
                  }`}
                />
                <div className="flex-1 min-w-0">
                  <a
                    href={log.profileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-medium text-gray-900 hover:text-blue-600"
                  >
                    {log.profileName}
                  </a>
                  {log.status === "failed" && log.errorMessage && (
                    <p className="text-xs text-red-500 mt-0.5">{log.errorMessage}</p>
                  )}
                </div>
                <div className="shrink-0 text-right">
                  <span
                    className={`text-xs font-medium ${
                      log.status === "sent"
                        ? "text-green-600"
                        : log.status === "failed"
                        ? "text-red-500"
                        : "text-gray-400"
                    }`}
                  >
                    {log.status}
                  </span>
                  <p className="text-xs text-gray-400 mt-0.5">{timeAgo(log.sentAt)}</p>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd "D:\pk\Work\LinkedIn Auto-DM Tool\linkdm\.worktrees\beta-login"
npm run build 2>&1 | tail -15
```

Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
cd "D:\pk\Work\LinkedIn Auto-DM Tool\linkdm\.worktrees\beta-login"
git add src/app/dashboard/activity/
git commit -m "feat: add live activity feed page"
```

---

## Task 4: Update dashboard home with nav

**Files:**
- Modify: `src/app/dashboard/page.tsx`

Add two nav cards at the top — Campaigns and Activity — so the user can navigate without knowing the URLs.

- [ ] **Step 1: Add nav to dashboard page**

In `src/app/dashboard/page.tsx`, add this block immediately after the `<div className="flex items-center justify-between mb-8">` closing tag (before the waitlist section):

```tsx
        {/* Nav cards */}
        <div className="grid grid-cols-2 gap-4 mb-4">
          <Link
            href="/dashboard/campaigns"
            className="bg-white rounded-xl border border-gray-200 p-5 hover:border-blue-300 hover:shadow-sm transition-all group"
          >
            <div className="text-xl mb-1">📋</div>
            <div className="text-sm font-semibold text-gray-900 group-hover:text-blue-600">Campaigns</div>
            <div className="text-xs text-gray-500 mt-0.5">Create and manage your DM campaigns</div>
          </Link>
          <Link
            href="/dashboard/activity"
            className="bg-white rounded-xl border border-gray-200 p-5 hover:border-blue-300 hover:shadow-sm transition-all group"
          >
            <div className="text-xl mb-1">⚡</div>
            <div className="text-sm font-semibold text-gray-900 group-hover:text-blue-600">Activity</div>
            <div className="text-xs text-gray-500 mt-0.5">Live feed of DMs sent by the extension</div>
          </Link>
        </div>
```

Also add `Link` to the imports at the top:

```tsx
import Link from "next/link";
```

- [ ] **Step 2: Remove the placeholder "Campaigns coming soon" card**

Delete this block from the bottom of the file:

```tsx
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
          <p className="text-gray-500 text-sm">Campaigns coming soon.</p>
        </div>
```

- [ ] **Step 3: Verify build**

```bash
cd "D:\pk\Work\LinkedIn Auto-DM Tool\linkdm\.worktrees\beta-login"
npm run build 2>&1 | tail -15
```

Expected: Build succeeds.

- [ ] **Step 4: Commit and deploy**

```bash
cd "D:\pk\Work\LinkedIn Auto-DM Tool\linkdm\.worktrees\beta-login"
git add src/app/dashboard/page.tsx
git commit -m "feat: add campaigns and activity nav to dashboard home"
vercel --prod
```

Expected: Deployment succeeds, `readyState: READY`.

---

## Self-Review

**Spec coverage:**
- ✅ Campaign creation form (Task 2)
- ✅ Campaign list with status + todayCount (Task 2)
- ✅ Pause/resume campaigns (Task 2)
- ✅ Live activity feed (Task 3)
- ✅ Dashboard navigation (Task 4)
- ✅ Backend queries for user-facing data (Task 1)

**Placeholder scan:** No TBDs, no "add validation" stubs — all error handling is shown inline.

**Type consistency:**
- `campaign._id` typed as `Id<"campaigns">` — consistent across Tasks 1 and 2
- `log.status` union `"sent" | "failed" | "skipped"` — consistent with schema
- `listByUser` returns `{ ...campaign, todayCount: number }[]` — used correctly in Task 2
- `listRecentByUser` returns dmLog documents — used correctly in Task 3
