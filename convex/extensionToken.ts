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
