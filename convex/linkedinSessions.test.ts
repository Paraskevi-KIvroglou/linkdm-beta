/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

test("upsertSession inserts a new active session", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(internal.linkedinSessions.upsertSession, {
    userId: "u1",
    liAt: "enc_li_at",
    jsessionId: "enc_js",
    userAgent: "Mozilla/5.0",
  });
  const s = await t.query(internal.linkedinSessions.getActiveByUserId, { userId: "u1" });
  expect(s).not.toBeNull();
  expect(s!.status).toBe("active");
  expect(s!.liAt).toBe("enc_li_at");
});

test("upsertSession updates an existing session", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(internal.linkedinSessions.upsertSession, {
    userId: "u1", liAt: "v1", jsessionId: "j1", userAgent: "UA1",
  });
  await t.mutation(internal.linkedinSessions.upsertSession, {
    userId: "u1", liAt: "v2", jsessionId: "j2", userAgent: "UA2",
  });
  const s = await t.query(internal.linkedinSessions.getActiveByUserId, { userId: "u1" });
  expect(s!.liAt).toBe("v2");
  expect(s!.userAgent).toBe("UA2");
});

test("markExpired hides session from getActiveByUserId", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(internal.linkedinSessions.upsertSession, {
    userId: "u1", liAt: "v", jsessionId: "j", userAgent: "UA",
  });
  await t.mutation(internal.linkedinSessions.markExpired, { userId: "u1" });
  const s = await t.query(internal.linkedinSessions.getActiveByUserId, { userId: "u1" });
  expect(s).toBeNull();
});

test("getSessionStatus returns null when no session", async () => {
  const t = convexTest(schema, modules);
  const s = await t
    .withIdentity({ tokenIdentifier: "u1" })
    .query(api.linkedinSessions.getSessionStatus, {});
  expect(s).toBeNull();
});

test("getSessionStatus returns status without cookie values", async () => {
  const t = convexTest(schema, modules);
  const asUser = t.withIdentity({ tokenIdentifier: "u1" });
  // Resolve the actual userId that getAuthUserId returns for this identity
  const userId = await asUser.query(internal.linkedinSessions.getActiveByUserId, { userId: "u1" })
    .then(() => null).catch(() => null);
  // Use t.run to insert with the identity-resolved userId
  await asUser.run(async (ctx) => {
    const { getAuthUserId: getId } = await import("@convex-dev/auth/server");
    const resolvedId = await getId(ctx);
    if (resolvedId) {
      await ctx.db.insert("linkedinSessions", {
        userId: resolvedId,
        liAt: "secret",
        jsessionId: "secret2",
        userAgent: "UA",
        status: "active",
        syncedAt: Date.now(),
      });
    }
  });
  const s = await asUser.query(api.linkedinSessions.getSessionStatus, {});
  expect(s).not.toBeNull();
  expect(s!.status).toBe("active");
  expect((s as Record<string, unknown>).liAt).toBeUndefined();
});
