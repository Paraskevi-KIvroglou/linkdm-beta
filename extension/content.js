// linkdm content script
// Runs on every linkedin.com page.
// Handles Voyager API calls (same-origin, cookies auto-attach)
// and keeps the service worker alive via an open port.

// ── Keep service worker alive ─────────────────────────────────────────────────
const port = chrome.runtime.connect({ name: "keepalive" });

// ── Message listener ─────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "FETCH_COMMENTERS") {
    fetchCommenters(message.postUrl).then(sendResponse);
    return true; // keeps the message channel open for async response
  }
  if (message.type === "SEND_DM") {
    sendDm(message.profileId, message.message).then(sendResponse);
    return true;
  }
});

// ── CSRF token ────────────────────────────────────────────────────────────────
function getCsrfToken() {
  // LinkedIn stores the CSRF token in the JSESSIONID cookie (not HttpOnly)
  const match = document.cookie.match(/JSESSIONID="?([^";]+)"?/);
  return match ? match[1] : null;
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

  // Extract unique commenters from Comment elements
  const seen = new Set();
  const commenters = [];
  for (const item of included) {
    if (!item.$type?.includes("Comment")) continue;
    const memberActor =
      item.commenter?.["com.linkedin.voyager.feed.MemberActor"];
    if (!memberActor) continue;
    const profileUrn = memberActor.miniProfile;
    if (!profileUrn || seen.has(profileUrn)) continue;
    const profile = profilesByUrn[profileUrn];
    if (!profile) continue;
    seen.add(profileUrn);
    commenters.push({ ...profile, commentText: item.commentary?.text || "" });
  }
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
    if (!res.ok) return { error: `HTTP_${res.status}` };

    const data = await res.json();
    const commenters = parseCommenters(data);
    console.log(`[linkdm] Fetched ${commenters.length} commenters for post`);
    return { commenters };
  } catch (err) {
    return { error: err.message };
  }
}

// ── Send DM via Voyager messaging API ─────────────────────────────────────────
// Note: If LinkedIn changes their API shape, inspect a real DM send in Network
// tab (filter for "voyagerMessagingDash") to see the current request format.
async function sendDm(profileId, message) {
  const csrfToken = getCsrfToken();
  if (!csrfToken) return { success: false, error: "NO_CSRF_TOKEN" };

  try {
    const res = await fetch(
      "https://www.linkedin.com/voyager/api/voyagerMessagingDashMessengerMessages?action=create",
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
            body: {
              attributes: [],
              text: message,
            },
            renderContentUnions: [],
          },
          recipients: [profileId],
          subject: "",
        }),
      }
    );

    if (res.status === 401) return { success: false, error: "SESSION_EXPIRED" };
    if (!res.ok) return { success: false, error: `HTTP_${res.status}` };

    console.log(`[linkdm] DM sent to ${profileId}`);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

console.log("[linkdm] Content script ready");
