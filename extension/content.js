// linkdm content script
// Runs on every linkedin.com page.
// Handles Voyager API calls (same-origin, cookies auto-attach)
// and keeps the service worker alive via an open port.

// ── Keep service worker alive ─────────────────────────────────────────────────
// Wrapped in try-catch: if the service worker isn't ready yet, don't crash the
// entire content script — just skip the keepalive port.
try {
  chrome.runtime.connect({ name: "keepalive" });
} catch (e) {
  console.warn("[linkdm] keepalive connect failed (non-fatal):", e?.message);
}

// ── Message listener ─────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "PING") {
    sendResponse({ ok: true });
    return;
  }
  if (message.type === "FETCH_COMMENTERS") {
    fetchCommenters(message.postUrl).then(sendResponse).catch((err) => {
      sendResponse({ error: err.message });
    });
    return true; // keeps the message channel open for async response
  }
  if (message.type === "SEND_DM") {
    sendDm(message.profileFsdUrn || message.profileId, message.message).then(sendResponse).catch((err) => {
      sendResponse({ success: false, error: err.message });
    });
    return true;
  }
  if (message.type === "REPLY_TO_COMMENT") {
    replyToComment(message.commentUrn, message.message).then(sendResponse).catch((err) => {
      sendResponse({ success: false, error: err.message });
    });
    return true;
  }
});

// ── Module-level cache ────────────────────────────────────────────────────────
let cachedMyProfileUrn = null;
let cachedMyFsdUrn = null;

// ── CSRF token ────────────────────────────────────────────────────────────────
function getCsrfToken() {
  // LinkedIn stores the CSRF token in the JSESSIONID cookie (not HttpOnly)
  const match = document.cookie.match(/JSESSIONID="?([^";]+)"?/);
  return match ? match[1] : null;
}

// ── Comment reply URN extraction ──────────────────────────────────────────────
function extractCommentReplyUrn(entityUrn) {
  // entityUrn: "urn:li:fs_objectComment:(COMMENT_ID,ugcPost:POST_ID)"
  const match = entityUrn?.match(/urn:li:fs_objectComment:\((\d+),(.*)\)/);
  if (!match) return null;
  const [, commentId, postUrn] = match;
  return `urn:li:comment:(${postUrn},${commentId})`;
}

// ── Get own profile URNs ──────────────────────────────────────────────────────
async function fetchMyProfile() {
  const csrfToken = getCsrfToken();
  if (!csrfToken) return null;
  try {
    const res = await fetch("https://www.linkedin.com/voyager/api/me", {
      credentials: "include",
      headers: {
        "csrf-token": csrfToken,
        "x-restli-protocol-version": "2.0.0",
        accept: "application/vnd.linkedin.normalized+json+2.1",
      },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return (data.included || []).find(i => i.$type?.includes("MiniProfile")) ?? null;
  } catch {
    return null;
  }
}

async function getMyProfileUrn() {
  if (cachedMyProfileUrn) return cachedMyProfileUrn;
  const profile = await fetchMyProfile();
  cachedMyProfileUrn = profile?.objectUrn ?? null;
  if (profile?.entityUrn) {
    cachedMyFsdUrn = profile.entityUrn.replace("urn:li:fs_miniProfile:", "urn:li:fsd_profile:");
  }
  return cachedMyProfileUrn;
}

async function getMyFsdProfileUrn() {
  if (cachedMyFsdUrn) return cachedMyFsdUrn;
  await getMyProfileUrn(); // populates both caches
  return cachedMyFsdUrn;
}

// ── Post URN extraction ───────────────────────────────────────────────────────
function extractPostUrn(postUrl) {
  const match = postUrl.match(/urn:li:activity:\d+/);
  return match ? match[0] : null;
}

// ── Commenter parsing ─────────────────────────────────────────────────────────
function parseCommenters(data) {
  const included = data.included || [];

  // Build map from miniProfile entityUrn → profile info
  const profilesByUrn = {};
  for (const item of included) {
    if (item.$type && item.$type.includes("MiniProfile")) {
      profilesByUrn[item.entityUrn] = {
        profileId: item.objectUrn,
        profileName: [item.firstName, item.lastName].filter(Boolean).join(" "),
        profileUrl: item.publicIdentifier
          ? `https://www.linkedin.com/in/${item.publicIdentifier}/`
          : "",
      };
    }
  }

  const seen = new Set();
  const commenters = [];
  for (const item of included) {
    if (!item.$type?.includes("Comment")) continue;

    // LinkedIn uses different shapes depending on post type and API version.
    // Priority order (most common first):
    // 1. New style: commenter["*miniProfile"] = "urn:li:fs_miniProfile:..." (company page posts)
    // 2. Old style: commenter["com.linkedin.voyager.feed.MemberActor"].miniProfile
    // 3. Old style variant: commenter["com.linkedin.voyager.feed.render.MemberActor"].miniProfile
    let profileUrn =
      item.commenter?.["*miniProfile"] ??
      item.commenter?.["com.linkedin.voyager.feed.MemberActor"]?.miniProfile ??
      item.commenter?.["com.linkedin.voyager.feed.render.MemberActor"]?.miniProfile ??
      null;

    if (!profileUrn || seen.has(profileUrn)) continue;
    const profile = profilesByUrn[profileUrn];
    if (!profile) continue;
    seen.add(profileUrn);
    // Derive fsd_profile URN from fs_miniProfile entityUrn (same encoded ID, different prefix)
    const profileFsdUrn = profileUrn?.replace("urn:li:fs_miniProfile:", "urn:li:fsd_profile:") ?? null;
    commenters.push({
      ...profile,
      profileFsdUrn,
      // LinkedIn uses different text fields depending on API version/post type.
      // commentV2.text is the most reliable; comment.values[0].value is the fallback.
      commentText: item.commentV2?.text || item.comment?.values?.[0]?.value || item.commentary?.text || "",
      commentUrn: extractCommentReplyUrn(item.entityUrn),
    });
  }

  console.log(`[linkdm] Parsed ${commenters.length} commenters from ${included.length} included items`);
  return commenters;
}

// ── Fetch commenters from Voyager API ─────────────────────────────────────────
async function fetchCommenters(postUrl) {
  const csrfToken = getCsrfToken();
  if (!csrfToken) return { error: "NO_CSRF_TOKEN" };

  const postUrn = extractPostUrn(postUrl);
  if (!postUrn) return { error: "INVALID_POST_URL" };

  try {
    const res = await fetch(
      `https://www.linkedin.com/voyager/api/feed/comments` +
        `?count=100&start=0&q=comments&updateId=${encodeURIComponent(postUrn)}`,
      {
        credentials: "include",
        headers: {
          "csrf-token": csrfToken,
          "x-restli-protocol-version": "2.0.0",
          accept: "application/vnd.linkedin.normalized+json+2.1",
        },
      }
    );

    if (res.status === 401) return { error: "SESSION_EXPIRED" };
    if (res.status === 403) return { error: "FORBIDDEN_check_post_visibility" };
    if (!res.ok) return { error: `HTTP_${res.status}` };

    const data = await res.json();
    const commenters = parseCommenters(data);

    if (commenters.length === 0 && (data.included || []).length > 0) {
      // Log a sample of the raw data so we can fix the parser
      console.warn("[linkdm] Got included items but parsed 0 commenters. Sample:",
        JSON.stringify((data.included || []).slice(0, 2)));
    }

    console.log(`[linkdm] Fetched ${commenters.length} commenters for ${postUrn}`);
    return { commenters };
  } catch (err) {
    return { error: err.message };
  }
}

// ── Send DM via Voyager messaging API ─────────────────────────────────────────
// Handles two cases:
//   1. Existing conversation → look up conversationUrn, send via createMessage
//   2. No conversation yet  → create new conversation via createConversation
//                             (this also sends the first message in one call)
async function sendDm(profileId, message) {
  const csrfToken = getCsrfToken();
  if (!csrfToken) return { success: false, error: "NO_CSRF_TOKEN" };

  // Resolve to fsd_profile URN — the messaging API requires this format.
  // parseCommenters already derives fsd_profile from fs_miniProfile entityUrn,
  // but as a fallback we also accept a member URN and look up the fsd URN.
  let recipientFsdUrn = profileId;
  if (!recipientFsdUrn?.startsWith("urn:li:fsd_profile:")) {
    const resolved = await resolveFsdUrn(csrfToken, profileId);
    if (!resolved) {
      return { success: false, error: `COULD_NOT_RESOLVE_FSD_URN_FOR:${profileId}` };
    }
    recipientFsdUrn = resolved;
    console.log(`[linkdm] Resolved fsd URN: ${recipientFsdUrn}`);
  }

  // Get sender's fsd_profile URN
  const senderFsdUrn = await getMyFsdProfileUrn();
  if (!senderFsdUrn) return { success: false, error: "COULD_NOT_GET_SENDER_FSD_URN" };

  // Check if a conversation already exists with this person
  const convUrn = await findConversationUrn(csrfToken, recipientFsdUrn);

  if (convUrn) {
    // ── Case 1: existing conversation — send via createMessage ────────────────
    console.log(`[linkdm] Sending to existing conversation: ${convUrn}`);
    return sendToExistingConversation(csrfToken, senderFsdUrn, convUrn, message);
  } else {
    // ── Case 2: no conversation yet — create + send in one call ───────────────
    console.log(`[linkdm] No existing conversation — creating new one with ${recipientFsdUrn}`);
    return createNewConversation(csrfToken, senderFsdUrn, recipientFsdUrn, message);
  }
}

// ── Send to an existing conversation ─────────────────────────────────────────
async function sendToExistingConversation(csrfToken, senderFsdUrn, convUrn, message) {
  try {
    const res = await fetch(
      "https://www.linkedin.com/voyager/api/voyagerMessagingDashMessengerMessages?action=createMessage",
      {
        method: "POST",
        credentials: "include",
        headers: {
          "csrf-token": csrfToken,
          "x-restli-protocol-version": "2.0.0",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          message: {
            body: { attributes: [], text: message },
            renderContentUnions: [],
            conversationUrn: convUrn,
            originToken: crypto.randomUUID(),
          },
          mailboxUrn: senderFsdUrn,
          trackingId: btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16)))),
          dedupeByClientGeneratedToken: false,
        }),
      }
    );

    if (res.status === 401) return { success: false, error: "SESSION_EXPIRED" };
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { success: false, error: `HTTP_${res.status}: ${body.slice(0, 200)}` };
    }

    console.log(`[linkdm] DM sent to existing conversation`);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ── Create a brand-new conversation and send the first message ────────────────
async function createNewConversation(csrfToken, senderFsdUrn, recipientFsdUrn, message) {
  try {
    const res = await fetch(
      "https://www.linkedin.com/voyager/api/voyagerMessagingDashMessengerConversations?action=createConversation",
      {
        method: "POST",
        credentials: "include",
        headers: {
          "csrf-token": csrfToken,
          "x-restli-protocol-version": "2.0.0",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          mailboxUrn: senderFsdUrn,
          message: {
            body: { attributes: [], text: message },
            renderContentUnions: [],
            originToken: crypto.randomUUID(),
          },
          recipients: [recipientFsdUrn],
          trackingId: btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16)))),
          dedupeByClientGeneratedToken: false,
        }),
      }
    );

    if (res.status === 401) return { success: false, error: "SESSION_EXPIRED" };
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { success: false, error: `HTTP_${res.status}: ${body.slice(0, 200)}` };
    }

    console.log(`[linkdm] New conversation created and first DM sent to ${recipientFsdUrn}`);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ── Resolve fsd_profile URN from any URN format ───────────────────────────────
// If we only have a urn:li:member:ID or urn:li:fs_miniProfile:ID, look up the
// fsd_profile URN via the profile API.
async function resolveFsdUrn(csrfToken, profileId) {
  // Already correct format
  if (profileId?.startsWith("urn:li:fsd_profile:")) return profileId;

  // fs_miniProfile → fsd_profile is a direct prefix swap (same encoded ID)
  if (profileId?.startsWith("urn:li:fs_miniProfile:")) {
    return profileId.replace("urn:li:fs_miniProfile:", "urn:li:fsd_profile:");
  }

  // member URN: extract numeric ID and look up via profile API
  const memberId = profileId?.match(/urn:li:member:(\d+)/)?.[1];
  if (!memberId) return null;

  try {
    const res = await fetch(
      `https://www.linkedin.com/voyager/api/identity/profiles?memberIdentity=${memberId}`,
      {
        credentials: "include",
        headers: {
          "csrf-token": csrfToken,
          "x-restli-protocol-version": "2.0.0",
          accept: "application/vnd.linkedin.normalized+json+2.1",
        },
      }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const profile = (data.included || []).find(i => i.$type?.includes("MiniProfile"));
    if (profile?.entityUrn) {
      return profile.entityUrn.replace("urn:li:fs_miniProfile:", "urn:li:fsd_profile:");
    }
  } catch (err) {
    console.warn("[linkdm] resolveFsdUrn error:", err.message);
  }
  return null;
}

// ── Look up conversationUrn by recipient fsd_profile URN ─────────────────────
// Returns the conversationUrn string if a conversation exists, or null if not.
async function findConversationUrn(csrfToken, recipientFsdUrn) {
  const encodedRecipient = encodeURIComponent(recipientFsdUrn);
  const url = `https://www.linkedin.com/voyager/api/voyagerMessagingDashMessengerConversations` +
    `?q=participants&recipientUrns=List(${encodedRecipient})`;
  try {
    const res = await fetch(url, {
      credentials: "include",
      headers: {
        "csrf-token": csrfToken,
        "x-restli-protocol-version": "2.0.0",
        accept: "application/vnd.linkedin.normalized+json+2.1",
      },
    });
    console.log(`[linkdm] Conversation lookup status: ${res.status}`);
    if (!res.ok) return null;
    const data = await res.json();
    const conv = (data.elements || [])[0];
    if (conv?.entityUrn) {
      console.log(`[linkdm] Found existing conversation: ${conv.entityUrn}`);
      return conv.entityUrn;
    }
  } catch (err) {
    console.warn("[linkdm] Conversation lookup error:", err.message);
  }
  return null;
}

// ── Reply to comment via Voyager feed API ─────────────────────────────────────
async function replyToComment(commentUrn, message) {
  const csrfToken = getCsrfToken();
  if (!csrfToken) return { success: false, error: "NO_CSRF_TOKEN" };

  const actorUrn = await getMyProfileUrn();
  if (!actorUrn) return { success: false, error: "COULD_NOT_GET_PROFILE_URN" };

  if (!commentUrn) return { success: false, error: "NO_COMMENT_URN" };

  try {
    const res = await fetch(
      "https://www.linkedin.com/voyager/api/feed/comments",
      {
        method: "POST",
        credentials: "include",
        headers: {
          "csrf-token": csrfToken,
          "x-restli-protocol-version": "2.0.0",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          actor: actorUrn,
          message: {
            attributes: [],
            text: message,
          },
          parentComment: commentUrn,
        }),
      }
    );

    if (res.status === 401) return { success: false, error: "SESSION_EXPIRED" };
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { success: false, error: `HTTP_${res.status}: ${body.slice(0, 200)}` };
    }

    console.log(`[linkdm] Comment reply sent on ${commentUrn}`);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

console.log("[linkdm] Content script ready");
