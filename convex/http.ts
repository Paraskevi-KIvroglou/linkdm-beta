import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { ActionCtx } from "./_generated/server";
import { auth } from "./auth";

const http = httpRouter();

auth.addHttpRoutes(http);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Content-Type": "application/json",
};

async function resolveToken(ctx: ActionCtx, req: Request): Promise<string | null> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7);
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
        headers: corsHeaders,
      });
    }

    const campaigns = await ctx.runQuery(
      internal.campaigns.listActiveByUserId,
      { userId }
    );

    // Include today's sent count per campaign so the extension can enforce dailyLimit
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
      headers: corsHeaders,
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
        headers: corsHeaders,
      });
    }

    const body = await req.json();
    const { campaignId, profileId, profileName, profileUrl, status, errorMessage } = body;

    // Verify campaign belongs to this user
    const campaign = await ctx.runQuery(internal.campaigns.getById, { campaignId });
    if (!campaign || campaign.userId !== userId) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: corsHeaders,
      });
    }

    await ctx.runMutation(internal.dmLog.logDm, {
      campaignId,
      profileId,
      profileName,
      profileUrl,
      status,
      errorMessage,
    });

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: corsHeaders,
    });
  }),
});

export default http;
