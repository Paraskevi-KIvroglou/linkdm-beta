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

    if (args.dailyLimit !== undefined && args.dailyLimit <= 0) {
      throw new Error("dailyLimit must be a positive number");
    }

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

/**
 * Returns up to 50 active campaigns for a user.
 * Users are not expected to have more than 50 active campaigns at once.
 * If they do, campaigns beyond the first 50 will be silently omitted.
 */
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
