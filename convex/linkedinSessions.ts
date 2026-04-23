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
