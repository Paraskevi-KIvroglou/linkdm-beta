import { mutation, query, internalQuery } from "./_generated/server";
import { v } from "convex/values";

export const create = mutation({
  args: {
    postUrl: v.string(),
    messageTemplate: v.string(),
    keywordFilter: v.optional(v.string()),
    dailyLimit: v.optional(v.number()),
    postType: v.optional(v.union(v.literal("personal"), v.literal("company"))),
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
      postType: args.postType ?? "personal",
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
