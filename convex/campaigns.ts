import { mutation, query, internalQuery, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";

export const create = mutation({
  args: {
    postUrl: v.string(),
    messageTemplate: v.string(),
    keywordFilter: v.optional(v.string()),
    dailyLimit: v.optional(v.number()),
    postType: v.optional(v.union(v.literal("personal"), v.literal("company"))),
    replyTemplate: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    if (args.dailyLimit !== undefined && args.dailyLimit <= 0) {
      throw new Error("dailyLimit must be a positive number");
    }

    return await ctx.db.insert("campaigns", {
      userId,
      postUrl: args.postUrl,
      messageTemplate: args.messageTemplate,
      keywordFilter: args.keywordFilter,
      dailyLimit: args.dailyLimit ?? 20,
      status: "active",
      postType: args.postType ?? "personal",
      replyTemplate: args.replyTemplate,
    });
  },
});

export const updateStatus = mutation({
  args: {
    campaignId: v.id("campaigns"),
    status: v.union(v.literal("active"), v.literal("paused")),
  },
  handler: async (ctx, { campaignId, status }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const campaign = await ctx.db.get(campaignId);
    if (!campaign) throw new Error("Campaign not found");
    if (campaign.userId !== userId) throw new Error("Unauthorized");

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
 * Also finds campaigns stored under duplicate user records that share the same
 * email — mirrors the email-based lookup in listByUser so the extension sees
 * the same campaigns as the dashboard.
 */
export const listActiveByUserId = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    // Collect all userIds that share this email (handles auth-bug duplicates)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = ctx.db as any;
    const currentUser = await db.get(userId);
    let allUserIds: string[] = [userId];
    if (currentUser?.email) {
      const sameEmailUsers = await db
        .query("users")
        .withIndex("email", (q: any) => q.eq("email", currentUser.email))
        .collect();
      allUserIds = [...new Set([userId, ...sameEmailUsers.map((u: any) => u._id)])];
    }

    // Fetch active campaigns for ALL matching userIds
    const sets = await Promise.all(
      allUserIds.map((uid) =>
        ctx.db
          .query("campaigns")
          .withIndex("by_userId_and_status", (q) =>
            q.eq("userId", uid).eq("status", "active")
          )
          .take(50)
      )
    );
    return sets.flat().slice(0, 50);
  },
});

export const listByUser = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    // Look up the current user's email so we can find campaigns from any
    // duplicate user records that may have been created by the auth bug.
    const currentUser = await ctx.db.get(userId);
    const email = currentUser?.email;

    // Collect all userIds that share this email (the current one + any ghost duplicates).
    let allUserIds: string[] = [userId];
    if (email) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db = ctx.db as any;
      const sameEmailUsers = await db
        .query("users")
        .withIndex("email", (q: any) => q.eq("email", email))
        .collect();
      allUserIds = [...new Set([userId, ...sameEmailUsers.map((u: any) => u._id)])];
    }

    // Fetch campaigns for ALL userIds that belong to this person.
    const campaignSets = await Promise.all(
      allUserIds.map((uid) =>
        ctx.db
          .query("campaigns")
          .withIndex("by_userId", (q) => q.eq("userId", uid))
          .collect()
      )
    );
    const campaigns = campaignSets.flat();

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

/**
 * Reassigns all campaigns from duplicate user records (same email) to the
 * current userId, then removes the duplicate users and their auth accounts.
 * Safe to call multiple times — idempotent.
 */
export const mergeDuplicateAccounts = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const currentUser = await ctx.db.get(userId);
    const email = currentUser?.email;
    if (!email) return { merged: 0 };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = ctx.db as any;
    const duplicates = await db
      .query("users")
      .withIndex("email", (q: any) => q.eq("email", email))
      .collect();

    // Only operate on OTHER user records, not the current one.
    const others = duplicates.filter((u: any) => u._id !== userId);
    if (others.length === 0) return { merged: 0 };

    let merged = 0;
    for (const ghost of others) {
      // Re-point all campaigns from the ghost user to the current user.
      const ghostCampaigns = await ctx.db
        .query("campaigns")
        .withIndex("by_userId", (q) => q.eq("userId", ghost._id))
        .collect();
      for (const c of ghostCampaigns) {
        await ctx.db.patch(c._id, { userId });
        merged++;
      }

      // Re-point the ghost user's extension tokens.
      const ghostTokens = await ctx.db
        .query("extensionTokens")
        .withIndex("by_userId", (q) => q.eq("userId", ghost._id))
        .collect();
      for (const t of ghostTokens) {
        await ctx.db.patch(t._id, { userId });
      }

      // Delete the ghost's auth accounts so they can't be matched again.
      const ghostAccounts = await db
        .query("authAccounts")
        .withIndex("userIdAndProvider", (q: any) => q.eq("userId", ghost._id))
        .collect();
      for (const a of ghostAccounts) {
        await ctx.db.delete(a._id);
      }

      // Delete the ghost user record itself.
      await ctx.db.delete(ghost._id);
    }

    return { merged };
  },
});

/**
 * Returns all active campaigns across all users.
 * Called by cloudCampaignLoop to find work to do.
 * Capped at 500 to avoid runaway queries.
 */
export const listAllActive = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("campaigns")
      .filter((q) => q.eq(q.field("status"), "active"))
      .take(500);
  },
});

/**
 * Pauses all active campaigns for a userId.
 * Called by cloudCampaignLoop when a session expires.
 * Does not require auth — internal only.
 */
export const pauseAllForUser = internalMutation({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    const campaigns = await ctx.db
      .query("campaigns")
      .withIndex("by_userId_and_status", (q) =>
        q.eq("userId", userId).eq("status", "active")
      )
      .collect();
    for (const c of campaigns) {
      await ctx.db.patch(c._id, { status: "paused" });
    }
  },
});
