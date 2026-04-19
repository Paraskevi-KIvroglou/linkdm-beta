/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

test("getOrCreate generates a token for a new user", async () => {
  const t = convexTest(schema, modules);
  const token = await t
    .withIdentity({ tokenIdentifier: "user1" })
    .mutation(api.extensionToken.getOrCreate, {});
  expect(typeof token).toBe("string");
  expect(token.startsWith("lnkdm_")).toBe(true);
});

test("getOrCreate returns the same token on repeated calls", async () => {
  const t = convexTest(schema, modules);
  const asUser = t.withIdentity({ tokenIdentifier: "user1" });
  const token1 = await asUser.mutation(api.extensionToken.getOrCreate, {});
  const token2 = await asUser.mutation(api.extensionToken.getOrCreate, {});
  expect(token1).toBe(token2);
});

test("regenerate creates a new token and invalidates old one", async () => {
  const t = convexTest(schema, modules);
  const asUser = t.withIdentity({ tokenIdentifier: "user1" });
  const old = await asUser.mutation(api.extensionToken.getOrCreate, {});
  const fresh = await asUser.mutation(api.extensionToken.regenerate, {});
  expect(fresh).not.toBe(old);
  expect(fresh.startsWith("lnkdm_")).toBe(true);
});

test("getUserIdByToken returns userId for a valid token", async () => {
  const t = convexTest(schema, modules);
  const token = await t
    .withIdentity({ tokenIdentifier: "user1" })
    .mutation(api.extensionToken.getOrCreate, {});
  const userId = await t.query(internal.extensionToken.getUserIdByToken, { token });
  expect(userId).toBe("user1");
});

test("getUserIdByToken returns null for an unknown token", async () => {
  const t = convexTest(schema, modules);
  const userId = await t.query(internal.extensionToken.getUserIdByToken, {
    token: "lnkdm_invalid",
  });
  expect(userId).toBeNull();
});
