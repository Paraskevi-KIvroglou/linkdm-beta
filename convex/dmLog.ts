import { internalMutation, internalQuery, query } from "./_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";

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
    errorMessage:     v.optional(v.string()),
    connectionStatus: v.optional(v.string()),
    commentText:      v.optional(v.string()),
    replyStatus: v.optional(
      v.union(
        v.literal("sent"),
        v.literal("failed"),
        v.literal("not_attempted")
      )
    ),
    replyError:       v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("dmLog", {
      ...args,
      sentAt: Date.now(),
    });
  },
});

/**
 * Returns true only if this profile has a "sent" dmLog entry for this campaign.
 * Failed entries are ignored so the DM will be retried on the next cycle.
 * Skipped entries (keyword filter) are also ignored — skipping is handled
 * locally in the extension and does not permanently exclude a profile.
 */
export const hasBeenDmd = internalQuery({
  args: { campaignId: v.id("campaigns"), profileId: v.string() },
  handler: async (ctx, { campaignId, profileId }) => {
    const entries = await ctx.db
      .query("dmLog")
      .withIndex("by_campaignId_and_profileId", (q) =>
        q.eq("campaignId", campaignId).eq("profileId", profileId)
      )
      .collect();
    return entries.some((e) => e.status === "sent");
  },
});

export const getTodayCount = internalQuery({
  args: { campaignId: v.id("campaigns") },
  handler: async (ctx, { campaignId }) => {
    // UTC midnight: safe, explicit, no Date object needed
    const now = Date.now();
    const startOfDay = now - (now % 86_400_000);

    const entries = await ctx.db
      .query("dmLog")
      .withIndex("by_campaignId_and_status_and_sentAt", (q) =>
        q
          .eq("campaignId", campaignId)
          .eq("status", "sent")
          .gte("sentAt", startOfDay)
      )
      .collect();

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

export const listRecentByUser = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

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
