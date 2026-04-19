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
});
