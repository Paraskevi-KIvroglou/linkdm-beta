import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { ActionCtx } from "./_generated/server";
import { Id } from "./_generated/dataModel";
import { auth } from "./auth";
import { encryptCookie, verifyHmac } from "./crypto";

const http = httpRouter();

auth.addHttpRoutes(http);

// Fix 3: Separate CORS headers from Content-Type
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Timestamp, X-Signature",
};

const jsonHeaders = {
  ...corsHeaders,
  "Content-Type": "application/json",
};

async function resolveToken(ctx: ActionCtx, req: Request): Promise<string | null> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  // Fix 4: Trim and guard against empty token
  const token = authHeader.slice(7).trim();
  if (!token) return null;
  return await ctx.runQuery(internal.extensionToken.getUserIdByToken, { token });
}

// CORS preflight for /api/extension/campaigns
http.route({
  path: "/api/extension/campaigns",
  method: "OPTIONS",
  handler: httpAction(async () => {
    return new Response(null, { status: 204, headers: corsHeaders });
  }),
});

// GET /api/extension/campaigns — returns active campaigns for the token owner
http.route({
  path: "/api/extension/campaigns",
  method: "GET",
  handler: httpAction(async (ctx, req) => {
    const userId = await resolveToken(ctx, req);
    if (!userId) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: jsonHeaders,
      });
    }

    const campaigns = await ctx.runQuery(
      internal.campaigns.listActiveByUserId,
      { userId }
    );

    // N+1: one getTodayCount query per campaign. Acceptable at current scale (max 50 campaigns).
    // If the campaign cap increases, consider a batched count query.
    const campaignsWithCount = await Promise.all(
      campaigns.map(async (campaign) => {
        const todayCount = await ctx.runQuery(internal.dmLog.getTodayCount, {
          campaignId: campaign._id,
        });
        return { ...campaign, todayCount };
      })
    );

    return new Response(JSON.stringify({ campaigns: campaignsWithCount }), {
      status: 200,
      headers: jsonHeaders,
    });
  }),
});

// CORS preflight for /api/extension/dmLog
http.route({
  path: "/api/extension/dmLog",
  method: "OPTIONS",
  handler: httpAction(async () => {
    return new Response(null, { status: 204, headers: corsHeaders });
  }),
});

// POST /api/extension/dmLog — records a DM result
http.route({
  path: "/api/extension/dmLog",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const userId = await resolveToken(ctx, req);
    if (!userId) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: jsonHeaders,
      });
    }

    // Fix 1: Guard req.json() against malformed bodies
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
        status: 400,
        headers: jsonHeaders,
      });
    }

    // Fix 2: Validate required POST body fields
    const { campaignId, profileId, profileName, profileUrl, status, errorMessage, connectionStatus } = body;
    const VALID_STATUS = new Set(["sent", "failed", "skipped"]);

    if (
      typeof campaignId !== "string" || !campaignId ||
      typeof profileId !== "string" || !profileId ||
      typeof profileName !== "string" ||
      typeof profileUrl !== "string" ||
      typeof status !== "string" || !VALID_STATUS.has(status)
    ) {
      return new Response(JSON.stringify({ error: "Invalid request body" }), {
        status: 400,
        headers: jsonHeaders,
      });
    }

    // Verify campaign belongs to this user
    const typedCampaignId = campaignId as Id<"campaigns">;
    const campaign = await ctx.runQuery(internal.campaigns.getById, { campaignId: typedCampaignId });
    if (!campaign || campaign.userId !== userId) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: jsonHeaders,
      });
    }

    await ctx.runMutation(internal.dmLog.logDm, {
      campaignId: typedCampaignId,
      profileId,
      profileName,
      profileUrl,
      status: status as "sent" | "failed" | "skipped",
      errorMessage:     typeof errorMessage === "string" ? errorMessage.slice(0, 500) : undefined,
      connectionStatus: typeof connectionStatus === "string" ? connectionStatus : undefined,
    });

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: jsonHeaders,
    });
  }),
});

// CORS preflight for /api/extension/sync-session
http.route({
  path: "/api/extension/sync-session",
  method: "OPTIONS",
  handler: httpAction(async () => {
    return new Response(null, { status: 204, headers: corsHeaders });
  }),
});

// POST /api/extension/sync-session
// Accepts LinkedIn cookies from the Chrome extension, encrypts them, stores in Convex.
// Requires: Authorization: Bearer <extensionToken>
//           X-Timestamp: <epoch seconds>
//           X-Signature: HMAC-SHA256(LINKEDIN_SYNC_HMAC_SECRET, "timestamp=<epoch>") as hex
http.route({
  path: "/api/extension/sync-session",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const userId = await resolveToken(ctx, req);
    if (!userId) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: jsonHeaders,
      });
    }

    const timestamp = req.headers.get("X-Timestamp") ?? "";
    const signature = req.headers.get("X-Signature") ?? "";
    const hmacSecret = process.env.LINKEDIN_SYNC_HMAC_SECRET ?? "";
    const encKey = process.env.LINKEDIN_COOKIE_ENCRYPTION_KEY ?? "";

    if (!hmacSecret || hmacSecret.length < 32 || !encKey || encKey.length !== 64) {
      return new Response(JSON.stringify({ error: "Server misconfiguration" }), {
        status: 500, headers: jsonHeaders,
      });
    }

    // Verify HMAC first (before timestamp check) to avoid timing information leakage
    if (!(await verifyHmac(hmacSecret, timestamp, signature))) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: jsonHeaders,
      });
    }

    // Reject requests outside 5-minute window
    const nowSec = Math.floor(Date.now() / 1000);
    const tsSec = parseInt(timestamp, 10);
    if (isNaN(tsSec) || Math.abs(nowSec - tsSec) > 300) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: jsonHeaders,
      });
    }

    let body: Record<string, unknown>;
    try { body = await req.json(); }
    catch {
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
        status: 400, headers: jsonHeaders,
      });
    }

    const { liAt, jsessionId, userAgent } = body;
    if (typeof liAt !== "string" || !liAt ||
        typeof jsessionId !== "string" || !jsessionId ||
        typeof userAgent !== "string" || !userAgent) {
      return new Response(JSON.stringify({ error: "Missing required fields: liAt, jsessionId, userAgent" }), {
        status: 400, headers: jsonHeaders,
      });
    }

    const encLiAt = await encryptCookie(liAt, encKey);
    const encJsessionId = await encryptCookie(jsessionId, encKey);

    await ctx.runMutation(internal.linkedinSessions.upsertSession, {
      userId, liAt: encLiAt, jsessionId: encJsessionId, userAgent,
    });

    return new Response(JSON.stringify({ success: true }), {
      status: 200, headers: jsonHeaders,
    });
  }),
});

export default http;
