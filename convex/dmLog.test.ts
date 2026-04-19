/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

test("logDm inserts a dmLog entry", async () => {
  const t = convexTest(schema, modules);
  const campaignId = await t
    .withIdentity({ tokenIdentifier: "user1" })
    .mutation(api.campaigns.create, {
      postUrl: "https://linkedin.com/feed/update/urn:li:activity:123",
      messageTemplate: "Hey!",
    });

  await t.mutation(internal.dmLog.logDm, {
    campaignId,
    profileId: "urn:li:member:999",
    profileName: "Alice Smith",
    profileUrl: "https://linkedin.com/in/alice",
    status: "sent",
  });

  const already = await t.query(internal.dmLog.hasBeenDmd, {
    campaignId,
    profileId: "urn:li:member:999",
  });
  expect(already).toBe(true);
});

test("hasBeenDmd returns false for a profile not yet DM'd", async () => {
  const t = convexTest(schema, modules);
  const campaignId = await t
    .withIdentity({ tokenIdentifier: "user1" })
    .mutation(api.campaigns.create, {
      postUrl: "https://linkedin.com/feed/update/urn:li:activity:123",
      messageTemplate: "Hey!",
    });

  const already = await t.query(internal.dmLog.hasBeenDmd, {
    campaignId,
    profileId: "urn:li:member:000",
  });
  expect(already).toBe(false);
});

test("getTodayCount counts only sent entries for today", async () => {
  const t = convexTest(schema, modules);
  const campaignId = await t
    .withIdentity({ tokenIdentifier: "user1" })
    .mutation(api.campaigns.create, {
      postUrl: "https://linkedin.com/feed/update/urn:li:activity:123",
      messageTemplate: "Hey!",
    });

  await t.mutation(internal.dmLog.logDm, {
    campaignId,
    profileId: "urn:li:member:1",
    profileName: "Alice",
    profileUrl: "https://linkedin.com/in/alice",
    status: "sent",
  });
  await t.mutation(internal.dmLog.logDm, {
    campaignId,
    profileId: "urn:li:member:2",
    profileName: "Bob",
    profileUrl: "https://linkedin.com/in/bob",
    status: "failed", // should NOT be counted
  });

  const count = await t.query(internal.dmLog.getTodayCount, { campaignId });
  expect(count).toBe(1);
});

test("listByCampaign returns all dmLog entries for a campaign", async () => {
  const t = convexTest(schema, modules);
  const campaignId = await t
    .withIdentity({ tokenIdentifier: "user1" })
    .mutation(api.campaigns.create, {
      postUrl: "https://linkedin.com/feed/update/urn:li:activity:123",
      messageTemplate: "Hey!",
    });

  await t.mutation(internal.dmLog.logDm, {
    campaignId,
    profileId: "urn:li:member:1",
    profileName: "Alice",
    profileUrl: "https://linkedin.com/in/alice",
    status: "sent",
  });

  const entries = await t.query(internal.dmLog.listByCampaign, { campaignId });
  expect(entries).toHaveLength(1);
  expect(entries[0].profileName).toBe("Alice");
});
