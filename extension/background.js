// linkdm service worker
// Runs every 30s via chrome.alarms. Fetches active campaigns from Convex,
// picks the next eligible commenter, and tells the content script to send the DM.

// ── Configuration ─────────────────────────────────────────────────────────────
// This is your Convex HTTP site URL — different from NEXT_PUBLIC_CONVEX_URL.
// Replace .convex.cloud with .convex.site in your deployment URL.
const CONVEX_SITE_URL = "https://utmost-lemur-208.eu-west-1.convex.site";

// ── Startup: register alarm ───────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(setupAlarms);
chrome.runtime.onStartup.addListener(setupAlarms);

function setupAlarms() {
  // Chrome alarms must be >= 0.5 minutes (30s). We set 0.5 to get ~30s ticks.
  // The actual DM pacing (30–90s delay between sends) is enforced via nextSendAt.
  chrome.alarms.create("tick", { periodInMinutes: 0.5 });
  console.log("[linkdm] Alarm registered");
}

// ── Keep-alive: open port from content script prevents worker from sleeping ───
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "keepalive") return;
  port.onDisconnect.addListener(() => {
    console.log("[linkdm] Content script disconnected (tab closed or navigated)");
  });
});

// ── Main tick ────────────────────────────────────────────────────────────────
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== "tick") return;
  try {
    await runCampaignLoop();
  } catch (err) {
    console.error("[linkdm] Campaign loop error:", err);
  }
});

// ── DM sender — runs in page context (world: "MAIN") ─────────────────────────
// This function is serialised and injected into the LinkedIn tab via
// chrome.scripting.executeScript. Running in MAIN world means it uses
// LinkedIn's monkey-patched window.fetch, which adds the proprietary headers
// their API requires (avoiding the 400 that clean fetch calls get).
async function linkedInSendDm(recipientUrn, messageText) {
  // ── helpers (must be self-contained — no closure access) ──────────────────
  function csrf() {
    const m = document.cookie.match(/JSESSIONID="?([^";]+)"?/);
    return m ? m[1] : null;
  }
  function trackingId() {
    return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
  }
  async function li(path, init) {
    return fetch(`https://www.linkedin.com${path}`, {
      credentials: "include",
      ...init,
      headers: {
        "csrf-token": csrf(),
        "x-restli-protocol-version": "2.0.0",
        ...(init?.body ? { "content-type": "application/json" } : { accept: "application/vnd.linkedin.normalized+json+2.1" }),
        ...(init?.headers ?? {}),
      },
    });
  }

  const token = csrf();
  if (!token) return { success: false, error: "NO_CSRF" };

  // Resolve recipient to fsd_profile URN if needed
  let recipientFsdUrn = recipientUrn;
  if (!recipientFsdUrn?.startsWith("urn:li:fsd_profile:")) {
    if (recipientFsdUrn?.startsWith("urn:li:fs_miniProfile:")) {
      recipientFsdUrn = recipientFsdUrn.replace("urn:li:fs_miniProfile:", "urn:li:fsd_profile:");
    } else {
      // member URN: look up via profile API
      const memberId = recipientFsdUrn?.match(/urn:li:member:(\d+)/)?.[1];
      if (!memberId) return { success: false, error: `BAD_URN:${recipientUrn}` };
      const r = await li(`/voyager/api/identity/profiles?memberIdentity=${memberId}`);
      if (!r.ok) return { success: false, error: `PROFILE_LOOKUP_${r.status}` };
      const d = await r.json();
      const mp = (d.included || []).find(i => i.$type?.includes("MiniProfile"));
      if (!mp?.entityUrn) return { success: false, error: "PROFILE_LOOKUP_NO_URN" };
      recipientFsdUrn = mp.entityUrn.replace("urn:li:fs_miniProfile:", "urn:li:fsd_profile:");
    }
  }

  // Get sender fsd_profile URN
  const meRes = await li("/voyager/api/me");
  if (!meRes.ok) return { success: false, error: `ME_${meRes.status}` };
  const meData = await meRes.json();
  const mp = (meData.included || []).find(i => i.$type?.includes("MiniProfile"));
  if (!mp?.entityUrn) return { success: false, error: "ME_NO_URN" };
  const senderFsdUrn = mp.entityUrn.replace("urn:li:fs_miniProfile:", "urn:li:fsd_profile:");

  // Check for existing conversation
  const enc = encodeURIComponent(recipientFsdUrn);
  const convRes = await li(`/voyager/api/voyagerMessagingDashMessengerConversations?q=participants&recipientUrns=List(${enc})`);
  const convData = convRes.ok ? await convRes.json() : null;
  const convUrn = (convData?.elements || [])[0]?.entityUrn ?? null;

  if (convUrn) {
    // Existing conversation — send via createMessage
    const r = await li("/voyager/api/voyagerMessagingDashMessengerMessages?action=createMessage", {
      method: "POST",
      body: JSON.stringify({
        message: {
          body: { attributes: [], text: messageText },
          renderContentUnions: [],
          conversationUrn: convUrn,
          originToken: crypto.randomUUID(),
        },
        mailboxUrn: senderFsdUrn,
        trackingId: trackingId(),
        dedupeByClientGeneratedToken: false,
      }),
    });
    if (!r.ok) {
      const b = await r.text().catch(() => "");
      return { success: false, error: `createMessage_${r.status}: ${b.slice(0, 200)}` };
    }
    return { success: true };
  } else {
    // No conversation yet — create + send in one call
    const r = await li("/voyager/api/voyagerMessagingDashMessengerConversations?action=createConversation", {
      method: "POST",
      body: JSON.stringify({
        mailboxUrn: senderFsdUrn,
        message: {
          body: { attributes: [], text: messageText },
          renderContentUnions: [],
          originToken: crypto.randomUUID(),
        },
        recipients: [recipientFsdUrn],
        trackingId: trackingId(),
        dedupeByClientGeneratedToken: false,
      }),
    });
    if (!r.ok) {
      const b = await r.text().catch(() => "");
      return { success: false, error: `createConversation_${r.status}: ${b.slice(0, 200)}` };
    }
    return { success: true };
  }
}

// ── Content script health check + auto-inject ────────────────────────────────
// Returns true if the content script is reachable in tabId.
// If not reachable, injects content.js programmatically (handles tabs that were
// open before the extension loaded, or after an extension reload).
async function ensureContentScript(tabId) {
  // Try a PING first
  try {
    const res = await chrome.tabs.sendMessage(tabId, { type: "PING" });
    if (res?.ok) {
      console.log("[linkdm] Content script already running ✓");
      return true;
    }
  } catch {}

  // Not reachable — inject it now
  console.log("[linkdm] Content script missing — injecting...");
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"],
    });
    console.log("[linkdm] Content script injected ✓");
    // Give it 300ms to register its message listener
    await new Promise((r) => setTimeout(r, 300));
    return true;
  } catch (err) {
    console.error("[linkdm] Failed to inject content script:", err.message);
    return false;
  }
}

// ── Campaign orchestration ────────────────────────────────────────────────────
async function runCampaignLoop() {
  console.log("[linkdm] Tick —", new Date().toLocaleTimeString());

  // Require a token
  const { token } = await chrome.storage.local.get("token");
  if (!token) {
    console.log("[linkdm] No token stored — open the extension popup and paste your token");
    return;
  }

  // Respect the DM pacing delay (30–90s between sends)
  const { nextSendAt = 0 } = await chrome.storage.local.get("nextSendAt");
  if (Date.now() < nextSendAt) {
    const remaining = Math.ceil((nextSendAt - Date.now()) / 1000);
    console.log(`[linkdm] Next DM in ${remaining}s`);
    return;
  }

  // Need a LinkedIn tab for Voyager API calls
  const tabs = await chrome.tabs.query({ url: "https://www.linkedin.com/*" });
  const linkedinTab = tabs[0];
  if (!linkedinTab) {
    console.log("[linkdm] No LinkedIn tab open — waiting");
    return;
  }

  // Make sure the content script is actually running in that tab.
  // It may not be if the tab was open before the extension loaded, or after an
  // extension reload. If the PING fails, inject content.js programmatically.
  const ready = await ensureContentScript(linkedinTab.id);
  if (!ready) {
    console.warn("[linkdm] Could not reach or inject content script — will retry next tick");
    return;
  }

  // Fetch active campaigns from Convex (includes todayCount per campaign)
  let campaigns;
  try {
    const res = await fetch(`${CONVEX_SITE_URL}/api/extension/campaigns`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) {
      console.error("[linkdm] Token rejected by Convex — check your token in the popup");
      return;
    }
    if (!res.ok) {
      console.error("[linkdm] Campaigns fetch failed:", res.status);
      return;
    }
    const body = await res.json();
    campaigns = body.campaigns;
  } catch (err) {
    console.error("[linkdm] Failed to fetch campaigns:", err);
    return;
  }

  if (!campaigns?.length) {
    console.log("[linkdm] No active campaigns");
    return;
  }

  // Load the local deduplication cache (profileIds already DM'd per campaign)
  const { dmedProfiles = {} } = await chrome.storage.local.get("dmedProfiles");

  for (const campaign of campaigns) {
    // Skip campaigns that have hit their daily limit
    if (campaign.todayCount >= campaign.dailyLimit) {
      await maybeSendLimitNotification(campaign);
      continue;
    }

    // Ask content script to fetch commenters from LinkedIn
    let fetchResult;
    try {
      fetchResult = await chrome.tabs.sendMessage(linkedinTab.id, {
        type: "FETCH_COMMENTERS",
        postUrl: campaign.postUrl,
      });
    } catch (err) {
      // Content script not available (page still loading, or non-feed LinkedIn page)
      // Return (not continue) — all campaigns share the same LinkedIn tab.
      // If the content script is unreachable for one, it's unreachable for all.
      console.warn("[linkdm] Could not reach content script:", err?.message ?? String(err));
      return;
    }

    // Handle session expiry
    if (fetchResult?.error === "SESSION_EXPIRED") {
      await showNotification("session-expired", {
        title: "linkdm — LinkedIn session expired",
        message:
          "⚠️ Your LinkedIn connection needs a refresh. Just open LinkedIn in your browser and your campaigns will resume automatically.",
      });
      return;
    }

    if (!fetchResult?.commenters?.length) {
      console.log(`[linkdm] No commenters found for campaign ${campaign._id}`);
      continue;
    }

    // Filter: skip already-DM'd profiles and those who don't match the keyword
    const alreadyDmed = new Set(dmedProfiles[campaign._id] || []);
    const eligible = fetchResult.commenters.filter((c) => {
      if (alreadyDmed.has(c.profileId)) return false;
      if (
        campaign.keywordFilter &&
        !c.commentText.toLowerCase().includes(campaign.keywordFilter.toLowerCase())
      ) {
        return false;
      }
      return true;
    });

    // Check if campaign is complete (all commenters have been DM'd)
    const allDone =
      fetchResult.commenters.length > 0 &&
      fetchResult.commenters.every((c) => alreadyDmed.has(c.profileId));
    if (allDone) {
      await showNotification(`complete-${campaign._id}`, {
        title: "linkdm — Campaign complete!",
        message:
          "✅ Campaign complete! You've messaged everyone who commented on your post. Check your LinkedIn inbox for replies.",
      });
      continue;
    }

    if (eligible.length === 0) {
      console.log(
        `[linkdm] No eligible commenters for campaign ${campaign._id} (all filtered by keyword)`
      );
      continue;
    }

    // Pick the first eligible commenter
    const next = eligible[0];
    console.log(`[linkdm] Sending DM to ${next.profileName} | fsdUrn=${next.profileFsdUrn ?? "MISSING"} | profileId=${next.profileId}`);

    // Send DM by running directly in the page's JS context (world: "MAIN").
    // This uses LinkedIn's own monkey-patched fetch, which automatically adds
    // the proprietary headers their API requires — solving the 400 problem.
    let dmResult;
    try {
      const execResults = await chrome.scripting.executeScript({
        target: { tabId: linkedinTab.id },
        world: "MAIN",
        func: linkedInSendDm,
        args: [next.profileFsdUrn || next.profileId, campaign.messageTemplate],
      });
      dmResult = execResults?.[0]?.result ?? { success: false, error: "SCRIPT_EXEC_NO_RESULT" };
    } catch (err) {
      console.error("[linkdm] executeScript failed:", err?.message ?? String(err));
      dmResult = { success: false, error: err?.message ?? String(err) };
    }

    const status = dmResult?.success ? "sent" : "failed";
    if (!dmResult?.success) {
      console.warn(`[linkdm] DM error for ${next.profileName}:`, dmResult?.error);
    }

    // Report result to Convex backend
    try {
      const logRes = await fetch(`${CONVEX_SITE_URL}/api/extension/dmLog`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          campaignId: campaign._id,
          profileId: next.profileId,
          profileName: next.profileName,
          profileUrl: next.profileUrl,
          status,
          errorMessage: dmResult?.error,
        }),
      });
      if (!logRes.ok) {
        console.error("[linkdm] Failed to log DM to Convex:", logRes.status);
      }
    } catch (err) {
      console.error("[linkdm] Failed to log DM to Convex:", err);
    }

    // Only mark as done if the DM was actually sent.
    // Failed sends are NOT cached — they will be retried on the next tick.
    if (status === "sent") {
      if (!dmedProfiles[campaign._id]) dmedProfiles[campaign._id] = [];
      dmedProfiles[campaign._id].push(next.profileId);
      await chrome.storage.local.set({ dmedProfiles });
    }

    // Reply to the comment if a reply template is configured
    if (status === "sent" && campaign.replyTemplate && next.commentUrn) {
      try {
        const replyResult = await chrome.tabs.sendMessage(linkedinTab.id, {
          type: "REPLY_TO_COMMENT",
          commentUrn: next.commentUrn,
          message: campaign.replyTemplate,
        });
        if (replyResult?.success) {
          console.log(`[linkdm] Comment reply sent for ${next.profileName}`);
        } else {
          console.warn(`[linkdm] Comment reply failed for ${next.profileName}:`, replyResult?.error);
        }
      } catch (err) {
        console.warn("[linkdm] Could not send comment reply:", err?.message ?? String(err));
      }
    }

    // Schedule next DM: random 30–90 second delay
    const delayMs = 30_000 + Math.floor(Math.random() * 60_000);
    await chrome.storage.local.set({ nextSendAt: Date.now() + delayMs });

    console.log(
      `[linkdm] DM ${status} → ${next.profileName}. Next DM in ${Math.round(delayMs / 1000)}s`
    );

    return; // One DM per tick — wait for the next alarm
  }
}

// ── Notifications ─────────────────────────────────────────────────────────────

// In-memory set to avoid repeating milestone notifications within one session.
// Resets if the service worker is restarted (acceptable for a beta).
const notificationsSent = new Set();

async function maybeSendLimitNotification(campaign) {
  const key = `limit-${campaign._id}`;
  if (notificationsSent.has(key)) return;
  notificationsSent.add(key);
  await showNotification(key, {
    title: "linkdm — Daily limit reached",
    message: `🎉 Great news! Your campaign sent its ${campaign.dailyLimit} DMs for today. It'll automatically pick up again tomorrow morning.`,
  });
}

function showNotification(id, { title, message }) {
  return new Promise((resolve) => {
    chrome.notifications.create(
      id,
      { type: "basic", iconUrl: "icons/icon48.png", title, message },
      resolve
    );
  });
}

// Clicking any notification opens the linkdm dashboard
chrome.notifications.onClicked.addListener((notificationId) => {
  chrome.tabs.create({ url: "https://beta-login-tawny.vercel.app/dashboard" });
  chrome.notifications.clear(notificationId);
});

console.log("[linkdm] Service worker ready");
