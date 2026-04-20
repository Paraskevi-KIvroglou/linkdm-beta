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

/**
 * Returns true if this profile has any dmLog entry for this campaign,
 * regardless of status (sent, failed, or skipped). Failed attempts are
 * not retried — once attempted, a profile is permanently skipped.
 */
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
