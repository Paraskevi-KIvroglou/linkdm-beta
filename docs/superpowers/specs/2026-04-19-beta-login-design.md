# Beta Login Design — linkdm

**Date:** 2026-04-19
**Status:** Approved

---

## Overview

Add a waitlist + magic link login system to linkdm for beta user testing. Users sign up to the waitlist, the owner manually approves them, and approved users log in via a passwordless magic link email. Unapproved users who try to log in see a friendly "rolling out slowly" message and receive no email.

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js (React) |
| Backend | Convex (DB + functions + auth) |
| Auth | `@convex-dev/auth` — Email magic link (OTP) |
| Database | Convex built-in (document store) |

Convex replaces a separate Node.js backend entirely — business logic, data, and auth all live in Convex functions.

---

## Data Model

### `users` table

| Field | Type | Notes |
|---|---|---|
| `email` | string | Unique |
| `isApproved` | boolean | Default: `false` |
| `createdAt` | number | Unix timestamp |

Sessions are managed automatically by `@convex-dev/auth`.

---

## Pages

| Route | Purpose |
|---|---|
| `/waitlist` | User submits email to join the beta waitlist |
| `/login` | User enters email to request a magic link |
| `/check-email` | Static confirmation: "Check your inbox" |
| `/dashboard` | Main app — protected, approved users only |

No separate `/pending` page — the waiting state is shown inline on `/login`.

---

## User Flows

### Waitlist signup
1. User visits `/waitlist`
2. Submits email
3. Convex `joinWaitlist()` mutation saves `{ email, isApproved: false, createdAt }`
4. User sees: *"You're on the list! We'll email you when you're in."*

### Owner approves a user
1. Owner opens Convex dashboard
2. Runs `approveUser({ email })` mutation — sets `isApproved: true`
3. No further action needed — user can now log in

### Login (magic link)
1. User visits `/login`, enters email, submits
2. Convex checks: does this email exist **and** `isApproved: true`?
   - **Approved** → `@convex-dev/auth` sends magic link email → redirect to `/check-email`
   - **On waitlist, not approved** → no email sent → inline message shown: *"We're rolling out to beta users slowly — you'll hear from us as soon as you're in!"*
   - **Not in DB** → same inline message (no information leakage)
3. User clicks magic link in email
4. Convex Auth verifies token
5. Session created → redirect to `/dashboard`

### Route protection
- `ConvexAuthNextjsMiddleware` protects all `/dashboard/*` routes
- Unauthenticated users are redirected to `/login`
- Auth state is checked server-side via middleware — no client-side flicker

---

## Convex Functions

| Function | Type | Description |
|---|---|---|
| `joinWaitlist({ email })` | Mutation | Saves email with `isApproved: false`. Idempotent — no duplicate entries. |
| `checkApproval({ email })` | Query | Returns `isApproved` boolean for a given email. |
| `approveUser({ email })` | Mutation | Sets `isApproved: true`. Admin use only — called from Convex dashboard. |

---

## Error States

| Scenario | Behaviour |
|---|---|
| Email already on waitlist | Silently succeeds (idempotent) — user sees confirmation |
| Not approved tries to log in | Inline message, no email sent |
| Unknown email tries to log in | Same inline message as above (no leak) |
| Magic link expired | Convex Auth shows expiry error, prompts to request new link |
| Already logged in visits `/login` | Redirect to `/dashboard` |

---

## Out of Scope (for now)

- Admin UI for approving users (use Convex dashboard directly)
- Email notifications to users when approved
- OAuth / Google login
- Password-based login
- Rate limiting on magic link requests

---

## Success Criteria

- Beta users can join the waitlist
- Owner can approve users in under 30 seconds via Convex dashboard
- Approved users receive a magic link and can reach `/dashboard`
- Unapproved users attempting login see the "rolling out slowly" message and receive no email
- `/dashboard` is inaccessible without an active approved session
