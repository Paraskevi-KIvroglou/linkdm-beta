import { mutation, query, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
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

    if (entry.isApproved) return; // already approved — don't re-send email

    await ctx.db.patch(entry._id, { isApproved: true });

    // Schedule the approval email — actions can make HTTP calls, mutations cannot
    await ctx.scheduler.runAfter(0, internal.waitlist.sendApprovalEmail, { email });
  },
});

export const listPending = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("waitlist")
      .filter((q) => q.eq(q.field("isApproved"), false))
      .order("desc")
      .collect();
  },
});

export const sendApprovalEmail = internalAction({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const siteUrl = process.env.SITE_URL ?? "https://beta-login-tawny.vercel.app";
    const resendKey = process.env.AUTH_RESEND_KEY;
    if (!resendKey) throw new Error("AUTH_RESEND_KEY not set");

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "linkdm <hello@paraskevikivroglou.com>",
        to: [email],
        subject: "You're in — welcome to the linkdm beta 🎉",
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; color: #111827;">
            <h1 style="font-size: 22px; font-weight: 700; margin: 0 0 8px;">You're approved! 🎉</h1>
            <p style="color: #6b7280; font-size: 15px; margin: 0 0 24px;">
              Your access to the linkdm beta is ready. Click below to log in and start your first campaign.
            </p>
            <a href="${siteUrl}/login"
               style="display: inline-block; background: #0077B5; color: white; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-size: 15px; font-weight: 600;">
              Log in to linkdm →
            </a>
            <p style="color: #9ca3af; font-size: 13px; margin: 24px 0 0;">
              If you didn't sign up for linkdm, you can ignore this email.
            </p>
          </div>
        `,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Resend error ${res.status}: ${body}`);
    }
  },
});
