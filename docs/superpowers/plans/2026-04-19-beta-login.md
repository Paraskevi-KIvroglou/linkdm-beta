# Beta Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add waitlist signup, manual approval, and passwordless magic link login to linkdm using Convex + @convex-dev/auth + Resend.

**Architecture:** Convex serves as the full backend (DB + functions + auth). A `waitlist` table tracks emails and approval status independently from the auth `users` table. On login, the frontend imperatively checks approval via `useConvex()` before calling `signIn` — if not approved, no email is sent and an inline message is shown. Route protection is handled server-side by `ConvexAuthNextjsMiddleware`.

**Tech Stack:** Next.js 14 (App Router), Convex, @convex-dev/auth, @auth/core (Resend provider), Resend (email service), Tailwind CSS, Vitest + convex-test (Convex function tests)

---

## File Map

| File | Purpose |
|---|---|
| `convex/schema.ts` | DB schema — authTables + custom `waitlist` table |
| `convex/auth.ts` | Convex Auth setup with Resend magic link provider |
| `convex/auth.config.ts` | Auth provider config for Convex |
| `convex/http.ts` | HTTP router exposing auth callback endpoints |
| `convex/waitlist.ts` | `joinWaitlist`, `checkApproval`, `approveUser` functions |
| `convex/waitlist.test.ts` | Vitest tests for all waitlist functions |
| `vitest.config.ts` | Vitest config for Convex function tests |
| `src/middleware.ts` | Route protection — redirect unauthenticated users from /dashboard |
| `src/components/ConvexClientProvider.tsx` | Wraps the app with Convex + Auth context |
| `src/app/layout.tsx` | Root layout — uses ConvexClientProvider |
| `src/app/page.tsx` | Root redirect → /waitlist |
| `src/app/waitlist/page.tsx` | Waitlist signup form |
| `src/app/login/page.tsx` | Magic link login form with approval check |
| `src/app/check-email/page.tsx` | Static "check your inbox" screen |
| `src/app/dashboard/page.tsx` | Protected main app page |
| `.env.local` | NEXT_PUBLIC_CONVEX_URL, AUTH_RESEND_KEY, SITE_URL |

---

### Task 1: Scaffold the Next.js project

**Files:**
- Create: `linkdm/` project root (already exists, scaffold into it)

- [ ] **Step 1: Initialize Next.js inside the existing directory**

Run this from `D:/pk/Work/LinkedIn Auto-DM Tool/linkdm/`:
```bash
npx create-next-app@latest . --typescript --tailwind --app --src-dir --import-alias "@/*" --no-git
```
When prompted, accept all defaults.

- [ ] **Step 2: Install Convex, auth, and test dependencies**

```bash
npm install convex @convex-dev/auth @auth/core resend
npm install -D vitest @vitest/ui
```

- [ ] **Step 3: Confirm dev server starts**

```bash
npm run dev
```
Expected: server starts at http://localhost:3000 with the default Next.js page. Stop with Ctrl+C.

- [ ] **Step 4: Commit**

```bash
git init
git add .
git commit -m "feat: scaffold Next.js project"
```

---

### Task 2: Initialize Convex and configure Vitest

**Files:**
- Create: `convex/` directory (auto-created by Convex CLI)
- Create: `vitest.config.ts`
- Modify: `package.json` (add test script)

- [ ] **Step 1: Initialize Convex project**

```bash
npx convex dev --configure=new
```
Follow the prompts: log in to Convex, create a new project named `linkdm`. This generates `convex/_generated/` and writes `NEXT_PUBLIC_CONVEX_URL` to `.env.local`. Leave `npx convex dev` running in a separate terminal for the rest of development.

- [ ] **Step 2: Run Convex auth setup**

```bash
npx @convex-dev/auth
```
Follow prompts. This creates `convex/auth.ts`, `convex/auth.config.ts`, and updates `convex/schema.ts` with `authTables`.

- [ ] **Step 3: Add Resend env vars to .env.local**

Open `.env.local` and append:
```
AUTH_RESEND_KEY=re_your_resend_api_key_here
SITE_URL=http://localhost:3000
```
Get a free Resend API key at https://resend.com → API Keys → Create Key. During development you can send to your own verified email without a custom domain.

- [ ] **Step 4: Create vitest.config.ts**

Create `vitest.config.ts` in the project root:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "edge-runtime",
  },
});
```

- [ ] **Step 5: Add test scripts to package.json**

Open `package.json`. Inside `"scripts"`, add:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 6: Commit**

```bash
git add convex/ vitest.config.ts package.json .env.local
git commit -m "feat: initialize Convex project and Vitest config"
```

---

### Task 3: Define the waitlist schema

**Files:**
- Modify: `convex/schema.ts`
- Create: `convex/waitlist.test.ts`

- [ ] **Step 1: Write the failing schema test**

Create `convex/waitlist.test.ts`:
```ts
import { expect, test } from "vitest";
import schema from "./schema";

test("waitlist table is defined in schema", () => {
  expect(schema.tables.waitlist).toBeDefined();
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
npm test
```
Expected: FAIL — `schema.tables.waitlist` is undefined (the table doesn't exist yet).

- [ ] **Step 3: Update schema.ts to add the waitlist table**

Open `convex/schema.ts`. It was generated by `@convex-dev/auth` and already contains `authTables`. Replace the file content with:
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
});
```

- [ ] **Step 4: Run the test to confirm it passes**

```bash
npm test
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add convex/schema.ts convex/waitlist.test.ts
git commit -m "feat: add waitlist table to Convex schema"
```

---

### Task 4: Configure Convex Auth with Resend magic links

**Files:**
- Modify: `convex/auth.ts`
- Modify: `convex/auth.config.ts`
- Create: `convex/http.ts`

- [ ] **Step 1: Update auth.ts to use the Resend provider**

Replace the content of `convex/auth.ts` with:
```ts
import { convexAuth } from "@convex-dev/auth/server";
import Resend from "@auth/core/providers/resend";

export const { auth, signIn, signOut, store } = convexAuth({
  providers: [
    Resend({
      apiKey: process.env.AUTH_RESEND_KEY,
      from: "linkdm <onboarding@resend.dev>",
    }),
  ],
});
```
Note: `onboarding@resend.dev` is Resend's shared test sender — it works without a verified domain during development.

- [ ] **Step 2: Update auth.config.ts**

Replace the content of `convex/auth.config.ts` with:
```ts
export default {
  providers: [
    {
      domain: process.env.CONVEX_SITE_URL,
      applicationID: "convex",
    },
  ],
};
```

- [ ] **Step 3: Create http.ts to expose auth callback routes**

Create `convex/http.ts`:
```ts
import { httpRouter } from "convex/server";
import { auth } from "./auth";

const http = httpRouter();

auth.addHttpRoutes(http);

export default http;
```

- [ ] **Step 4: Confirm Convex still syncs without errors**

Check the terminal running `npx convex dev`. Expected: no errors after sync. If there are type errors, ensure `@auth/core` is installed (`npm install @auth/core`).

- [ ] **Step 5: Commit**

```bash
git add convex/auth.ts convex/auth.config.ts convex/http.ts
git commit -m "feat: configure Convex Auth with Resend magic link provider"
```

---

### Task 5: Implement waitlist Convex functions

**Files:**
- Create: `convex/waitlist.ts`
- Modify: `convex/waitlist.test.ts`

- [ ] **Step 1: Write failing tests for all three functions**

Replace the contents of `convex/waitlist.test.ts` with:
```ts
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

test("waitlist table is defined in schema", () => {
  expect(schema.tables.waitlist).toBeDefined();
});

test("joinWaitlist saves email with isApproved false", async () => {
  const t = convexTest(schema);
  await t.mutation(api.waitlist.joinWaitlist, { email: "beta@example.com" });
  const approved = await t.query(api.waitlist.checkApproval, { email: "beta@example.com" });
  expect(approved).toBe(false);
});

test("joinWaitlist is idempotent — duplicate calls do not throw", async () => {
  const t = convexTest(schema);
  await t.mutation(api.waitlist.joinWaitlist, { email: "beta@example.com" });
  await t.mutation(api.waitlist.joinWaitlist, { email: "beta@example.com" });
  const approved = await t.query(api.waitlist.checkApproval, { email: "beta@example.com" });
  expect(approved).toBe(false);
});

test("checkApproval returns false for unknown email", async () => {
  const t = convexTest(schema);
  const result = await t.query(api.waitlist.checkApproval, { email: "nobody@example.com" });
  expect(result).toBe(false);
});

test("approveUser sets isApproved to true", async () => {
  const t = convexTest(schema);
  await t.mutation(api.waitlist.joinWaitlist, { email: "user@example.com" });
  await t.mutation(api.waitlist.approveUser, { email: "user@example.com" });
  const approved = await t.query(api.waitlist.checkApproval, { email: "user@example.com" });
  expect(approved).toBe(true);
});

test("approveUser throws for unknown email", async () => {
  const t = convexTest(schema);
  await expect(
    t.mutation(api.waitlist.approveUser, { email: "ghost@example.com" })
  ).rejects.toThrow("not found in waitlist");
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test
```
Expected: FAIL — `api.waitlist` is not defined.

- [ ] **Step 3: Implement all three functions**

Create `convex/waitlist.ts`:
```ts
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const joinWaitlist = mutation({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const existing = await ctx.db
      .query("waitlist")
      .withIndex("by_email", (q) => q.eq("email", email))
      .first();

    if (existing) return; // idempotent — silently succeed on duplicate

    await ctx.db.insert("waitlist", {
      email,
      isApproved: false,
      createdAt: Date.now(),
    });
  },
});

export const checkApproval = query({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const entry = await ctx.db
      .query("waitlist")
      .withIndex("by_email", (q) => q.eq("email", email))
      .first();

    return entry?.isApproved ?? false;
  },
});

export const approveUser = mutation({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const entry = await ctx.db
      .query("waitlist")
      .withIndex("by_email", (q) => q.eq("email", email))
      .first();

    if (!entry) {
      throw new Error(`Email ${email} not found in waitlist`);
    }

    await ctx.db.patch(entry._id, { isApproved: true });
  },
});
```

- [ ] **Step 4: Run tests to confirm all pass**

```bash
npm test
```
Expected: PASS — 6 tests green.

- [ ] **Step 5: Commit**

```bash
git add convex/waitlist.ts convex/waitlist.test.ts
git commit -m "feat: add joinWaitlist, checkApproval, approveUser Convex functions"
```

---

### Task 6: Set up ConvexClientProvider and route protection middleware

**Files:**
- Create: `src/components/ConvexClientProvider.tsx`
- Create: `src/middleware.ts`
- Modify: `src/app/layout.tsx`

- [ ] **Step 1: Create ConvexClientProvider**

Create `src/components/ConvexClientProvider.tsx`:
```tsx
"use client";

import { ConvexAuthNextjsProvider } from "@convex-dev/auth/nextjs";
import { ConvexReactClient } from "convex/react";
import { ReactNode } from "react";

const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  return (
    <ConvexAuthNextjsProvider client={convex}>
      {children}
    </ConvexAuthNextjsProvider>
  );
}
```

- [ ] **Step 2: Create route protection middleware**

Create `src/middleware.ts`:
```ts
import {
  convexAuthNextjsMiddleware,
  createRouteMatcher,
  isAuthenticatedNextjs,
  nextjsMiddlewareRedirect,
} from "@convex-dev/auth/nextjs/server";

const isProtectedRoute = createRouteMatcher(["/dashboard(.*)"]);

export default convexAuthNextjsMiddleware((request) => {
  if (isProtectedRoute(request) && !isAuthenticatedNextjs()) {
    return nextjsMiddlewareRedirect(request, "/login");
  }
});

export const config = {
  matcher: ["/((?!.*\\..*|_next).*)", "/", "/(api|trpc)(.*)"],
};
```

- [ ] **Step 3: Update root layout to wrap the app with ConvexClientProvider**

Replace the entire content of `src/app/layout.tsx` with:
```tsx
import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import { ConvexClientProvider } from "@/components/ConvexClientProvider";

const geist = Geist({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "linkdm",
  description: "LinkedIn Auto-DM Tool",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={geist.className}>
        <ConvexClientProvider>{children}</ConvexClientProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add src/components/ConvexClientProvider.tsx src/middleware.ts src/app/layout.tsx
git commit -m "feat: add ConvexClientProvider and dashboard route protection"
```

---

### Task 7: Build the /waitlist page

**Files:**
- Create: `src/app/waitlist/page.tsx`

- [ ] **Step 1: Create the waitlist signup page**

Create `src/app/waitlist/page.tsx`:
```tsx
"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";

export default function WaitlistPage() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const joinWaitlist = useMutation(api.waitlist.joinWaitlist);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await joinWaitlist({ email });
      setSubmitted(true);
    } catch {
      setError("Something went wrong. Please try again.");
    }
  }

  if (submitted) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center max-w-md p-8">
          <div className="text-4xl mb-4">🎉</div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">You're on the list!</h1>
          <p className="text-gray-600">
            We'll email <strong>{email}</strong> as soon as you're approved.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full p-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Join the linkdm beta</h1>
        <p className="text-gray-500 mb-6 text-sm">
          Enter your email to request early access.
        </p>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
            className="border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {error && <p className="text-red-500 text-sm">{error}</p>}
          <button
            type="submit"
            className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-4 py-2 text-sm font-medium transition-colors"
          >
            Request access
          </button>
        </form>
        <p className="text-center text-sm text-gray-400 mt-4">
          Already approved?{" "}
          <a href="/login" className="text-blue-600 hover:underline">
            Log in
          </a>
        </p>
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Manually verify the page works**

With `npx convex dev` and `npm run dev` running, open http://localhost:3000/waitlist.
Submit your email. Confirm the confirmation screen appears.
Check the Convex dashboard (https://dashboard.convex.dev) → your project → Data → `waitlist` table — confirm the entry is there with `isApproved: false`.

- [ ] **Step 3: Commit**

```bash
git add src/app/waitlist/
git commit -m "feat: add waitlist signup page"
```

---

### Task 8: Build the /login page

**Files:**
- Create: `src/app/login/page.tsx`

- [ ] **Step 1: Create the login page**

Create `src/app/login/page.tsx`:
```tsx
"use client";

import { useState, useEffect } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import { useConvex, useConvexAuth } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useRouter } from "next/navigation";

type Status = "idle" | "checking" | "sending" | "not-approved";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const { signIn } = useAuthActions();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const convex = useConvex();
  const router = useRouter();

  // Redirect already-authenticated users straight to the dashboard
  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      router.replace("/dashboard");
    }
  }, [isAuthenticated, isLoading, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("checking");

    // Imperatively check approval before sending any email
    const isApproved = await convex.query(api.waitlist.checkApproval, { email });

    if (!isApproved) {
      setStatus("not-approved");
      return;
    }

    setStatus("sending");
    await signIn("resend", { email, redirectTo: "/dashboard" });
    router.push("/check-email");
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full p-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Log in to linkdm</h1>
        <p className="text-gray-500 mb-6 text-sm">
          We'll send you a magic link — no password needed.
        </p>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
            className="border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {status === "not-approved" && (
            <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
              We're rolling out to beta users slowly — you'll hear from us as
              soon as you're in!
            </p>
          )}
          <button
            type="submit"
            disabled={status === "checking" || status === "sending"}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg px-4 py-2 text-sm font-medium transition-colors"
          >
            {status === "checking"
              ? "Checking..."
              : status === "sending"
              ? "Sending link..."
              : "Send magic link"}
          </button>
        </form>
        <p className="text-center text-sm text-gray-400 mt-4">
          Not on the list yet?{" "}
          <a href="/waitlist" className="text-blue-600 hover:underline">
            Request access
          </a>
        </p>
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Verify the not-approved flow**

Open http://localhost:3000/login. Enter an email that is NOT in the waitlist (or is in the waitlist but not approved).
Expected: amber message appears — "We're rolling out to beta users slowly…" — and no email is sent.

- [ ] **Step 3: Verify the approved flow**

In the Convex dashboard, open the Functions tab and run `approveUser` with `{ "email": "your@email.com" }`.
Go back to /login, enter that email, submit.
Expected: redirected to /check-email, and a magic link email arrives in your inbox.

- [ ] **Step 4: Commit**

```bash
git add src/app/login/
git commit -m "feat: add magic link login page with pre-send approval check"
```

---

### Task 9: Build the /check-email page

**Files:**
- Create: `src/app/check-email/page.tsx`

- [ ] **Step 1: Create the check-email page**

Create `src/app/check-email/page.tsx`:
```tsx
export default function CheckEmailPage() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center max-w-md p-8">
        <div className="text-5xl mb-4">📬</div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Check your inbox</h1>
        <p className="text-gray-600 mb-2">
          We sent you a magic link. Click it to log in.
        </p>
        <p className="text-sm text-gray-400">
          It expires in 15 minutes. Didn't get it? Check your spam folder or{" "}
          <a href="/login" className="text-blue-600 hover:underline">
            try again
          </a>
          .
        </p>
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/check-email/
git commit -m "feat: add check-email confirmation page"
```

---

### Task 10: Build the /dashboard page

**Files:**
- Create: `src/app/dashboard/page.tsx`

- [ ] **Step 1: Create the protected dashboard page**

Create `src/app/dashboard/page.tsx`:
```tsx
"use client";

import { useAuthActions } from "@convex-dev/auth/react";

export default function DashboardPage() {
  const { signOut } = useAuthActions();

  return (
    <main className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-bold text-gray-900">🔗 linkdm</h1>
          <button
            onClick={() => signOut()}
            className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
          >
            Sign out
          </button>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
          <p className="text-gray-500 text-sm">
            Welcome to the beta! Campaigns coming soon.
          </p>
        </div>
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Verify route protection without a session**

Log out (or open an incognito window). Navigate to http://localhost:3000/dashboard.
Expected: immediately redirected to /login.

- [ ] **Step 3: Verify dashboard is reachable after clicking magic link**

Click the magic link from your email. Expected: lands on /dashboard.
Refresh the page. Expected: stays on /dashboard (session persists).

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboard/
git commit -m "feat: add protected dashboard page"
```

---

### Task 11: Update the root page

**Files:**
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Replace default Next.js home with a redirect**

Replace the entire content of `src/app/page.tsx` with:
```tsx
import { redirect } from "next/navigation";

export default function HomePage() {
  redirect("/waitlist");
}
```

- [ ] **Step 2: Verify the redirect**

Open http://localhost:3000. Expected: immediately redirects to /waitlist.

- [ ] **Step 3: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat: redirect root to /waitlist"
```

---

### Task 12: End-to-end smoke test

- [ ] **Step 1: Run all Convex function tests**

```bash
npm test
```
Expected: 6 tests PASS.

- [ ] **Step 2: Full beta user flow walkthrough**

With `npx convex dev` and `npm run dev` both running:

| Step | Action | Expected |
|---|---|---|
| 1 | Visit http://localhost:3000 | Redirects to /waitlist |
| 2 | Submit your email on /waitlist | Confirmation "You're on the list!" shown |
| 3 | Check Convex dashboard → Data → waitlist | Entry visible with `isApproved: false` |
| 4 | Go to /login, submit same email | Amber "rolling out slowly" message — no email sent |
| 5 | In Convex dashboard, run `approveUser({ email: "your@email.com" })` | `isApproved` flips to `true` in the data table |
| 6 | Go to /login, submit the approved email | Redirected to /check-email |
| 7 | Click magic link in email | Lands on /dashboard |
| 8 | Refresh /dashboard | Stays on /dashboard (session persists) |
| 9 | Click Sign out | Session cleared |
| 10 | Visit /dashboard directly | Redirected to /login |

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "feat: complete beta login — waitlist, approval, magic link auth"
```
