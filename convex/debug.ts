import { query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

/**
 * Temporary debug query — shows what the current session looks like
 * and what campaigns / users exist for this email.
 * Remove after diagnosing the disappearing-campaigns issue.
 */
export const whoAmI = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return { userId: null, user: null, allEmailUsers: [], allCampaigns: [] };

    const user = await ctx.db.get(userId);

    // Find all users with the same email
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = ctx.db as any;
    let allEmailUsers: any[] = [];
    if (user?.email) {
      allEmailUsers = await db
        .query("users")
        .withIndex("email", (q: any) => q.eq("email", user.email))
        .collect();
    }

    // Find ALL campaigns in the DB that match any of these userIds
    const allCampaigns = await Promise.all(
      allEmailUsers.map((u: any) =>
        ctx.db
          .query("campaigns")
          .withIndex("by_userId", (q) => q.eq("userId", u._id))
          .collect()
      )
    );

    return {
      userId,
      user,
      allEmailUsers: allEmailUsers.map((u: any) => ({ _id: u._id, email: u.email })),
      allCampaigns: allCampaigns.flat().map((c) => ({ _id: c._id, userId: c.userId, postUrl: c.postUrl })),
    };
  },
});
