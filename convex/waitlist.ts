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
