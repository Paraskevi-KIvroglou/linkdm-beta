/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

test("campaigns table is defined in schema", () => {
  expect(schema.tables.campaigns).toBeDefined();
});

test("dmLog table is defined in schema", () => {
  expect(schema.tables.dmLog).toBeDefined();
});

test("extensionTokens table is defined in schema", () => {
  expect(schema.tables.extensionTokens).toBeDefined();
});

test("create saves a campaign with default dailyLimit of 20", async () => {
  const t = convexTest(schema, modules);
  const id = await t
    .withIdentity({ tokenIdentifier: "user1" })
    .mutation(api.campaigns.create, {
      postUrl: "https://linkedin.com/feed/update/urn:li:activity:123",
      messageTemplate: "Hey, saw your comment!",
    });
  const campaign = await t.query(internal.campaigns.getById, { campaignId: id });
  expect(campaign?.dailyLimit).toBe(20);
  expect(campaign?.status).toBe("active");
  expect(campaign?.userId).toBe("user1");
});

test("create respects custom dailyLimit", async () => {
  const t = convexTest(schema, modules);
  const id = await t
    .withIdentity({ tokenIdentifier: "user1" })
    .mutation(api.campaigns.create, {
      postUrl: "https://linkedin.com/feed/update/urn:li:activity:123",
      messageTemplate: "Hey!",
      dailyLimit: 5,
    });
  const campaign = await t.query(internal.campaigns.getById, { campaignId: id });
  expect(campaign?.dailyLimit).toBe(5);
});

test("updateStatus pauses an active campaign", async () => {
  const t = convexTest(schema, modules);
  const asUser = t.withIdentity({ tokenIdentifier: "user1" });
  const id = await asUser.mutation(api.campaigns.create, {
    postUrl: "https://linkedin.com/feed/update/urn:li:activity:123",
    messageTemplate: "Hey!",
  });
  await asUser.mutation(api.campaigns.updateStatus, { campaignId: id, status: "paused" });
  const campaign = await t.query(internal.campaigns.getById, { campaignId: id });
  expect(campaign?.status).toBe("paused");
});

test("updateStatus throws if campaign belongs to a different user", async () => {
  const t = convexTest(schema, modules);
  const id = await t
    .withIdentity({ tokenIdentifier: "user1" })
    .mutation(api.campaigns.create, {
      postUrl: "https://linkedin.com/feed/update/urn:li:activity:123",
      messageTemplate: "Hey!",
    });
  await expect(
    t
      .withIdentity({ tokenIdentifier: "user2" })
      .mutation(api.campaigns.updateStatus, { campaignId: id, status: "paused" })
  ).rejects.toThrow("Unauthorized");
});

test("listActiveByUserId returns only active campaigns for that user", async () => {
  const t = convexTest(schema, modules);
  const asUser1 = t.withIdentity({ tokenIdentifier: "user1" });
  const asUser2 = t.withIdentity({ tokenIdentifier: "user2" });

  const id1 = await asUser1.mutation(api.campaigns.create, {
    postUrl: "https://linkedin.com/feed/update/urn:li:activity:111",
    messageTemplate: "Hey!",
  });
  await asUser1.mutation(api.campaigns.create, {
    postUrl: "https://linkedin.com/feed/update/urn:li:activity:222",
    messageTemplate: "Hey!",
  });
  // Pause one of user1's campaigns
  await asUser1.mutation(api.campaigns.updateStatus, { campaignId: id1, status: "paused" });
  // Create one for user2
  await asUser2.mutation(api.campaigns.create, {
    postUrl: "https://linkedin.com/feed/update/urn:li:activity:333",
    messageTemplate: "Hey!",
  });

  const active = await t.query(internal.campaigns.listActiveByUserId, { userId: "user1" });
  expect(active).toHaveLength(1);
  expect(active[0].status).toBe("active");
});
