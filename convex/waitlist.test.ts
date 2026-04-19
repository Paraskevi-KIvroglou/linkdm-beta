/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

test("waitlist table is defined in schema", () => {
  expect(schema.tables.waitlist).toBeDefined();
});

test("joinWaitlist saves email with isApproved false", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(api.waitlist.joinWaitlist, { email: "beta@example.com" });
  const approved = await t.query(api.waitlist.checkApproval, { email: "beta@example.com" });
  expect(approved).toBe(false);
});

test("joinWaitlist is idempotent — duplicate calls do not throw", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(api.waitlist.joinWaitlist, { email: "beta@example.com" });
  await t.mutation(api.waitlist.joinWaitlist, { email: "beta@example.com" });
  const approved = await t.query(api.waitlist.checkApproval, { email: "beta@example.com" });
  expect(approved).toBe(false);
});

test("checkApproval returns false for unknown email", async () => {
  const t = convexTest(schema, modules);
  const result = await t.query(api.waitlist.checkApproval, { email: "nobody@example.com" });
  expect(result).toBe(false);
});

test("approveUser sets isApproved to true", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(api.waitlist.joinWaitlist, { email: "user@example.com" });
  await t.mutation(api.waitlist.approveUser, { email: "user@example.com" });
  const approved = await t.query(api.waitlist.checkApproval, { email: "user@example.com" });
  expect(approved).toBe(true);
});

test("approveUser throws for unknown email", async () => {
  const t = convexTest(schema, modules);
  await expect(
    t.mutation(api.waitlist.approveUser, { email: "ghost@example.com" })
  ).rejects.toThrow("not found in waitlist");
});
