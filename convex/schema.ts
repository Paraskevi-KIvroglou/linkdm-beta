import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

export default defineSchema({
  ...authTables,

  waitlist: defineTable({
    email: v.string(),
    isApproved: v.boolean(),
    createdAt: v.number(),
  }).index("by_email", ["email"]),

  extensionTokens: defineTable({
    userId: v.string(),
    token: v.string(),
    createdAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_token", ["token"]),

  campaigns: defineTable({
    userId: v.string(),
    postUrl: v.string(),
    messageTemplate: v.string(),
    keywordFilter: v.optional(v.string()),
    dailyLimit: v.number(),
    status: v.union(v.literal("active"), v.literal("paused")),
  })
    .index("by_userId", ["userId"])
    .index("by_userId_and_status", ["userId", "status"]),

  dmLog: defineTable({
    campaignId: v.id("campaigns"),
    profileId: v.string(),
    profileName: v.string(),
    profileUrl: v.string(),
    status: v.union(
      v.literal("sent"),
      v.literal("failed"),
      v.literal("skipped")
    ),
    sentAt: v.number(),
    errorMessage: v.optional(v.string()),
  })
    .index("by_campaignId_and_profileId", ["campaignId", "profileId"])
    .index("by_campaignId_and_status_and_sentAt", [
      "campaignId",
      "status",
      "sentAt",
    ]),
});
