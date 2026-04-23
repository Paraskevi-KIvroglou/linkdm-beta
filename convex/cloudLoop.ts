"use node";

import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { decryptCookie } from "./crypto";

const LI = "https://www.linkedin.com";

// ── Voyager request helpers ───────────────────────────────────────────────────

function liHeaders(liAt: string, jsessionId: string, userAgent: string) {
  return {
    cookie: `li_at=${liAt}; JSESSIONID="${jsessionId}"`,
    "csrf-token": jsessionId,
    "x-restli-protocol-version": "2.0.0",
    accept: "application/vnd.linkedin.normalized+json+2.1",
    "user-agent": userAgent,
    "x-li-lang": "en_US",
  };
}

async function liGet(
  path: string, liAt: string, jsessionId: string, ua: string
): Promise<{ ok: boolean; status: number; data?: unknown }> {
  try {
    const res = await fetch(LI + path, { headers: liHeaders(liAt, jsessionId, ua) });
    if (!res.ok) return { ok: false, status: res.status };
    return { ok: true, status: res.status, data: await res.json() };
  } catch {
    return { ok: false, status: 0 };
  }
}

async function liPost(
  path: string, body: unknown, liAt: string, jsessionId: string, ua: string
): Promise<{ ok: boolean; status: number; text: string }> {
  try {
    const res = await fetch(LI + path, {
      method: "POST",
      headers: { ...liHeaders(liAt, jsessionId, ua), "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { ok: res.ok, status: res.status, text: await res.text().catch(() => "") };
  } catch {
    return { ok: false, status: 0, text: "" };
  }
}

// ── Profile helpers ───────────────────────────────────────────────────────────

async function fetchSenderFsdUrn(liAt: string, js: string, ua: string): Promise<string | null> {
  const r = await liGet("/voyager/api/me", liAt, js, ua);
  if (!r.ok || !r.data) return null;
  const profile = ((r.data as { included?: unknown[] }).included ?? []).find(
    (i) => typeof (i as Record<string, unknown>).$type === "string" &&
            ((i as Record<string, unknown>).$type as string).includes("MiniProfile")
  ) as Record<string, unknown> | undefined;
  if (!profile?.entityUrn) return null;
  return (profile.entityUrn as string).replace("urn:li:fs_miniProfile:", "urn:li:fsd_profile:");
}

function extractPostUrn(postUrl: string): string | null {
  return postUrl.match(/urn:li:activity:\d+/)?.[0] ?? null;
}

// ── Commenter parsing (mirrors content.js parseCommenters + extractPostActorUrn) ──

interface Commenter {
  profileId: string;
  profileName: string;
  profileUrl: string;
  profileFsdUrn: string;
  commentText: string;
  commentUrn: string | null;
}

function parseCommenters(data: unknown): { commenters: Commenter[]; postActorUrn: string | null } {
  const included = ((data as { included?: unknown[] }).included ?? []) as Record<string, unknown>[];

  const byUrn: Record<string, { profileId: string; profileName: string; profileUrl: string }> = {};
  for (const i of included) {
    if (!String(i.$type ?? "").includes("MiniProfile")) continue;
    byUrn[i.entityUrn as string] = {
      profileId: i.objectUrn as string,
      profileName: [i.firstName, i.lastName].filter(Boolean).join(" "),
      profileUrl: i.publicIdentifier ? `https://www.linkedin.com/in/${i.publicIdentifier}/` : "",
    };
  }

  const seen = new Set<string>();
  const commenters: Commenter[] = [];
  for (const i of included) {
    if (!String(i.$type ?? "").includes("Comment")) continue;
    const c = i.commenter as Record<string, unknown> | undefined;
    const pUrn = (
      c?.["*miniProfile"] ??
      (c?.["com.linkedin.voyager.feed.MemberActor"] as Record<string, unknown> | undefined)?.miniProfile ??
      (c?.["com.linkedin.voyager.feed.render.MemberActor"] as Record<string, unknown> | undefined)?.miniProfile
    ) as string | undefined;
    if (!pUrn || seen.has(pUrn)) continue;
    const profile = byUrn[pUrn];
    if (!profile) continue;
    seen.add(pUrn);

    const m = (i.entityUrn as string | undefined)?.match(/urn:li:fs_objectComment:\((\d+),(.*)\)/);
    const commentUrn = m ? `urn:li:comment:(${m[2]},${m[1]})` : null;
    const cv2 = i.commentV2 as Record<string, unknown> | undefined;
    const cv = i.comment as Record<string, unknown> | undefined;
    const co = i.commentary as Record<string, unknown> | undefined;
    const commentText =
      (cv2?.text as string) ??
      ((cv?.values as Array<{ value: string }> | undefined)?.[0]?.value) ??
      (co?.text as string) ?? "";

    commenters.push({
      ...profile,
      profileFsdUrn: pUrn.replace("urn:li:fs_miniProfile:", "urn:li:fsd_profile:"),
      commentText,
      commentUrn,
    });
  }

  // Extract org URN for company posts
  let postActorUrn: string | null = null;
  for (const i of included) {
    const type = String(i.$type ?? "");
    if (!type.includes("Update") && !type.includes("FeedUpdate")) continue;
    const actor = i.actor as Record<string, unknown> | undefined;
    const ref = (
      actor?.["*miniCompany"] ??
      (actor?.["com.linkedin.voyager.feed.Company"] as Record<string, unknown> | undefined)?.company ??
      actor?.["*company"]
    ) as string | undefined;
    if (ref) {
      const urn = ref.replace("urn:li:fs_miniCompany:", "urn:li:organization:");
      if (urn.startsWith("urn:li:organization:")) { postActorUrn = urn; break; }
    }
  }
  if (!postActorUrn) {
    const mc = included.find((i) => String(i.$type ?? "").includes("MiniCompany")) as Record<string, unknown> | undefined;
    if (mc?.objectUrn) postActorUrn = mc.objectUrn as string;
  }

  return { commenters, postActorUrn };
}

// ── DM sending ────────────────────────────────────────────────────────────────

async function findConvUrn(recipFsdUrn: string, liAt: string, js: string, ua: string): Promise<string | null> {
  const r = await liGet(
    `/voyager/api/voyagerMessagingDashMessengerConversations?q=participants&recipientUrns=List(${encodeURIComponent(recipFsdUrn)})`,
    liAt, js, ua
  );
  if (!r.ok || !r.data) return null;
  return ((r.data as { elements?: Array<{ entityUrn?: string }> }).elements ?? [])[0]?.entityUrn ?? null;
}

async function sendDm(
  recipFsdUrn: string, senderFsdUrn: string, message: string,
  liAt: string, js: string, ua: string
): Promise<{ success: boolean; error?: string; sessionExpired?: boolean }> {
  const convUrn = await findConvUrn(recipFsdUrn, liAt, js, ua);
  const trackingId = crypto.randomUUID().replace(/-/g, "").slice(0, 16);

  let res;
  if (convUrn) {
    res = await liPost(
      "/voyager/api/voyagerMessagingDashMessengerMessages?action=createMessage",
      {
        message: { body: { attributes: [], text: message }, renderContentUnions: [], conversationUrn: convUrn, originToken: crypto.randomUUID() },
        mailboxUrn: senderFsdUrn, trackingId, dedupeByClientGeneratedToken: false,
      },
      liAt, js, ua
    );
  } else {
    res = await liPost(
      "/voyager/api/voyagerMessagingDashMessengerConversations?action=createConversation",
      {
        mailboxUrn: senderFsdUrn,
        message: { body: { attributes: [], text: message }, renderContentUnions: [], originToken: crypto.randomUUID() },
        recipients: [recipFsdUrn], trackingId, dedupeByClientGeneratedToken: false,
      },
      liAt, js, ua
    );
  }

  if (res.status === 401 || res.status === 403) {
    return { success: false, sessionExpired: true, error: `SESSION_${res.status}` };
  }
  if (!res.ok) return { success: false, error: `DM_${res.status}: ${res.text.slice(0, 200)}` };
  return { success: true };
}

// ── Main action ───────────────────────────────────────────────────────────────

export const cloudCampaignLoop = internalAction({
  args: {},
  handler: async (ctx) => {
    console.log("[cloudLoop] Starting run");

    const encKey = process.env.LINKEDIN_COOKIE_ENCRYPTION_KEY ?? "";
    if (encKey.length !== 64) {
      console.error("[cloudLoop] LINKEDIN_COOKIE_ENCRYPTION_KEY not set correctly");
      return;
    }

    const allCampaigns = await ctx.runQuery(internal.campaigns.listAllActive, {});
    console.log(`[cloudLoop] ${allCampaigns.length} active campaign(s)`);

    // Group by userId to avoid redundant session lookups
    const byUser = new Map<string, typeof allCampaigns>();
    for (const c of allCampaigns) {
      if (!byUser.has(c.userId)) byUser.set(c.userId, []);
      byUser.get(c.userId)!.push(c);
    }

    for (const [userId, campaigns] of byUser) {
      const session = await ctx.runQuery(internal.linkedinSessions.getActiveByUserId, { userId });
      if (!session) {
        console.log(`[cloudLoop] No active session for user ${userId}`);
        continue;
      }

      let liAt: string, jsessionId: string;
      try {
        liAt = await decryptCookie(session.liAt, encKey);
        jsessionId = await decryptCookie(session.jsessionId, encKey);
      } catch (err) {
        console.error(`[cloudLoop] Decryption failed for user ${userId}:`, err);
        continue;
      }
      const ua = session.userAgent;

      const senderFsdUrn = await fetchSenderFsdUrn(liAt, jsessionId, ua);
      if (!senderFsdUrn) {
        console.warn(`[cloudLoop] Could not get sender URN for ${userId} — marking expired`);
        await ctx.runMutation(internal.linkedinSessions.markExpired, { userId });
        await ctx.runMutation(internal.campaigns.pauseAllForUser, { userId });
        await notifyExpired(userId);
        continue;
      }

      let sessionDied = false;
      for (const campaign of campaigns) {
        if (sessionDied) break;

        const todayCount = await ctx.runQuery(internal.dmLog.getTodayCount, { campaignId: campaign._id });
        if (todayCount >= campaign.dailyLimit) {
          console.log(`[cloudLoop] Campaign ${campaign._id} at daily limit (${todayCount}/${campaign.dailyLimit})`);
          continue;
        }

        const postUrn = extractPostUrn(campaign.postUrl);
        if (!postUrn) { console.warn(`[cloudLoop] Bad postUrl: ${campaign.postUrl}`); continue; }

        const r = await liGet(
          `/voyager/api/feed/comments?count=100&start=0&q=comments&updateId=${encodeURIComponent(postUrn)}`,
          liAt, jsessionId, ua
        );

        if (r.status === 401 || r.status === 403) {
          console.warn(`[cloudLoop] Session expired mid-loop for ${userId} (${r.status})`);
          await ctx.runMutation(internal.linkedinSessions.markExpired, { userId });
          await ctx.runMutation(internal.campaigns.pauseAllForUser, { userId });
          await notifyExpired(userId);
          sessionDied = true;
          break;
        }
        if (!r.ok) { console.warn(`[cloudLoop] Comments fetch failed: ${r.status}`); continue; }

        const { commenters, postActorUrn } = parseCommenters(r.data);
        console.log(`[cloudLoop] ${commenters.length} commenter(s) for campaign ${campaign._id}`);

        for (const commenter of commenters) {
          if (sessionDied) break;

          const currentCount = await ctx.runQuery(internal.dmLog.getTodayCount, { campaignId: campaign._id });
          if (currentCount >= campaign.dailyLimit) break;

          const alreadySent = await ctx.runQuery(internal.dmLog.hasBeenDmd, {
            campaignId: campaign._id,
            profileId: commenter.profileId,
          });
          if (alreadySent) continue;

          if (campaign.keywordFilter) {
            if (!commenter.commentText.toLowerCase().includes(campaign.keywordFilter.toLowerCase())) continue;
          }

          const firstName = commenter.profileName.split(" ")[0] ?? "";
          const messageText = campaign.messageTemplate
            .replace(/\{\{firstName\}\}/gi, firstName)
            .replace(/\{\{name\}\}/gi, commenter.profileName);

          const dmResult = await sendDm(
            commenter.profileFsdUrn, senderFsdUrn, messageText, liAt, jsessionId, ua
          );

          await ctx.runMutation(internal.dmLog.logDm, {
            campaignId: campaign._id,
            profileId: commenter.profileId,
            profileName: commenter.profileName,
            profileUrl: commenter.profileUrl,
            status: dmResult.success ? "sent" : "failed",
            errorMessage: dmResult.error,
          });

          if (dmResult.sessionExpired) {
            await ctx.runMutation(internal.linkedinSessions.markExpired, { userId });
            await ctx.runMutation(internal.campaigns.pauseAllForUser, { userId });
            await notifyExpired(userId);
            sessionDied = true;
            break;
          }

          // Reply to comment if configured
          if (dmResult.success && campaign.replyTemplate && commenter.commentUrn) {
            const replyText = campaign.replyTemplate
              .replace(/\{\{firstName\}\}/gi, firstName)
              .replace(/\{\{name\}\}/gi, commenter.profileName);
            const actorUrn = (campaign.postType === "company" && postActorUrn)
              ? postActorUrn : senderFsdUrn;
            await liPost(
              "/voyager/api/feed/comments",
              { actor: actorUrn, message: { attributes: [], text: replyText }, parentComment: commenter.commentUrn },
              liAt, jsessionId, ua
            );
          }

          // 2–4 s jitter between sends
          await new Promise((r) => setTimeout(r, 2000 + Math.random() * 2000));
        }
      }
    }
    console.log("[cloudLoop] Run complete");
  },
});

async function notifyExpired(userId: string) {
  // Placeholder — email via Resend to be wired in a follow-up task
  console.warn(`[cloudLoop] TODO: send session-expired email for userId=${userId}`);
}
