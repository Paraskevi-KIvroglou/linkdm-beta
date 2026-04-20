import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { ActionCtx } from "./_generated/server";
import { auth } from "./auth";

const http = httpRouter();

auth.addHttpRoutes(http);

// Fix 3: Separate CORS headers from Content-Type
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
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
    const { campaignId, profileId, profileName, profileUrl, status, errorMessage } = body;
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
    const campaign = await ctx.runQuery(internal.campaigns.getById, { campaignId });
    if (!campaign || campaign.userId !== userId) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: jsonHeaders,
      });
    }

    await ctx.runMutation(internal.dmLog.logDm, {
      campaignId,
      profileId,
      profileName,
      profileUrl,
      status,
      // Fix 5: Cap errorMessage length
      errorMessage: typeof errorMessage === "string" ? errorMessage.slice(0, 500) : undefined,
    });

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: jsonHeaders,
    });
  }),
});

export default http;
